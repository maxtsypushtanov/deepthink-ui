import { create } from 'zustand';
import type {
  Conversation,
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
}

interface ChatStore {
  // State
  conversations: Conversation[];
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
  stopStreaming: () => void;
  updateSettings: (partial: Partial<ChatSettings>) => void;
  clearError: () => void;
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
  activeConversationId: null,
  messages: [],
  streaming: {
    isStreaming: false,
    currentContent: '',
    thinkingSteps: [],
    strategyUsed: null,
    isThinking: false,
    currentPersona: null,
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
            const { streaming } = get();
            const assistantMsg: Message = {
              id: generateId(),
              conversation_id: get().activeConversationId || '',
              role: 'assistant',
              content: streaming.currentContent,
              model: settings.model,
              provider: settings.provider,
              reasoning_strategy: streaming.strategyUsed || settings.strategy,
              reasoning_trace: JSON.stringify(streaming.thinkingSteps),
              created_at: new Date().toISOString(),
            };
            set((s) => ({
              messages: [...s.messages, assistantMsg],
              streaming: {
                isStreaming: false,
                currentContent: '',
                thinkingSteps: [],
                strategyUsed: null,
                isThinking: false,
                currentPersona: null,
              },
            }));
            break;
          }

          case 'error':
            set({ error: data.error, streaming: { ...get().streaming, isStreaming: false } });
            break;
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        set({ error: e.message });
      }
    } finally {
      set((s) => ({
        streaming: { ...s.streaming, isStreaming: false },
      }));
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
}));
