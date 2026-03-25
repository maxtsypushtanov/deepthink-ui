import { create } from 'zustand';
import { API_BASE } from '@/lib/api';

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  color: string;
}

export interface CreateEventData {
  title: string;
  start_time: string;
  end_time: string;
  description?: string;
  color?: string;
}

interface CalendarStore {
  weekOffset: number;
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  briefing: string | null;
  briefingLoading: boolean;

  loadWeekEvents: () => Promise<void>;
  prevWeek: () => void;
  nextWeek: () => void;
  goToday: () => void;
  setWeekOffset: (offset: number) => void;
  createEvent: (data: CreateEventData) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  updateEvent: (id: string, patch: Partial<Pick<CalendarEvent, 'title' | 'description' | 'start_time' | 'end_time' | 'color'>>) => Promise<void>;
  getWeekRange: () => { start: Date; end: Date };
  dismissError: () => void;
  getTodayEvents: () => CalendarEvent[];
  checkConflicts: (start_time: string, end_time: string, exclude_id?: string) => CalendarEvent[];
  loadBriefing: (provider: string, model: string) => Promise<void>;
  dismissBriefing: () => void;
}

let weekAbortController: AbortController | null = null;

function getWeekRange(offset: number) {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now);
  monday.setDate(diff + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const weekEnd = new Date(monday);
  weekEnd.setDate(monday.getDate() + 7);
  return { start: monday, end: weekEnd };
}

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  weekOffset: 0,
  events: [],
  loading: false,
  error: null,
  briefing: null,
  briefingLoading: false,

  getWeekRange: () => getWeekRange(get().weekOffset),

  dismissError: () => set({ error: null }),

  getTodayEvents: () => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return get().events.filter((ev) => ev.start_time.startsWith(todayStr)).sort((a, b) => a.start_time.localeCompare(b.start_time));
  },

  loadWeekEvents: async () => {
    weekAbortController?.abort();
    weekAbortController = new AbortController();
    const signal = weekAbortController.signal;

    const { start, end } = getWeekRange(get().weekOffset);
    set({ loading: true, error: null });
    try {
      const resp = await fetch(
        `${API_BASE}/api/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`,
        { signal },
      );
      if (!resp.ok) {
        throw new Error(`Не удалось загрузить события: ${resp.statusText}`);
      }
      set({ events: await resp.json() });
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        set({ error: e.message || 'Не удалось загрузить события календаря' });
      }
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
  setWeekOffset: (offset: number) => {
    set({ weekOffset: offset });
    get().loadWeekEvents();
  },

  createEvent: async (data) => {
    set({ error: null });
    try {
      const resp = await fetch(`${API_BASE}/api/calendar/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!resp.ok) {
        throw new Error(`Не удалось создать событие: ${resp.statusText}`);
      }
      get().loadWeekEvents();
    } catch (e: any) {
      set({ error: e.message || 'Не удалось создать событие' });
    }
  },

  deleteEvent: async (id) => {
    set({ error: null });
    try {
      const resp = await fetch(`${API_BASE}/api/calendar/events/${id}`, { method: 'DELETE' });
      if (!resp.ok) {
        throw new Error(`Не удалось удалить событие: ${resp.statusText}`);
      }
      get().loadWeekEvents();
    } catch (e: any) {
      set({ error: e.message || 'Не удалось удалить событие' });
    }
  },

  checkConflicts: (start_time: string, end_time: string, exclude_id?: string): CalendarEvent[] => {
    const events = get().events;
    const newStart = new Date(start_time).getTime();
    const newEnd = new Date(end_time).getTime();
    if (newEnd <= newStart) return [];
    return events.filter((ev) => {
      if (exclude_id && ev.id === exclude_id) return false;
      const evStart = new Date(ev.start_time).getTime();
      const evEnd = new Date(ev.end_time).getTime();
      return newStart < evEnd && newEnd > evStart;
    });
  },

  updateEvent: async (id, patch) => {
    // Optimistic update
    set((s) => ({
      events: s.events.map((e) =>
        e.id === id ? { ...e, ...patch } : e
      ),
    }));
    try {
      const resp = await fetch(`${API_BASE}/api/calendar/events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!resp.ok) {
        throw new Error(`Не удалось обновить событие: ${resp.statusText}`);
      }
      // Reload to get server-validated data
      get().loadWeekEvents();
    } catch (e: any) {
      // Revert on error
      get().loadWeekEvents();
      set({ error: e.message || 'Не удалось обновить событие' });
    }
  },

  loadBriefing: async (provider, model) => {
    set({ briefingLoading: true, briefing: null });
    try {
      const resp = await fetch(`${API_BASE}/api/calendar/briefing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model }),
      });
      if (!resp.ok) throw new Error('Не удалось загрузить повестку');
      const data = await resp.json();
      set({ briefing: data.briefing || null });
    } catch (e: any) {
      set({ error: e.message || 'Ошибка загрузки повестки' });
    } finally {
      set({ briefingLoading: false });
    }
  },

  dismissBriefing: () => set({ briefing: null }),
}));
