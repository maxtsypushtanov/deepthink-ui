import { create } from 'zustand';
import type {
  Conversation,
  Folder,
  Message,
  ChatSettings,
  ThinkingStep,
  ReasoningStrategy,
  StrategySelectedEvent,
} from '@/types';
import { api, streamChat, API_BASE } from '@/lib/api';
import { generateId } from '@/lib/utils';

interface StreamingState {
  isStreaming: boolean;
  currentContent: string;
  thinkingSteps: ThinkingStep[];
  strategyUsed: string | null;
  isThinking: boolean;
  currentPersona: StrategySelectedEvent | null;
  clarificationQuestion: string | null;
  tokensGenerated: number;
}

interface ChatStore {
  // State
  conversations: Conversation[];
  folders: Folder[];
  activeConversationId: string | null;
  messages: Message[];
  streaming: StreamingState;
  settings: ChatSettings;
  calendarMode: boolean;
  githubMode: boolean;
  calendarDraft: any | null;
  executionPlan: {
    strategy: string;
    strategy_label: string;
    domain: string;
    domain_label: string;
    steps: string[];
    estimated_calls: number;
    pendingMessage: string;
  } | null;
  error: string | null;
  lastPersona: StrategySelectedEvent | null;
  conversationsLoaded: boolean;

  // Actions
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createConversation: () => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (content: string, prefill?: { domain: string | null; strategy: string | null }) => Promise<void>;
  sendClarification: (answer: string) => Promise<void>;
  stopStreaming: () => void;
  updateSettings: (partial: Partial<ChatSettings>) => void;
  toggleCalendarMode: () => void;
  toggleGitHubMode: () => void;
  confirmCalendarDraft: () => Promise<void>;
  dismissCalendarDraft: () => void;
  acceptPlan: () => Promise<void>;
  dismissPlan: () => void;
  clearError: () => void;
  handleFileAnalysisStream: (resp: Response) => Promise<void>;
  // Folder actions
  loadFolders: () => Promise<void>;
  createFolder: (name: string, parentFolderId?: string | null) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveConversation: (conversationId: string, folderId: string | null) => Promise<void>;
  moveFolder: (folderId: string, parentFolderId: string | null) => Promise<void>;
}

type ChatState = ChatStore;

const DEFAULT_SETTINGS: ChatSettings = {
  model: 'google/gemini-3.1-flash-lite-preview',
  provider: 'openrouter',
  strategy: 'auto',
  temperature: 0.7,
  maxTokens: 4096,
  budgetRounds: 3,
  bestOfN: 3,
  treeBreadth: 3,
  treeDepth: 2,
};

let abortController: AbortController | null = null;
let contentBuffer = '';
let bufferTokenCount = 0;
let rafId: number | null = null;
let streamEnded = false;

/**
 * Smooth streaming: instead of flushing entire buffer per frame (jerky),
 * emit a proportional slice each frame. Creates typewriter effect
 * that adapts speed to incoming rate — fast when lots buffered, gentle when little.
 *
 * TRIZ "Continuity of useful action": never stop, never jump.
 */
const MIN_CHARS_PER_FRAME = 3;
const MAX_CHARS_PER_FRAME = 80;

