import { useEffect, useRef, useState } from 'react';
import { useCalendarStore } from '@/stores/calendarStore';
import type { CalendarEvent } from '@/stores/calendarStore';
import { cn } from '@/lib/utils';
import {
  ChevronLeft, ChevronRight, Calendar, Send, Loader2,
  Trash2, Clock, CheckCircle,
} from 'lucide-react';

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
    <div className="flex h-full overflow-hidden">
      {/* Week grid */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <WeekHeader />
        <WeekGrid />
      </div>

      {/* Agent chat panel */}
      <div className="w-80 border-l border-border flex flex-col">
        <AgentChat />
      </div>
    </div>
  );
}

// ── Week Header ──

function WeekHeader() {
  const weekOffset = useCalendarStore((s) => s.weekOffset);
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
            {/* Time label */}
            <div className="h-14 border-b border-border/20 pr-2 pt-0.5 text-right text-[10px] text-muted-foreground/50">
              {hour}:00
            </div>
            {/* Day cells */}
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
                <div
                  key={di}
                  className="relative h-14 border-b border-l border-border/20"
                >
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

// ── Agent Chat Panel ──

function AgentChat() {
  const messages = useCalendarStore((s) => s.agentMessages);
  const streaming = useCalendarStore((s) => s.agentStreaming);
  const streamContent = useCalendarStore((s) => s.agentStreamContent);
  const sendMessage = useCalendarStore((s) => s.sendAgentMessage);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent]);

  function handleSend() {
    if (!input.trim() || streaming) return;
    sendMessage(input.trim());
    setInput('');
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 shrink-0">
        <Clock className="h-3.5 w-3.5 text-primary" strokeWidth={1.5} />
        <span className="text-xs font-medium">Ассистент календаря</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !streaming && (
          <div className="text-center text-xs text-muted-foreground/50 py-8">
            <p>Напишите, например:</p>
            <p className="mt-1 italic">Добавь встречу с командой на завтра</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={cn(
            'text-xs leading-relaxed',
            msg.role === 'user' ? 'text-foreground' : 'text-muted-foreground',
          )}>
            {msg.role === 'user' && (
              <div className="mb-1 text-[10px] font-medium text-muted-foreground/50">Вы</div>
            )}
            <div className="whitespace-pre-wrap">{msg.content}</div>
            {msg.createdEvent && (
              <div className="mt-1.5 flex items-center gap-1.5 rounded border border-green-500/20 bg-green-500/5 px-2 py-1">
                <CheckCircle className="h-3 w-3 text-green-400" strokeWidth={1.5} />
                <span className="text-green-400 font-medium">{msg.createdEvent.title}</span>
              </div>
            )}
          </div>
        ))}

        {streaming && streamContent && (
          <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {streamContent}
            <span className="inline-block w-1 h-3 ml-0.5 animate-pulse bg-muted-foreground/30" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Добавить встречу..."
            disabled={streaming}
            className={cn(
              'flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs',
              'placeholder:text-muted-foreground/40',
              'focus:outline-none focus:ring-1 focus:ring-ring/30',
            )}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className={cn(
              'rounded-lg p-1.5 transition-colors',
              input.trim() && !streaming
                ? 'text-primary hover:bg-primary/10'
                : 'text-muted-foreground/30 cursor-not-allowed',
            )}
          >
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
            ) : (
              <Send className="h-4 w-4" strokeWidth={1.5} />
            )}
          </button>
        </div>
      </div>
    </>
  );
}
