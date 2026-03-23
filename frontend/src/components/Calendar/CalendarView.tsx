import { useEffect } from 'react';
import { useCalendarStore } from '@/stores/calendarStore';
import type { CalendarEvent } from '@/stores/calendarStore';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Calendar, Trash2 } from 'lucide-react';

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8); // 8:00 — 19:00
const DAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function CalendarView() {
  const loadEvents = useCalendarStore((s) => s.loadWeekEvents);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <WeekHeader />
      <WeekGrid />
    </div>
  );
}

// ── Week Header ──

function WeekHeader() {
  const prevWeek = useCalendarStore((s) => s.prevWeek);
  const nextWeek = useCalendarStore((s) => s.nextWeek);
  const goToday = useCalendarStore((s) => s.goToday);
  const getWeekRange = useCalendarStore((s) => s.getWeekRange);

  const { start } = getWeekRange();
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const label = `${start.getDate()} ${MONTHS_RU[start.getMonth()]} — ${end.getDate()} ${MONTHS_RU[end.getMonth()]} ${end.getFullYear()}`;

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 shrink-0">
      <Calendar className="h-4 w-4 text-primary" strokeWidth={1.5} />
      <span className="text-sm font-medium">{label}</span>
      <p className="text-[10px] text-muted-foreground/50">
        Добавляйте встречи через чат
      </p>
      <div className="ml-auto flex items-center gap-1">
        <button onClick={goToday} className="rounded px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-accent transition-colors">
          Сегодня
        </button>
        <button onClick={prevWeek} className="rounded p-1 text-muted-foreground hover:bg-accent transition-colors">
          <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <button onClick={nextWeek} className="rounded p-1 text-muted-foreground hover:bg-accent transition-colors">
          <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

// ── Week Grid ──

function WeekGrid() {
  const events = useCalendarStore((s) => s.events);
  const deleteEvent = useCalendarStore((s) => s.deleteEvent);
  const getWeekRange = useCalendarStore((s) => s.getWeekRange);
  const { start } = getWeekRange();

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Day headers */}
      <div className="sticky top-0 z-10 grid grid-cols-[50px_repeat(7,1fr)] border-b border-border bg-card/80 backdrop-blur">
        <div />
        {days.map((d, i) => {
          const isToday = d.getTime() === today.getTime();
          return (
            <div key={i} className={cn(
              'text-center py-2 text-xs border-l border-border/30',
              isToday ? 'text-primary font-semibold' : 'text-muted-foreground',
            )}>
              <div>{DAYS_RU[i]}</div>
              <div className={cn(
                'mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs',
                isToday && 'bg-primary text-primary-foreground',
              )}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div className="grid grid-cols-[50px_repeat(7,1fr)]">
        {HOURS.map((hour) => (
          <div key={hour} className="contents">
            <div className="h-14 border-b border-border/20 pr-2 pt-0.5 text-right text-[10px] text-muted-foreground/50">
              {hour}:00
            </div>
            {days.map((d, di) => {
              const cellStart = new Date(d);
              cellStart.setHours(hour, 0, 0, 0);
              const cellEnd = new Date(cellStart);
              cellEnd.setHours(hour + 1);

              const cellEvents = events.filter((ev) => {
                const evStart = new Date(ev.start_time);
                const evEnd = new Date(ev.end_time);
                return evStart < cellEnd && evEnd > cellStart;
              });

              return (
                <div key={di} className="relative h-14 border-b border-l border-border/20">
                  {cellEvents.map((ev) => (
                    <EventChip
                      key={ev.id}
                      event={ev}
                      cellStart={cellStart}
                      onDelete={() => deleteEvent(ev.id)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Event Chip ──

function EventChip({
  event,
  cellStart,
  onDelete,
}: {
  event: CalendarEvent;
  cellStart: Date;
  onDelete: () => void;
}) {
  const evStart = new Date(event.start_time);
  const topOffset = Math.max(0, (evStart.getMinutes() / 60) * 100);

  return (
    <div
      className="group absolute inset-x-0.5 z-10 flex items-start gap-1 rounded px-1.5 py-0.5 text-[10px] leading-tight cursor-default overflow-hidden"
      style={{
        top: `${topOffset}%`,
        backgroundColor: `${event.color}20`,
        borderLeft: `2px solid ${event.color}`,
      }}
    >
      <span className="truncate font-medium" style={{ color: event.color }}>
        {event.title}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="ml-auto hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-red-400 group-hover:block"
      >
        <Trash2 className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}