function flushContentBuffer() {
  if (!contentBuffer) { rafId = null; return; }

  // Adaptive chunk size: emit more when buffer is large (catch up), less when small (smooth)
  // When stream has ended, drain 4x faster for a smooth but accelerated finish
  const effectiveMax = streamEnded ? MAX_CHARS_PER_FRAME * 4 : MAX_CHARS_PER_FRAME;
  const len = contentBuffer.length;
  const charsThisFrame = Math.min(effectiveMax, Math.max(MIN_CHARS_PER_FRAME, Math.ceil(len * 0.4)));

  const chunk = contentBuffer.slice(0, charsThisFrame);
  const tokensEstimate = Math.max(1, Math.round(bufferTokenCount * (charsThisFrame / len)));
  contentBuffer = contentBuffer.slice(charsThisFrame);
  bufferTokenCount = Math.max(0, bufferTokenCount - tokensEstimate);

  useChatStore.setState((s) => ({
    streaming: {
      ...s.streaming,
      currentContent: s.streaming.currentContent + chunk,
      tokensGenerated: s.streaming.tokensGenerated + tokensEstimate,
    },
  }));

  // Continue draining if buffer still has content
  if (contentBuffer) {
    rafId = requestAnimationFrame(flushContentBuffer);
  } else {
    rafId = null;
    // When accelerated drain finishes, finalize the assistant message
    if (streamEnded) {
      streamEnded = false;
      useChatStore.setState((s) => {
        const content = s.streaming.currentContent;
        const hasClarification = !!s.streaming.clarificationQuestion;
        const resetStreaming = {
          isStreaming: false,
          currentContent: '',
          thinkingSteps: hasClarification ? s.streaming.thinkingSteps : [],
          strategyUsed: hasClarification ? s.streaming.strategyUsed : null,
          isThinking: false,
          currentPersona: hasClarification ? s.streaming.currentPersona : null,
          clarificationQuestion: s.streaming.clarificationQuestion,
          tokensGenerated: 0,
        };
        if (!content || !content.trim()) {
          return { streaming: resetStreaming };
        }
        const lastMsg = s.messages[s.messages.length - 1];
        if (lastMsg?.role === 'assistant' && lastMsg.content === content) {
          return { streaming: resetStreaming };
        }
        const assistantMsg: Message = {
          id: generateId(),
          conversation_id: s.activeConversationId || '',
          role: 'assistant',
          content,
          model: s.settings.model,
          provider: s.settings.provider,
          reasoning_strategy: s.streaming.strategyUsed || s.settings.strategy,
          reasoning_trace: JSON.stringify(s.streaming.thinkingSteps),
          created_at: new Date().toISOString(),
        };
        return {
          messages: [...s.messages, assistantMsg],
          streaming: resetStreaming,
        };
      });
    }
  }
}

