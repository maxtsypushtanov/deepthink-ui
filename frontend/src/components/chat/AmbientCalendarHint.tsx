import { useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';
import { useCalendarStore, type CalendarEvent } from '@/stores/calendarStore';

/**
 * Passive one-liner above the composer.
 * Shows only the NEXT event if it's within 30 minutes.
 * Otherwise renders null (0px).
 */
export function AmbientCalendarHint() {
  const events = useCalendarStore((s) => s.events);
  const [nextEvent, setNextEvent] = useState<CalendarEvent | null>(null);
  const [minutesUntil, setMinutesUntil] = useState(0);

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const upcoming = events
        .filter((ev) => new Date(ev.start_time).getTime() > now)
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

      const nearest = upcoming[0];
      if (!nearest) { setNextEvent(null); return; }

      const mins = Math.round((new Date(nearest.start_time).getTime() - now) / 60000);
      if (mins <= 30) {
        setNextEvent(nearest);
        setMinutesUntil(mins);
      } else {
        setNextEvent(null);
      }
    };

    check();
    const interval = setInterval(check, 30000); // recheck every 30s
    return () => clearInterval(interval);
  }, [events]);

  // Load today's events on mount
  useEffect(() => {
    useCalendarStore.getState().loadWeekEvents();
  }, []);

  if (!nextEvent) return null;

  return (
    <div
      className="flex items-center gap-2 px-4 py-1 text-[11px] font-mono text-muted-foreground/40 animate-fade-in"
    >
      <Calendar className="w-3 h-3" />
      <span>
        Далее: {nextEvent.title} (через {minutesUntil} мин)
      </span>
    </div>
  );
}
