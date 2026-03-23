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

interface CalendarStore {
  weekOffset: number;
  events: CalendarEvent[];
  loading: boolean;

  loadWeekEvents: () => Promise<void>;
  prevWeek: () => void;
  nextWeek: () => void;
  goToday: () => void;
  deleteEvent: (id: string) => Promise<void>;
  getWeekRange: () => { start: Date; end: Date };
}

function getWeekRange(offset: number) {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now);
  monday.setDate(diff + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 7);
  return { start: monday, end: sunday };
}

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  weekOffset: 0,
  events: [],
  loading: false,

  getWeekRange: () => getWeekRange(get().weekOffset),

  loadWeekEvents: async () => {
    const { start, end } = getWeekRange(get().weekOffset);
    set({ loading: true });
    try {
      const resp = await fetch(
        `${API_BASE}/api/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`,
      );
      if (resp.ok) {
        set({ events: await resp.json() });
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

  deleteEvent: async (id) => {
    await fetch(`${API_BASE}/api/calendar/events/${id}`, { method: 'DELETE' });
    get().loadWeekEvents();
  },
}));
