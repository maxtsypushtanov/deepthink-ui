import { create } from 'zustand';
import type { DevLoopContext, PipelineEvent, PipelineStatus } from '@/types/pipeline';

const API_BASE = import.meta.env.VITE_API_URL || '';
const WS_BASE = API_BASE.replace(/^http/, 'ws') || `ws://localhost:8000`;

interface PipelineStore {
  // State
  taskId: string | null;
  context: DevLoopContext | null;
  events: PipelineEvent[];
  status: PipelineStatus;
  error: string | null;

  // Actions
  startPipeline: (task: string, repo: string, maxIterations?: number) => Promise<void>;
  stopPipeline: () => Promise<void>;
  connectWebSocket: (taskId: string) => void;
  reset: () => void;
}

let ws: WebSocket | null = null;

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  taskId: null,
  context: null,
  events: [],
  status: 'idle',
  error: null,

  startPipeline: async (task, repo, maxIterations = 5) => {
    set({ status: 'running', error: null, events: [], context: null });

    try {
      const resp = await fetch(`${API_BASE}/api/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, repo, max_iterations: maxIterations }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || 'Failed to start pipeline');
      }
      const { task_id } = await resp.json();
      set({ taskId: task_id });
      get().connectWebSocket(task_id);
    } catch (e) {
      set({ status: 'error', error: (e as Error).message });
    }
  },

  stopPipeline: async () => {
    const { taskId } = get();
    if (!taskId) return;

    ws?.close();
    ws = null;

    try {
      await fetch(`${API_BASE}/api/pipeline/${taskId}`, { method: 'DELETE' });
    } catch {
      // best-effort
    }
    set({ status: 'idle' });
  },

  connectWebSocket: (taskId) => {
    if (ws) ws.close();

    const socket = new WebSocket(`${WS_BASE}/api/pipeline/${taskId}/stream`);
    ws = socket;

    socket.onmessage = async (msg) => {
      try {
        const event: PipelineEvent = {
          ...JSON.parse(msg.data),
          timestamp: new Date().toISOString(),
        };
        set((s) => ({ events: [...s.events, event] }));

        // Refresh full context on meaningful events
        if (['iteration_complete', 'pipeline_done', 'agent_started'].includes(event.type)) {
          try {
            const resp = await fetch(`${API_BASE}/api/pipeline/${taskId}/status`);
            if (resp.ok) {
              const data = await resp.json();
              if (data.context) {
                set({ context: data.context });
              }
            }
          } catch {
            // non-critical
          }
        }

        if (event.type === 'pipeline_done') {
          set({ status: 'done' });
        }
        if (event.type === 'error') {
          set({ status: 'error', error: String(event.data?.message ?? 'Unknown error') });
        }
      } catch {
        // ignore malformed messages
      }
    };

    socket.onerror = () => {
      set({ status: 'error', error: 'WebSocket connection error' });
    };

    socket.onclose = () => {
      ws = null;
    };
  },

  reset: () => {
    ws?.close();
    ws = null;
    set({ taskId: null, context: null, events: [], status: 'idle', error: null });
  },
}));
