import { create } from 'zustand';

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  color: string;
}

interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdEvent?: CalendarEvent | null;
}

interface CalendarStore {
  // Week view
  weekOffset: number;
  events: CalendarEvent[];
  loading: boolean;

  // Agent chat
  agentMessages: AgentMessage[];
  agentStreaming: boolean;
  agentStreamContent: string;

  // Actions
  loadWeekEvents: () => Promise<void>;
  prevWeek: () => void;
  nextWeek: () => void;
  goToday: () => void;
  createEvent: (ev: Omit<CalendarEvent, 'id'>) => Promise<CalendarEvent>;
  deleteEvent: (id: string) => Promise<void>;
  sendAgentMessage: (message: string) => Promise<void>;
  getWeekRange: () => { start: Date; end: Date };
}

function getWeekRange(offset: number) {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(now);
  monday.setDate(diff + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 7);
  return { start: monday, end: sunday };
}

let msgCounter = 0;

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  weekOffset: 0,
  events: [],
  loading: false,
  agentMessages: [],
  agentStreaming: false,
  agentStreamContent: '',

  getWeekRange: () => getWeekRange(get().weekOffset),

  loadWeekEvents: async () => {
    const { start, end } = getWeekRange(get().weekOffset);
    set({ loading: true });
    try {
      const resp = await fetch(
        `${API_BASE}/api/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`,
      );
      if (resp.ok) {
        const data = await resp.json();
        set({ events: data });
      }
    } catch {
      // non-critical
    } finally {
      set({ loading: false });
    }
  },

  prevWeek: () => {
    set((s) => ({ weekOffset: s.weekOffset - 1 }));
    get().loadWeekEvents();
  },
  nextWeek: () => {
    set((s) => ({ weekOffset: s.weekOffset + 1 }));
    get().loadWeekEvents();
  },
  goToday: () => {
    set({ weekOffset: 0 });
    get().loadWeekEvents();
  },

  createEvent: async (ev) => {
    const resp = await fetch(`${API_BASE}/api/calendar/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ev),
    });
    const created = await resp.json();
    get().loadWeekEvents();
    return created;
  },

  deleteEvent: async (id) => {
    await fetch(`${API_BASE}/api/calendar/events/${id}`, { method: 'DELETE' });
    get().loadWeekEvents();
  },

  sendAgentMessage: async (message) => {
    const userMsg: AgentMessage = {
      id: `msg-${++msgCounter}`,
      role: 'user',
      content: message,
    };
    set((s) => ({
      agentMessages: [...s.agentMessages, userMsg],
      agentStreaming: true,
      agentStreamContent: '',
    }));

    try {
      const resp = await fetch(`${API_BASE}/api/calendar/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let createdEvent: CalendarEvent | null = null;

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content && !data.created_event) {
                  fullContent += data.content;
                  set({ agentStreamContent: fullContent });
                }
                if (data.created_event) {
                  createdEvent = data.created_event;
                  fullContent = data.content || fullContent;
                }
              } catch {
                // skip
              }
            }
          }
        }
      }

      const assistantMsg: AgentMessage = {
        id: `msg-${++msgCounter}`,
        role: 'assistant',
        content: fullContent,
        createdEvent,
      };
      set((s) => ({
        agentMessages: [...s.agentMessages, assistantMsg],
        agentStreaming: false,
        agentStreamContent: '',
      }));

      // Reload events if one was created
      if (createdEvent) {
        get().loadWeekEvents();
      }
    } catch {
      set({ agentStreaming: false, agentStreamContent: '' });
    }
  },
}));
