import { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCalendarStore, type CalendarEvent } from '@/stores/calendarStore';
import { cn } from '@/lib/utils';

const DAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function formatWeekRange(start: Date, end: Date): string {
  const s = start.getDate();
  const e = new Date(end.getTime() - 86400000).getDate();
  const month = MONTHS_RU[start.getMonth()];
  return `${s}–${e} ${month}`;
}

function groupByDay(events: CalendarEvent[], start: Date): { date: Date; dayLabel: string; events: CalendarEvent[] }[] {
  const days: { date: Date; dayLabel: string; events: CalendarEvent[] }[] = [];

  for (let i = 0; i < 7; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dayEvents = events
      .filter((ev) => ev.start_time.startsWith(dateStr))
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

    const dayOfWeek = DAYS_RU[(date.getDay() + 6) % 7]; // Mon=0
    const dayLabel = `${dayOfWeek} ${date.getDate()}`;

    days.push({ date, dayLabel, events: dayEvents });
  }

  return days;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

/**
 * Compact linear calendar list for Inspect Panel.
 * Grouped by day, one line per event. No grid.
 */
export function CompactCalendarList() {
  const events = useCalendarStore((s) => s.events);
  const loading = useCalendarStore((s) => s.loading);
  const prevWeek = useCalendarStore((s) => s.prevWeek);
  const nextWeek = useCalendarStore((s) => s.nextWeek);
  const getWeekRange = useCalendarStore((s) => s.getWeekRange);
  const loadWeekEvents = useCalendarStore((s) => s.loadWeekEvents);

  useEffect(() => {
    loadWeekEvents();
  }, [loadWeekEvents]);

  const { start, end } = getWeekRange();
  const days = groupByDay(events, start);

  const isToday = (date: Date) => {
    const now = new Date();
    return date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Navigation header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <button onClick={prevWeek} className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-[13px] font-medium text-muted-foreground">
          {formatWeekRange(start, end)}
        </span>
        <button onClick={nextWeek} className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-4 py-8 text-center text-[13px] text-muted-foreground/30">
            Loading...
          </div>
        )}

        {!loading && days.map(({ date, dayLabel, events: dayEvents }) => (
          <div key={dayLabel} className="border-b border-border/50 last:border-0">
            {/* Day header */}
            <div className={cn(
              'px-4 py-2 text-[12px] font-medium tracking-wide',
              isToday(date) ? 'text-foreground' : 'text-muted-foreground/50',
            )}>
              {dayLabel}
              {isToday(date) && <span className="ml-2 text-[10px] text-muted-foreground/40">today</span>}
            </div>

            {/* Events */}
            {dayEvents.length === 0 ? (
              <div className="px-4 pb-2 text-[12px] text-muted-foreground/20 italic">
                (free)
              </div>
            ) : (
              dayEvents.map((ev) => (
                <div key={ev.id} className="flex items-center gap-2 px-4 py-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-sm shrink-0"
                    style={{ backgroundColor: ev.color || 'hsl(var(--muted-foreground))' }}
                  />
                  <span className="text-[12px] font-mono text-muted-foreground/60 shrink-0 w-12">
                    {formatTime(ev.start_time)}
                  </span>
                  <span className="text-[13px] text-foreground/80 truncate">
                    {ev.title}
                  </span>
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