async function handleSSEStream(
  body: Record<string, unknown>,
  get: () => ChatState,
  set: (fn: ((s: ChatState) => Partial<ChatState>) | Partial<ChatState>) => void,
  onDone?: (data: any) => void,
) {
  abortController?.abort();
  abortController = new AbortController();
  streamEnded = false;

  // 60s timeout — if backend hangs, abort and show error
  const timeoutId = setTimeout(() => {
    abortController?.abort();
    set({ error: 'Request timed out. Try again.' });
  }, 60000);

  try {
    for await (const { event, data } of streamChat(body, abortController.signal)) {
      if (abortController?.signal.aborted) break;
      switch (event) {
        case 'conversation':
          if (data.conversation_id) {
            const isNew = !get().activeConversationId;
            set({ activeConversationId: data.conversation_id });
            if (isNew) {
              get().loadConversations().catch(() => {});
            }
          }
          break;

        case 'strategy_selected':
          set((s) => ({
            streaming: {
              ...s.streaming,
              strategyUsed: data.strategy,
              currentPersona: data as StrategySelectedEvent,
            },
            lastPersona: data as StrategySelectedEvent,
          }));
          break;

        case 'thinking_start':
          set((s) => ({
            streaming: { ...s.streaming, isThinking: true, strategyUsed: data.strategy },
          }));
          break;

        case 'thinking_step':
          set((s) => ({
            streaming: {
              ...s.streaming,
              thinkingSteps: [
                ...s.streaming.thinkingSteps,
                {
                  step_number: data.step,
                  strategy: s.streaming.strategyUsed || '',
                  content: data.label || data.type || 'Рассуждаю',
                  duration_ms: 0,
                  metadata: { type: data.type, content: data.content || '', ...(data.branches ? { branches: data.branches } : {}) },
                },
              ],
            },
          }));
          break;

        case 'content_delta':
          contentBuffer += data.content;
          bufferTokenCount += 1;
          if (!rafId) {
            rafId = requestAnimationFrame(flushContentBuffer);
          }
          break;

        case 'thinking_end':
          set((s) => ({
            streaming: {
              ...s.streaming,
              isThinking: false,
              thinkingSteps: data.steps?.length
                ? data.steps.map((step: any, i: number) => ({
                    step_number: step.step_number ?? i + 1,
                    strategy: step.strategy ?? '',
                    content: step.content ?? '',
                    duration_ms: step.duration_ms ?? 0,
                    metadata: step.metadata ?? step,
                  }))
                : s.streaming.thinkingSteps,
            },
          }));
          break;

        case 'done': {
          // If buffer is small, flush instantly; otherwise accelerate drain (4x speed)
          if (contentBuffer.length < 50) {
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            const pendingContent = contentBuffer;
            contentBuffer = '';
            bufferTokenCount = 0;
            streamEnded = false;

            set((s) => {
              const content = s.streaming.currentContent + pendingContent;
              // Preserve clarification question — don't reset if user needs to answer
              const hasClarification = !!s.streaming.clarificationQuestion;
              const resetStreaming = {
                isStreaming: false,
                currentContent: '',
                thinkingSteps: hasClarification ? s.streaming.thinkingSteps : [],
                strategyUsed: hasClarification ? s.streaming.strategyUsed : null,
                isThinking: false,
                currentPersona: hasClarification ? s.streaming.currentPersona : null,
                clarificationQuestion: s.streaming.clarificationQuestion,
                tokensGenerated: 0,
              };
              // Don't add empty assistant messages
              if (!content || !content.trim()) {
                return { streaming: resetStreaming };
              }
              // Don't add duplicate — check if last message is already this assistant response
              const lastMsg = s.messages[s.messages.length - 1];
              if (lastMsg?.role === 'assistant' && lastMsg.content === content) {
                return { streaming: resetStreaming };
              }
              // Append Python-generated images as markdown if present
              const images = data?.images as string[] | undefined;
              let finalContent = content;
              if (images && images.length > 0) {
                const imgMarkdown = images.map((b64: string, i: number) =>
                  `\n\n![Результат ${i + 1}](data:image/png;base64,${b64})`
                ).join('');
                finalContent = content + imgMarkdown;
              }

              const assistantMsg: Message = {
                id: generateId(),
                conversation_id: s.activeConversationId || '',
                role: 'assistant',
                content: finalContent,
                model: s.settings.model,
                provider: s.settings.provider,
                reasoning_strategy: s.streaming.strategyUsed || s.settings.strategy,
                reasoning_trace: JSON.stringify(s.streaming.thinkingSteps),
                created_at: new Date().toISOString(),
              };
              return {
                messages: [...s.messages, assistantMsg],
                streaming: resetStreaming,
              };
            });

            if (onDone) onDone(data);
          } else {
            // Large buffer remaining — set flag to accelerate RAF drain (4x speed)
            // instead of dumping all at once (which causes a jarring jump)
            streamEnded = true;
            if (!rafId) {
              rafId = requestAnimationFrame(flushContentBuffer);
            }
            // NOTE: streaming state (isStreaming, message finalization) will be
            // handled by the finally block once the for-await loop exits.
            if (onDone) onDone(data);
          }
          break;
        }

        case 'clarification_needed':
          set((s) => ({
            streaming: {
              ...s.streaming,
              isStreaming: false,
              isThinking: false,
              clarificationQuestion: data.question,
            },
          }));
          break;

        case 'error':
          set((s) => ({ error: data.error, streaming: { ...s.streaming, isStreaming: false } }));
          break;
      }
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') {
      set({ error: e.message });
    }
  } finally {
    clearTimeout(timeoutId);
    // If streamEnded is true, the accelerated RAF drain is still running —
    // let it finish naturally and finalize the message itself.
    if (!streamEnded) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (contentBuffer) flushContentBuffer();
      set((s) => s.streaming.isStreaming ? { streaming: { ...s.streaming, isStreaming: false } } : s);
    }
  }
}

