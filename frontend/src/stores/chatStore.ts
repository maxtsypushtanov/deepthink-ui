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
import { api, streamChat } from '@/lib/api';
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
  error: string | null;

  // Actions
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createConversation: () => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  sendClarification: (answer: string) => Promise<void>;
  stopStreaming: () => void;
  updateSettings: (partial: Partial<ChatSettings>) => void;
  clearError: () => void;
  // Folder actions
  loadFolders: () => Promise<void>;
  createFolder: (name: string, parentFolderId?: string | null) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveConversation: (conversationId: string, folderId: string | null) => Promise<void>;
  moveFolder: (folderId: string, parentFolderId: string | null) => Promise<void>;
}

const DEFAULT_SETTINGS: ChatSettings = {
  model: 'openai/gpt-4o-mini',
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
  error: null,

  loadConversations: async () => {
    try {
      const convs = await api.listConversations();
      set({ conversations: convs });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  selectConversation: async (id: string) => {
    set({ activeConversationId: id });
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

  sendMessage: async (content: string) => {
    const { settings, activeConversationId } = get();

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

    abortController = new AbortController();

    try {
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
      };

      for await (const { event, data } of streamChat(body)) {
        if (abortController?.signal.aborted) break;

        switch (event) {
          case 'conversation':
            if (!activeConversationId && data.conversation_id) {
              set({ activeConversationId: data.conversation_id });
              // Refresh conversation list
              get().loadConversations();
            }
            break;

          case 'strategy_selected':
            set((s) => ({
              streaming: {
                ...s.streaming,
                strategyUsed: data.strategy,
                currentPersona: data as StrategySelectedEvent,
              },
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
                    strategy: data.type || '',
                    content: data.label || '',
                    duration_ms: 0,
                    metadata: data,
                  },
                ],
              },
            }));
            break;

          case 'content_delta':
            set((s) => ({
              streaming: {
                ...s.streaming,
                currentContent: s.streaming.currentContent + data.content,
                tokensGenerated: s.streaming.tokensGenerated + 1,
              },
            }));
            break;

          case 'thinking_end':
            set((s) => ({
              streaming: {
                ...s.streaming,
                isThinking: false,
                thinkingSteps: data.steps?.length
                  ? data.steps
                  : s.streaming.thinkingSteps,
              },
            }));
            break;

          case 'done': {
            set((s) => {
              const content = s.streaming.currentContent;
              const resetStreaming = {
                isStreaming: false,
                currentContent: '',
                thinkingSteps: [],
                strategyUsed: null,
                isThinking: false,
                currentPersona: null,
                clarificationQuestion: null,
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
              const assistantMsg: Message = {
                id: generateId(),
                conversation_id: s.activeConversationId || '',
                role: 'assistant',
                content,
                model: settings.model,
                provider: settings.provider,
                reasoning_strategy: s.streaming.strategyUsed || settings.strategy,
                reasoning_trace: JSON.stringify(s.streaming.thinkingSteps),
                created_at: new Date().toISOString(),
              };
              return {
                messages: [...s.messages, assistantMsg],
                streaming: resetStreaming,
              };
            });
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
      set((s) => s.streaming.isStreaming ? { streaming: { ...s.streaming, isStreaming: false } } : s);
    }
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

    abortController = new AbortController();

    try {
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

      for await (const { event, data } of streamChat(body)) {
        if (abortController?.signal.aborted) break;

        switch (event) {
          case 'conversation':
            if (data.conversation_id) {
              set({ activeConversationId: data.conversation_id });
              get().loadConversations();
            }
            break;

          case 'strategy_selected':
            set((s) => ({
              streaming: {
                ...s.streaming,
                strategyUsed: data.strategy,
                currentPersona: data as StrategySelectedEvent,
              },
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
                    strategy: data.type || '',
                    content: data.label || '',
                    duration_ms: 0,
                    metadata: data,
                  },
                ],
              },
            }));
            break;

          case 'content_delta':
            set((s) => ({
              streaming: {
                ...s.streaming,
                currentContent: s.streaming.currentContent + data.content,
                tokensGenerated: s.streaming.tokensGenerated + 1,
              },
            }));
            break;

          case 'thinking_end':
            set((s) => ({
              streaming: {
                ...s.streaming,
                isThinking: false,
                thinkingSteps: data.steps?.length
                  ? data.steps
                  : s.streaming.thinkingSteps,
              },
            }));
            break;

          case 'done': {
            set((s) => {
              const content = s.streaming.currentContent;
              const resetStreaming = {
                isStreaming: false,
                currentContent: '',
                thinkingSteps: [],
                strategyUsed: null,
                isThinking: false,
                currentPersona: null,
                clarificationQuestion: null,
                tokensGenerated: 0,
              };
              // Don't add empty assistant messages
              if (!content || !content.trim()) {
                return { streaming: resetStreaming };
              }
              // Don't add duplicate
              const lastMsg = s.messages[s.messages.length - 1];
              if (lastMsg?.role === 'assistant' && lastMsg.content === content) {
                return { streaming: resetStreaming };
              }
              const assistantMsg: Message = {
                id: generateId(),
                conversation_id: s.activeConversationId || '',
                role: 'assistant',
                content,
                model: settings.model,
                provider: settings.provider,
                reasoning_strategy: s.streaming.strategyUsed || settings.strategy,
                reasoning_trace: JSON.stringify(s.streaming.thinkingSteps),
                created_at: new Date().toISOString(),
              };
              return {
                messages: [...s.messages, assistantMsg],
                streaming: resetStreaming,
              };
            });
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
      set((s) => s.streaming.isStreaming ? { streaming: { ...s.streaming, isStreaming: false } } : s);
    }
  },

  stopStreaming: () => {
    abortController?.abort();
    set((s) => ({
      streaming: { ...s.streaming, isStreaming: false },
    }));
  },

  updateSettings: (partial) => {
    set((s) => ({ settings: { ...s.settings, ...partial } }));
  },

  clearError: () => set({ error: null }),

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
