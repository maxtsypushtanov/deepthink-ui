import { create } from 'zustand';
import { API_BASE } from '@/lib/api';

export interface ForkBranch {
  id: string;           // conversation_id of the forked branch
  parentId: string;     // source conversation_id
  forkAtIndex: number;  // message index where fork happened
  label: string;        // display label
  createdAt: string;    // ISO timestamp
}

interface ForkState {
  /** Currently active fork view: [leftConvId, rightConvId] or null */
  activeFork: { left: string; right: string } | null;
  /** All known fork branches keyed by parent conversation id */
  branches: Map<string, ForkBranch[]>;
}

interface ForkActions {
  createFork: (sourceConversationId: string, forkAtMessageIndex: number) => Promise<string | null>;
  closeFork: () => void;
  setActiveFork: (left: string, right: string) => void;
}

type ForkStore = ForkState & ForkActions;

const MAX_FORKS_PER_CONVERSATION = 2;

export const useForkStore = create<ForkStore>((set, get) => ({
  activeFork: null,
  branches: new Map(),

  createFork: async (sourceConversationId, forkAtMessageIndex) => {
    // Enforce limit
    const existing = get().branches.get(sourceConversationId) || [];
    if (existing.length >= MAX_FORKS_PER_CONVERSATION) {
      return null;
    }

    try {
      const resp = await fetch(`${API_BASE}/api/chat/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_conversation_id: sourceConversationId,
          fork_at_message_index: forkAtMessageIndex,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'Fork failed' }));
        console.error('Fork failed:', err.detail);
        return null;
      }

      const data = await resp.json();
      const branch: ForkBranch = {
        id: data.conversation_id,
        parentId: sourceConversationId,
        forkAtIndex: forkAtMessageIndex,
        label: `Ветка ${existing.length + 2}`,
        createdAt: new Date().toISOString(),
      };

      const newBranches = new Map(get().branches);
      newBranches.set(sourceConversationId, [...existing, branch]);

      set({
        branches: newBranches,
        activeFork: { left: sourceConversationId, right: branch.id },
      });

      return branch.id;
    } catch (e) {
      console.error('Fork error:', e);
      return null;
    }
  },

  closeFork: () => set({ activeFork: null }),

  setActiveFork: (left, right) => set({ activeFork: { left, right } }),
}));