export const useChatStore = create<ChatStore>((set, get) => ({
  conversations: [],
  folders: [],
  activeConversationId: null,
  messages: [],
  streaming: {
    isStreaming: false,
    currentContent: '',
    thinkingSteps: [],
    strategyUsed: null,
    isThinking: false,
    currentPersona: null,
    clarificationQuestion: null,
    tokensGenerated: 0,
  },
  settings: DEFAULT_SETTINGS,
  calendarMode: false,
  githubMode: false,
  calendarDraft: null,
  executionPlan: null,
  error: null,
  lastPersona: null,
  conversationsLoaded: false,

  loadConversations: async () => {
    try {
      const convs = await api.listConversations();
      set({ conversations: convs, conversationsLoaded: true });
    } catch (e: any) {
      set({ error: e.message, conversationsLoaded: true });
    }
  },

  selectConversation: async (id: string) => {
    set({
      activeConversationId: id,
      lastPersona: null,
      executionPlan: null,
      calendarDraft: null,
      error: null,
      streaming: {
        isStreaming: false, currentContent: '', thinkingSteps: [],
        strategyUsed: null, isThinking: false, currentPersona: null,
        clarificationQuestion: null, tokensGenerated: 0,
      },
    });
    try {
      const msgs = await api.getMessages(id);
      set({ messages: msgs });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  createConversation: async () => {
    try {
      const conv = await api.createConversation();
      set((s) => ({
        conversations: [conv, ...s.conversations],
        activeConversationId: conv.id,
        messages: [],
        executionPlan: null,
        calendarDraft: null,
        error: null,
        streaming: {
          isStreaming: false, currentContent: '', thinkingSteps: [],
          strategyUsed: null, isThinking: false, currentPersona: null,
          clarificationQuestion: null, tokensGenerated: 0,
        },
      }));
      return conv.id;
    } catch (e: any) {
      set({ error: e.message });
      return '';
    }
  },

  deleteConversation: async (id: string) => {
    try {
      await api.deleteConversation(id);
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== id),
        activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
        messages: s.activeConversationId === id ? [] : s.messages,
      }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  sendMessage: async (content: string, prefill?: { domain: string | null; strategy: string | null }) => {
    const { settings, activeConversationId } = get();

    // Auto-detect calendar intent from message text
    // TRIZ #7: Two-level calendar intent scoring — avoid false positives on temporal words
    const CALENDAR_TEMPORAL = /(?:завтра|сегодня|послезавтра|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье|в \d{1,2}[:.]\d{2}|\d{1,2}:\d{2}|tomorrow|today)\b/i;
    const CALENDAR_ACTION = /(?:встреча|расписание|schedule|meeting|какие встречи|запланируй|назначь|перенеси|отмени встречу|свободные слоты|когда свободно|создай событие|добавь в календарь|удали встречу|в календар[еёьи]|мой календар|calendar|что запланирован|покажи событи|мои событи|открой календар|покажи календар)\b/i;
    const hasTemporal = CALENDAR_TEMPORAL.test(content);
    const hasAction = CALENDAR_ACTION.test(content);
    // High confidence: action verb present → auto calendar
    // Low confidence: only temporal words → no auto (user can toggle manually)
    const autoCalendar = hasAction || (hasTemporal && hasAction);

    // Track behavior
    import('@/stores/behaviorStore').then(({ useBehaviorStore }) => {
      useBehaviorStore.getState().trackEvent('message_sent');
    }).catch(() => {});

    // Add optimistic user message
    const userMsg: Message = {
      id: generateId(),
      conversation_id: activeConversationId || '',
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };

    set((s) => ({
      messages: [...s.messages, userMsg],
      error: null,
    }));

    // For "none"/"auto" strategy or very short messages, skip planning — stream directly
    const isCalendar = get().calendarMode || autoCalendar;
    if (settings.strategy === 'none' || settings.strategy === 'auto' || content.trim().length < 10 || isCalendar || get().githubMode) {
      set((s) => ({
        streaming: {
          isStreaming: true, currentContent: '', thinkingSteps: [],
          strategyUsed: null, isThinking: false, currentPersona: null,
          clarificationQuestion: null, tokensGenerated: 0,
        },
      }));

      const body = {
        conversation_id: activeConversationId,
        message: content,
        model: settings.model,
        provider: settings.provider,
        reasoning_strategy: settings.strategy,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        budget_rounds: settings.budgetRounds,
        best_of_n: settings.bestOfN,
        tree_breadth: settings.treeBreadth,
        tree_depth: settings.treeDepth,
        calendar_mode: isCalendar,
        github_mode: get().githubMode,
        ...(prefill?.domain && { pre_domain: prefill.domain }),
        ...(prefill?.strategy && { pre_strategy: prefill.strategy }),
      };

      await handleSSEStream(body, get, set, (data) => {
        if (data?.calendar_draft) set({ calendarDraft: data.calendar_draft });
        else if (data?.calendar_result || isCalendar) {
          import('@/stores/calendarStore').then(({ useCalendarStore }) => {
            useCalendarStore.getState().loadWeekEvents();
          }).catch(() => {});
        }
      });
      return;
    }

    // Request execution plan
    try {
      const resp = await fetch(`${API_BASE}/api/chat/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          model: settings.model,
          provider: settings.provider,
          reasoning_strategy: settings.strategy,
          temperature: settings.temperature,
          max_tokens: settings.maxTokens,
          budget_rounds: settings.budgetRounds,
          best_of_n: settings.bestOfN,
          tree_breadth: settings.treeBreadth,
          tree_depth: settings.treeDepth,
          calendar_mode: isCalendar,
          github_mode: get().githubMode,
          ...(prefill?.domain && { pre_domain: prefill.domain }),
          ...(prefill?.strategy && { pre_strategy: prefill.strategy }),
        }),
      });

      if (resp.ok) {
        const plan = await resp.json();
        // Auto-accept simple plans (1 call) — don't burden user with confirmation
        if (plan.estimated_calls <= 1 || plan.strategy === 'none') {
          // Execute directly with the strategy from the plan
          set((s) => ({
            streaming: {
              isStreaming: true, currentContent: '', thinkingSteps: [],
              strategyUsed: null, isThinking: false, currentPersona: null,
              clarificationQuestion: null, tokensGenerated: 0,
            },
          }));

          const autoBody = {
            conversation_id: activeConversationId,
            message: content,
            model: settings.model,
            provider: settings.provider,
            reasoning_strategy: plan.strategy || 'none',
            temperature: settings.temperature,
            max_tokens: settings.maxTokens,
            budget_rounds: settings.budgetRounds,
            best_of_n: settings.bestOfN,
            tree_breadth: settings.treeBreadth,
            tree_depth: settings.treeDepth,
            calendar_mode: isCalendar,
            github_mode: get().githubMode,
            ...(prefill?.domain && { pre_domain: prefill.domain }),
            ...(prefill?.strategy && { pre_strategy: prefill.strategy }),
          };

          await handleSSEStream(autoBody, get, set, (data) => {
            if (data?.calendar_draft) set({ calendarDraft: data.calendar_draft });
          });
          return;
        } else {
          set({
            executionPlan: { ...plan, pendingMessage: content },
          });
          return;  // Wait for user to accept
        }
      }
    } catch {
      // Plan request failed — execute directly as fallback
    }

    // Fallback: execute directly
    set((s) => ({
      streaming: {
        isStreaming: true, currentContent: '', thinkingSteps: [],
        strategyUsed: null, isThinking: false, currentPersona: null,
        clarificationQuestion: null, tokensGenerated: 0,
      },
    }));

    const body = {
      conversation_id: activeConversationId,
      message: content,
      model: settings.model,
      provider: settings.provider,
      reasoning_strategy: (settings.strategy as string) === 'auto' ? 'none' : settings.strategy,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      budget_rounds: settings.budgetRounds,
      best_of_n: settings.bestOfN,
      tree_breadth: settings.treeBreadth,
      tree_depth: settings.treeDepth,
      calendar_mode: isCalendar,
      github_mode: get().githubMode,
      ...(prefill?.domain && { pre_domain: prefill.domain }),
      ...(prefill?.strategy && { pre_strategy: prefill.strategy }),
    };

    await handleSSEStream(body, get, set, (data) => {
      if (data?.calendar_draft) set({ calendarDraft: data.calendar_draft });
      else if (data?.calendar_result || isCalendar) {
        import('@/stores/calendarStore').then(({ useCalendarStore }) => {
          useCalendarStore.getState().loadWeekEvents();
        }).catch(() => {});
      }
    });
  },

  sendClarification: async (answer: string) => {
    const { settings, activeConversationId, streaming } = get();
    const clarificationContext = `Пользователь ответил на уточняющий вопрос: "${streaming.clarificationQuestion}" → "${answer}"`;

    set((s) => ({
      streaming: {
        ...s.streaming,
        isStreaming: true,
        isThinking: true,
        clarificationQuestion: null,
      },
    }));

    const body = {
      conversation_id: activeConversationId,
      message: answer,
      model: settings.model,
      provider: settings.provider,
      reasoning_strategy: settings.strategy,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      budget_rounds: settings.budgetRounds,
      best_of_n: settings.bestOfN,
      tree_breadth: settings.treeBreadth,
      tree_depth: settings.treeDepth,
      clarification_context: clarificationContext,
    };

    await handleSSEStream(body, get, set);
  },

  stopStreaming: () => {
    abortController?.abort();
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    contentBuffer = '';
    bufferTokenCount = 0;
    streamEnded = false;
    set((s) => ({
      streaming: { ...s.streaming, isStreaming: false },
    }));
  },

  toggleCalendarMode: () => set((s) => ({ calendarMode: !s.calendarMode })),
  toggleGitHubMode: () => set((s) => ({ githubMode: !s.githubMode })),

  confirmCalendarDraft: async () => {
    const draft = get().calendarDraft;
    if (!draft) return;

    const action = draft.calendar_action || 'create';
    const title = draft.title || draft._event_title || 'событие';

    try {
      const resp = await fetch(`${API_BASE}/api/calendar/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });

      if (resp.ok) {
        // Reload calendar
        import('@/stores/calendarStore').then(({ useCalendarStore }) => {
          useCalendarStore.getState().loadWeekEvents();
        }).catch(() => {});

        // Add success feedback as assistant message
        const feedbackMap: Record<string, string> = {
          create: `Встреча «${title}» создана.`,
          delete: `Встреча «${title}» удалена.`,
          update: `Встреча «${title}» обновлена.`,
        };
        const feedback = feedbackMap[action] || 'Действие выполнено.';
        const cid = get().activeConversationId;
        if (cid) {
          set((s) => ({
            messages: [...s.messages, {
              id: generateId(),
              conversation_id: cid,
              role: 'assistant' as const,
              content: feedback,
              created_at: new Date().toISOString(),
            }],
          }));
        }
      } else {
        const err = await resp.json().catch(() => ({ detail: 'Ошибка' }));
        const cid = get().activeConversationId;
        if (cid) {
          set((s) => ({
            messages: [...s.messages, {
              id: generateId(),
              conversation_id: cid,
              role: 'assistant' as const,
              content: `Не удалось выполнить действие: ${err.detail || 'ошибка сервера'}`,
              created_at: new Date().toISOString(),
            }],
          }));
        }
      }
    } catch (e) {
      console.error('Failed to confirm calendar action:', e);
    }
    set({ calendarDraft: null });
  },

  dismissCalendarDraft: () => set({ calendarDraft: null }),

  acceptPlan: async () => {
    const plan = get().executionPlan;
    if (!plan) return;
    set({ executionPlan: null });

    const { settings, activeConversationId } = get();
    set((s) => ({
      streaming: {
        isStreaming: true,
        currentContent: '',
        thinkingSteps: [],
        strategyUsed: null,
        isThinking: false,
        currentPersona: null,
        clarificationQuestion: null,
        tokensGenerated: 0,
      },
      error: null,
    }));

    const body = {
      conversation_id: activeConversationId,
      message: plan.pendingMessage,
      model: settings.model,
      provider: settings.provider,
      reasoning_strategy: plan.strategy,  // Use the planned strategy
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      budget_rounds: settings.budgetRounds,
      best_of_n: settings.bestOfN,
      tree_breadth: settings.treeBreadth,
      tree_depth: settings.treeDepth,
      calendar_mode: get().calendarMode,
      github_mode: get().githubMode,
      confirm_plan: true,
    };

    await handleSSEStream(body, get, set, (data) => {
      if (data?.calendar_draft) {
        set({ calendarDraft: data.calendar_draft });
      } else if (data?.calendar_result || get().calendarMode) {
        import('@/stores/calendarStore').then(({ useCalendarStore }) => {
          useCalendarStore.getState().loadWeekEvents();
        }).catch(() => {});
      }
    });
  },

  dismissPlan: () => set({ executionPlan: null }),

  updateSettings: (partial) => {
    set((s) => ({ settings: { ...s.settings, ...partial } }));
  },

  clearError: () => set({ error: null }),

  handleFileAnalysisStream: async (resp: Response) => {
    // Process SSE stream from file analysis endpoint (same format as /api/chat)
    const reader = resp.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    set((s) => ({
      streaming: { ...s.streaming, isStreaming: true, currentContent: '', thinkingSteps: [], isThinking: false, strategyUsed: null, currentPersona: null, clarificationQuestion: null, tokensGenerated: 0 },
    }));

    const processLine = (line: string) => {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ') && currentEvent) {
        try {
          const data = JSON.parse(line.slice(6));
          if (currentEvent === 'conversation' && data.conversation_id) {
            // Don't switch conversation — we already know the ID
          } else if (currentEvent === 'strategy_selected') {
            set((s) => ({ streaming: { ...s.streaming, strategyUsed: data.strategy, currentPersona: data } }));
          } else if (currentEvent === 'thinking_start') {
            set((s) => ({ streaming: { ...s.streaming, isThinking: true } }));
          } else if (currentEvent === 'thinking_step') {
            set((s) => ({ streaming: { ...s.streaming, thinkingSteps: [...s.streaming.thinkingSteps, data] } }));
          } else if (currentEvent === 'thinking_end') {
            set((s) => ({ streaming: { ...s.streaming, isThinking: false } }));
          } else if (currentEvent === 'content_delta' && data.content) {
            fullContent += data.content;
            set((s) => ({ streaming: { ...s.streaming, currentContent: fullContent } }));
          } else if (currentEvent === 'error') {
            set({ error: data.error || 'Ошибка анализа файла' });
          } else if (currentEvent === 'done') {
            if (fullContent) {
              const cid = get().activeConversationId;
              if (cid) {
                set((s) => ({
                  messages: [...s.messages, {
                    id: generateId(),
                    conversation_id: cid,
                    role: 'assistant' as const,
                    content: fullContent,
                    reasoning_strategy: get().streaming.strategyUsed || undefined,
                    created_at: new Date().toISOString(),
                  }],
                }));
              }
            }
          }
        } catch { /* malformed JSON — skip */ }
        currentEvent = '';
      }
    };

    let currentEvent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) processLine(line);
      }
      // Process remaining buffer
      if (buffer.trim()) {
        for (const line of buffer.split('\n')) processLine(line);
      }
    } catch (e) {
      set({ error: 'Ошибка при чтении потока анализа' });
    } finally {
      set((s) => ({
        streaming: { ...s.streaming, isStreaming: false, currentContent: '', isThinking: false },
      }));
    }
  },

  // ── Folder actions ──

  loadFolders: async () => {
    try {
      const folders = await api.listFolders();
      set({ folders });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  createFolder: async (name, parentFolderId) => {
    try {
      const folder = await api.createFolder(name, parentFolderId);
      set((s) => ({ folders: [...s.folders, folder] }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  renameFolder: async (id, name) => {
    try {
      await api.renameFolder(id, name);
      set((s) => ({
        folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)),
      }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  deleteFolder: async (id) => {
    try {
      await api.deleteFolder(id);
      // Reload both folders and conversations since children are reparented
      const [folders, conversations] = await Promise.all([
        api.listFolders(),
        api.listConversations(),
      ]);
      set({ folders, conversations });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  moveConversation: async (conversationId, folderId) => {
    try {
      await api.moveConversation(conversationId, folderId);
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === conversationId ? { ...c, folder_id: folderId } : c
        ),
      }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  moveFolder: async (folderId, parentFolderId) => {
    try {
      await api.moveFolder(folderId, parentFolderId);
      set((s) => ({
        folders: s.folders.map((f) =>
          f.id === folderId ? { ...f, parent_folder_id: parentFolderId } : f
        ),
      }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },
}));
