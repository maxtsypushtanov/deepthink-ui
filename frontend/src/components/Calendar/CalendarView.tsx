import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useCalendarStore } from '@/stores/calendarStore';
import type { CalendarEvent } from '@/stores/calendarStore';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Calendar, CalendarDays, Trash2, GripVertical, X, AlertCircle, Clock, Save, ListChecks, AlertTriangle, Sparkles, Loader2 } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { CalendarChat } from './CalendarChat';

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 8:00 — 20:00
const HOUR_HEIGHT = 56; // px per hour cell (h-14)
const WORK_DAYS = 5;
const DAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];
const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const PRESET_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#6b7280'];

const MONTHS_RU_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const DAYS_RU_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Compute side-by-side layout for overlapping events in a single day column. */
function computeOverlapLayout(events: CalendarEvent[]): Map<string, { left: number; width: number; hasOverlap: boolean }> {
  const result = new Map<string, { left: number; width: number; hasOverlap: boolean }>();
  if (events.length === 0) return result;

  // Sort by start time, then by duration (longer first)
  const sorted = [...events].sort((a, b) => {
    const cmp = a.start_time.localeCompare(b.start_time);
    if (cmp !== 0) return cmp;
    // Longer events first
    const durA = new Date(a.end_time).getTime() - new Date(a.start_time).getTime();
    const durB = new Date(b.end_time).getTime() - new Date(b.start_time).getTime();
    return durB - durA;
  });

  // Build overlap groups using a sweep approach
  const columns: { event: CalendarEvent; col: number }[] = [];
  const endTimes: number[] = []; // track end time per column

  for (const ev of sorted) {
    const evStart = new Date(ev.start_time).getTime();
    // Find the first available column
    let col = -1;
    for (let c = 0; c < endTimes.length; c++) {
      if (endTimes[c] <= evStart) {
        col = c;
        break;
      }
    }
    if (col === -1) {
      col = endTimes.length;
      endTimes.push(0);
    }
    endTimes[col] = new Date(ev.end_time).getTime();
    columns.push({ event: ev, col });
  }

  // Now compute max overlapping columns for each event's time range
  for (const item of columns) {
    const evStart = new Date(item.event.start_time).getTime();
    const evEnd = new Date(item.event.end_time).getTime();
    // Find all events that overlap with this one
    let maxCol = item.col;
    for (const other of columns) {
      const otherStart = new Date(other.event.start_time).getTime();
      const otherEnd = new Date(other.event.end_time).getTime();
      if (otherStart < evEnd && otherEnd > evStart) {
        maxCol = Math.max(maxCol, other.col);
      }
    }
    const totalCols = maxCol + 1;
    const hasOverlap = totalCols > 1;
    // left and width as percentages (with small gap)
    const gapPx = hasOverlap ? 1 : 0; // percentage gap
    const width = (100 - gapPx * (totalCols - 1)) / totalCols;
    const left = item.col * (width + gapPx);
    result.set(item.event.id, { left, width, hasOverlap });
  }

  return result;
}

function pad2(n: number) { return String(n).padStart(2, '0'); }
function timeStr(h: number, m: number) { return `${pad2(h)}:${pad2(m)}`; }

/** Format a local Date as ISO string without timezone conversion. */
function localISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function CalendarView() {
  const loadEvents = useCalendarStore((s) => s.loadWeekEvents);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <WeekHeader />
      <QuickStatsBar />
      <ErrorBanner />
      <LoadingBar />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <WeekGrid />
          </div>
          <CalendarChat />
        </div>
        <TodayAgendaPanel />
      </div>
    </div>
  );
}

// ── Quick Stats Summary Bar ──

function QuickStatsBar() {
  const getTodayEvents = useCalendarStore((s) => s.getTodayEvents);
  const weekOffset = useCalendarStore((s) => s.weekOffset);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Only show on current week
  if (weekOffset !== 0) return null;

  const todayEvents = getTodayEvents();
  const meetingCount = todayEvents.length;

  // Calculate free time between 8:00 and 20:00
  const workStart = 8 * 60; // minutes
  const workEnd = 20 * 60;
  let busyMinutes = 0;
  for (const ev of todayEvents) {
    const s = new Date(ev.start_time);
    const e = new Date(ev.end_time);
    const startMin = Math.max(s.getHours() * 60 + s.getMinutes(), workStart);
    const endMin = Math.min(e.getHours() * 60 + e.getMinutes(), workEnd);
    if (endMin > startMin) busyMinutes += endMin - startMin;
  }
  const freeMinutes = Math.max(0, (workEnd - workStart) - busyMinutes);
  const freeH = Math.floor(freeMinutes / 60);
  const freeM = freeMinutes % 60;
  const freeStr = freeH > 0 && freeM > 0
    ? `${freeH}ч ${freeM}мин`
    : freeH > 0 ? `${freeH}ч` : `${freeM}мин`;

  // Find next upcoming event
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let nextLabel = '';
  for (const ev of todayEvents) {
    const s = new Date(ev.start_time);
    const evMin = s.getHours() * 60 + s.getMinutes();
    if (evMin > nowMinutes) {
      const diff = evMin - nowMinutes;
      const dH = Math.floor(diff / 60);
      const dM = diff % 60;
      const timeAgo = dH > 0 ? `${dH}ч ${dM}мин` : `${dM}мин`;
      nextLabel = `${ev.title} через ${timeAgo}`;
      break;
    }
  }

  if (meetingCount === 0 && !nextLabel) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-xs text-muted-foreground bg-muted/30 border-b border-border/30 shrink-0">
      <span>Сегодня: <span className="font-medium text-foreground/80">{meetingCount} {meetingCount === 1 ? 'встреча' : meetingCount >= 2 && meetingCount <= 4 ? 'встречи' : 'встреч'}</span></span>
      <span className="text-border">·</span>
      <span>Свободно: <span className="font-medium text-foreground/80">{freeStr}</span></span>
      {nextLabel && (
        <>
          <span className="text-border">·</span>
          <span>Следующая: <span className="font-medium text-foreground/80">{nextLabel}</span></span>
        </>
      )}
    </div>
  );
}

// ── Error Banner ──

function ErrorBanner() {
  const error = useCalendarStore((s) => s.error);
  const dismiss = useCalendarStore((s) => s.dismissError);

  if (!error) return null;

  return (
    <div className="flex items-center gap-2 bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-sm text-red-400 shrink-0 animate-in slide-in-from-top-1 duration-200">
      <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.5} />
      <span className="flex-1 truncate">{error}</span>
      <button onClick={dismiss} className="shrink-0 rounded p-0.5 hover:bg-red-500/20 transition-colors">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Loading Bar ──

function LoadingBar() {
  const loading = useCalendarStore((s) => s.loading);
  if (!loading) return null;
  return (
    <div className="h-0.5 w-full overflow-hidden bg-primary/10 shrink-0">
      <div className="h-full w-1/3 bg-primary/60 animate-pulse rounded-full" style={{ animation: 'loading-slide 1.2s ease-in-out infinite' }} />
      <style>{`
        @keyframes loading-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}

// ── Week Header (with event dots) ──

function WeekHeader() {
  const prevWeek = useCalendarStore((s) => s.prevWeek);
  const nextWeek = useCalendarStore((s) => s.nextWeek);
  const goToday = useCalendarStore((s) => s.goToday);
  const setWeekOffset = useCalendarStore((s) => s.setWeekOffset);
  const getWeekRange = useCalendarStore((s) => s.getWeekRange);
  const weekOffset = useCalendarStore((s) => s.weekOffset);
  const events = useCalendarStore((s) => s.events);
  const [miniCalOpen, setMiniCalOpen] = useState(false);

  const { start } = getWeekRange();
  const end = new Date(start);
  end.setDate(start.getDate() + WORK_DAYS - 1);

  const label = `${start.getDate()} ${MONTHS_RU[start.getMonth()]} — ${end.getDate()} ${MONTHS_RU[end.getMonth()]} ${end.getFullYear()}`;

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  const days = useMemo(() => Array.from({ length: WORK_DAYS }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  }), [start.getTime()]);

  // Count events per day
  const eventCounts = useMemo(() => {
    const counts = days.map(() => 0);
    for (const ev of events) {
      const evStart = new Date(ev.start_time);
      for (let i = 0; i < days.length; i++) {
        const d = days[i];
        if (
          evStart.getFullYear() === d.getFullYear() &&
          evStart.getMonth() === d.getMonth() &&
          evStart.getDate() === d.getDate()
        ) {
          counts[i]++;
          break;
        }
      }
    }
    return counts;
  }, [events, days]);

  const handleMiniCalNav = useCallback((targetDate: Date) => {
    // Compute week offset from today to the week containing targetDate
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const thisMonday = new Date(now);
    thisMonday.setDate(diff);
    thisMonday.setHours(0, 0, 0, 0);

    const targetDay = targetDate.getDay();
    const targetDiff = targetDate.getDate() - targetDay + (targetDay === 0 ? -6 : 1);
    const targetMonday = new Date(targetDate);
    targetMonday.setDate(targetDiff);
    targetMonday.setHours(0, 0, 0, 0);

    const diffMs = targetMonday.getTime() - thisMonday.getTime();
    const newOffset = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
    setWeekOffset(newOffset);
    setMiniCalOpen(false);
  }, [setWeekOffset]);

  return (
    <div className="border-b border-border shrink-0 relative">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Calendar className="h-4 w-4 text-primary" strokeWidth={1.5} />
        <span className="text-sm font-medium">{label}</span>
        <p className="text-[10px] text-muted-foreground/50 hidden sm:block">
          Нажмите на пустую ячейку для создания события
        </p>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setMiniCalOpen((v) => !v)}
            className={cn(
              'rounded p-1 text-muted-foreground hover:bg-accent transition-colors',
              miniCalOpen && 'bg-accent text-foreground',
            )}
            title="Навигатор по месяцу"
          >
            <CalendarDays className="h-4 w-4" strokeWidth={1.5} />
          </button>
          {weekOffset !== 0 && (
            <button onClick={goToday} className="rounded px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-accent transition-colors">
              Сегодня
            </button>
          )}
          <button onClick={prevWeek} className="rounded p-1 text-muted-foreground hover:bg-accent transition-colors">
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button onClick={nextWeek} className="rounded p-1 text-muted-foreground hover:bg-accent transition-colors">
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>
      {miniCalOpen && (
        <MiniMonthNavigator
          currentWeekStart={start}
          today={today}
          onSelectDate={handleMiniCalNav}
          onClose={() => setMiniCalOpen(false)}
        />
      )}
    </div>
  );
}

// ── Mini Month Navigator ──

function MiniMonthNavigator({
  currentWeekStart,
  today,
  onSelectDate,
  onClose,
}: {
  currentWeekStart: Date;
  today: Date;
  onSelectDate: (date: Date) => void;
  onClose: () => void;
}) {
  const [viewMonth, setViewMonth] = useState(currentWeekStart.getMonth());
  const [viewYear, setViewYear] = useState(currentWeekStart.getFullYear());
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  // Build 6x7 grid of dates for the month
  const grid = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    let startDow = firstDay.getDay(); // 0=Sun
    startDow = startDow === 0 ? 6 : startDow - 1; // convert to Mon=0

    const cells: (Date | null)[] = [];
    // Fill leading blanks
    for (let i = 0; i < startDow; i++) {
      const d = new Date(viewYear, viewMonth, 1 - (startDow - i));
      cells.push(d);
    }
    // Fill days of month
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(viewYear, viewMonth, d));
    }
    // Fill trailing to 42 cells (6 rows)
    while (cells.length < 42) {
      const lastDate = cells[cells.length - 1]!;
      const next = new Date(lastDate);
      next.setDate(next.getDate() + 1);
      cells.push(next);
    }
    return cells;
  }, [viewYear, viewMonth]);

  // Current viewed week range for highlighting
  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(currentWeekStart.getDate() + 6);

  const isInViewedWeek = (d: Date) => {
    const t = d.getTime();
    return t >= currentWeekStart.getTime() && t <= weekEnd.getTime();
  };

  const isToday = (d: Date) =>
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();

  const isCurrentMonth = (d: Date) => d.getMonth() === viewMonth;

  return (
    <div
      ref={containerRef}
      className="absolute right-4 top-full mt-1 z-50 rounded-xl border border-border bg-card shadow-xl p-3 w-[220px] animate-in fade-in slide-in-from-top-2 duration-150"
    >
      {/* Month header with arrows */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={prevMonth} className="rounded p-0.5 text-muted-foreground hover:bg-accent transition-colors">
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <span className="text-xs font-medium">
          {MONTHS_RU_FULL[viewMonth]} {viewYear}
        </span>
        <button onClick={nextMonth} className="rounded p-0.5 text-muted-foreground hover:bg-accent transition-colors">
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-0 mb-0.5">
        {DAYS_RU_SHORT.map((d) => (
          <div key={d} className="text-center text-[9px] text-muted-foreground/60 font-medium py-0.5">
            {d}
          </div>
        ))}
      </div>
      {/* Date cells */}
      <div className="grid grid-cols-7 gap-0">
        {grid.map((date, i) => {
          if (!date) return <div key={i} />;
          const inWeek = isInViewedWeek(date);
          const isTd = isToday(date);
          const inMonth = isCurrentMonth(date);
          return (
            <button
              key={i}
              onClick={() => onSelectDate(date)}
              className={cn(
                'h-6 w-full flex items-center justify-center text-[10px] rounded transition-colors',
                !inMonth && 'text-muted-foreground/30',
                inMonth && !inWeek && !isTd && 'text-muted-foreground hover:bg-accent',
                inWeek && !isTd && 'bg-primary/10 text-primary font-medium',
                isTd && 'bg-primary text-primary-foreground font-bold rounded-full',
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Today's Agenda Panel ──

/** Render markdown-like briefing text as clean JSX (no raw ** or # symbols). */
function BriefingContent({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Skip empty lines (handled as spacing between blocks)
    if (!trimmed) continue;

    // Heading: # or ## or ### → bold with slight size bump
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      elements.push(
        <p key={i} className="text-[11px] font-semibold text-foreground mt-2 mb-0.5 first:mt-0">
          {cleanInline(headingMatch[1])}
        </p>
      );
      continue;
    }

    // Numbered list: 1. or 1) → clean item
    const numMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numMatch) {
      elements.push(
        <p key={i} className="text-[10px] leading-relaxed text-muted-foreground pl-1 mt-1">
          {cleanInline(numMatch[1])}
        </p>
      );
      continue;
    }

    // Bullet list: - or * or • → clean item
    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      elements.push(
        <p key={i} className="text-[10px] leading-relaxed text-muted-foreground pl-2 mt-0.5">
          <span className="text-primary/50 mr-1">·</span>
          {cleanInline(bulletMatch[1])}
        </p>
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={i} className="text-[10px] leading-relaxed text-muted-foreground mt-1 first:mt-0">
        {cleanInline(trimmed)}
      </p>
    );
  }

  return <div className="pr-4">{elements}</div>;
}

/** Convert inline markdown to clean text with styled spans. */
function cleanInline(text: string): React.ReactNode {
  // Process bold (**text** or __text__) and italic (*text* or _text_)
  const parts: React.ReactNode[] = [];
  // Split by **bold** first, then *italic*
  const boldRegex = /\*\*(.+?)\*\*|__(.+?)__/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = boldRegex.exec(text)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      parts.push(cleanItalic(text.slice(lastIndex, match.index), `pre-${match.index}`));
    }
    const boldText = match[1] || match[2];
    parts.push(
      <span key={`b-${match.index}`} className="font-semibold text-foreground">{boldText}</span>
    );
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last bold
  if (lastIndex < text.length) {
    parts.push(cleanItalic(text.slice(lastIndex), `end-${lastIndex}`));
  }

  return parts.length === 0 ? text : parts;
}

function cleanItalic(text: string, keyPrefix: string): React.ReactNode {
  const italicRegex = /\*(.+?)\*|_(.+?)_/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = italicRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(stripLeftover(text.slice(lastIndex, match.index), `${keyPrefix}-${match.index}`));
    }
    const italicText = match[1] || match[2];
    parts.push(
      <span key={`i-${keyPrefix}-${match.index}`} className="italic">{italicText}</span>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(stripLeftover(text.slice(lastIndex), `${keyPrefix}-end`));
  }

  return parts.length === 0 ? stripLeftover(text, keyPrefix) : parts;
}

/** Remove any remaining markdown artifacts (`backticks`, stray *, #, etc.) */
function stripLeftover(text: string, key: string): React.ReactNode {
  const cleaned = text
    .replace(/`([^`]+)`/g, '$1')  // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // links → text only
    .replace(/^#+\s*/gm, '')  // stray heading markers
    .replace(/\*+/g, '')  // stray asterisks
    .replace(/_+/g, ' ')  // stray underscores (not in words)
    .replace(/~~/g, '');  // strikethrough markers
  return <span key={key}>{cleaned}</span>;
}

function TodayAgendaPanel() {
  const getTodayEvents = useCalendarStore((s) => s.getTodayEvents);
  const weekOffset = useCalendarStore((s) => s.weekOffset);
  const briefing = useCalendarStore((s) => s.briefing);
  const briefingLoading = useCalendarStore((s) => s.briefingLoading);
  const loadBriefing = useCalendarStore((s) => s.loadBriefing);
  const dismissBriefing = useCalendarStore((s) => s.dismissBriefing);
  const provider = useChatStore((s) => s.settings.provider);
  const model = useChatStore((s) => s.settings.model);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  if (weekOffset !== 0) return null;

  const todayEvents = getTodayEvents();
  const nowMs = now.getTime();

  return (
    <div className="hidden lg:flex flex-col w-[220px] shrink-0 border-l border-border bg-card/50 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
        <ListChecks className="h-3.5 w-3.5 text-primary" strokeWidth={1.5} />
        <span className="text-xs font-medium text-foreground">Повестка дня</span>
      </div>

      {/* Events list */}
      <div className="px-3 pb-2">
        {todayEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 italic py-1">Нет встреч — свободный день!</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {todayEvents.map((ev) => {
              const s = new Date(ev.start_time);
              const e = new Date(ev.end_time);
              const isActive = nowMs >= s.getTime() && nowMs < e.getTime();
              const isPast = nowMs >= e.getTime();
              return (
                <div
                  key={ev.id}
                  className={cn(
                    'rounded-md px-2 py-1.5 text-xs transition-colors',
                    isActive
                      ? 'bg-primary/10 border border-primary/30'
                      : isPast
                        ? 'opacity-50 border border-transparent'
                        : 'bg-muted/30 border border-transparent',
                  )}
                >
                  <div className="font-medium truncate" style={isActive ? { color: ev.color } : undefined}>
                    {isPast ? '✓ ' : isActive ? '● ' : ''}{ev.title}
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 flex items-center gap-0.5 mt-0.5">
                    <Clock className="h-2.5 w-2.5" />
                    {pad2(s.getHours())}:{pad2(s.getMinutes())} — {pad2(e.getHours())}:{pad2(e.getMinutes())}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Divider + briefing section */}
      <div className="border-t border-border/50 mt-1 px-3 pt-2 pb-3">
        {!briefing ? (
          <button
            onClick={() => loadBriefing(provider, model)}
            disabled={briefingLoading}
            className={cn(
              'flex items-center gap-1.5 w-full rounded-lg px-2.5 py-2 text-[10px] font-medium transition-all',
              briefingLoading
                ? 'bg-primary/5 text-primary/60'
                : 'bg-primary/10 text-primary hover:bg-primary/20',
            )}
          >
            {briefingLoading
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Sparkles className="h-3 w-3" />}
            {briefingLoading ? 'Генерирую повестку...' : 'AI повестка дня'}
          </button>
        ) : (
          <div className="relative">
            <button
              onClick={dismissBriefing}
              className="absolute top-0 right-0 z-10 rounded p-0.5 text-muted-foreground/40 hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
            <BriefingContent text={briefing} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Drag state ──

interface DragState {
  eventId: string;
  event: CalendarEvent;
  offsetY: number;
}

// ── Resize state ──

interface ResizeState {
  eventId: string;
  event: CalendarEvent;
  startY: number;
  originalEndTime: string;
}

// ── Inline creation form state ──

interface CreationForm {
  dayIdx: number;
  hour: number;
  minutes: number;
  topPx: number;
  leftCss: string;
  autoFocus?: boolean;
}

// ── Edit popup state ──

interface EditPopup {
  event: CalendarEvent;
  topPx: number;
  leftCss: string;
}

// ── Week Grid ──

function WeekGrid() {
  const events = useCalendarStore((s) => s.events);
  const deleteEvent = useCalendarStore((s) => s.deleteEvent);
  const updateEvent = useCalendarStore((s) => s.updateEvent);
  const createEvent = useCalendarStore((s) => s.createEvent);
  const getWeekRange = useCalendarStore((s) => s.getWeekRange);
  const weekOffset = useCalendarStore((s) => s.weekOffset);
  const { start } = getWeekRange();

  const gridRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropPreview, setDropPreview] = useState<{ dayIdx: number; hour: number; minutes: number } | null>(null);
  const [creationForm, setCreationForm] = useState<CreationForm | null>(null);
  const [editPopup, setEditPopup] = useState<EditPopup | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [resizePreviewEndMin, setResizePreviewEndMin] = useState<number | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [justDroppedId, setJustDroppedId] = useState<string | null>(null);

  // Listen for chat-triggered flash events
  useEffect(() => {
    const handler = (e: Event) => {
      const eventId = (e as CustomEvent).detail;
      if (typeof eventId === 'string') {
        setJustDroppedId(eventId);
        setTimeout(() => setJustDroppedId(null), 2000);
      }
    };
    window.addEventListener('calendar:flash-event', handler);
    return () => window.removeEventListener('calendar:flash-event', handler);
  }, []);

  const days = useMemo(() => Array.from({ length: WORK_DAYS }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  }), [start.getTime()]);

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  // Event layout per day column
  const dayEvents = useMemo(() => {
    const map: CalendarEvent[][] = days.map(() => []);
    for (const ev of events) {
      const evStart = new Date(ev.start_time);
      for (let i = 0; i < days.length; i++) {
        const d = days[i];
        if (
          evStart.getFullYear() === d.getFullYear() &&
          evStart.getMonth() === d.getMonth() &&
          evStart.getDate() === d.getDate()
        ) {
          map[i].push(ev);
          break;
        }
      }
    }
    return map;
  }, [events, days]);

  // Count events per day (for header dots)
  const eventCounts = useMemo(() => {
    return dayEvents.map((evs) => evs.length);
  }, [dayEvents]);

  // Convert pixel position in grid to day/hour/minutes (snapped to 15-min)
  const posToTime = useCallback((clientX: number, clientY: number): { dayIdx: number; hour: number; minutes: number } | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top + grid.scrollTop;

    const colWidth = (rect.width - 50) / WORK_DAYS;
    const dayIdx = Math.floor((x - 50) / colWidth);
    if (dayIdx < 0 || dayIdx >= WORK_DAYS) return null;

    // Total minutes from midnight, snapped to 15-min grid
    const rawMinutes = (y / HOUR_HEIGHT) * 60 + HOURS[0] * 60;
    const snapped = Math.round(rawMinutes / 15) * 15;
    const hour = Math.floor(snapped / 60);
    const minutes = snapped % 60;

    if (hour < HOURS[0] || hour > HOURS[HOURS.length - 1]) return null;
    return { dayIdx, hour, minutes };
  }, []);

  // Convert clientY to absolute minutes (for resize, snapped to 15-min)
  const yToMinutes = useCallback((clientY: number): number => {
    const grid = gridRef.current;
    if (!grid) return 0;
    const rect = grid.getBoundingClientRect();
    const y = clientY - rect.top + grid.scrollTop;
    const rawMinutes = (y / HOUR_HEIGHT) * 60 + HOURS[0] * 60;
    return Math.round(rawMinutes / 15) * 15;
  }, []);

  // ── Click-to-create on empty area (with double-click differentiation) ──

  const handleGridClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-event-chip]') || target.closest('[data-popup]') || target.closest('[data-resize-handle]')) return;

    if (editPopup) {
      setEditPopup(null);
      return;
    }

    // Clear any pending single-click timer (double-click will handle it)
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    const pos = posToTime(e.clientX, e.clientY);
    if (!pos) return;

    const topPx = ((pos.hour - HOURS[0]) + pos.minutes / 60) * HOUR_HEIGHT;
    const leftCss = `calc(50px + ${pos.dayIdx} * ((100% - 50px) / ${WORK_DAYS}))`;

    // Delay single-click to allow double-click detection
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      setCreationForm({ dayIdx: pos.dayIdx, hour: pos.hour, minutes: pos.minutes, topPx, leftCss });
      setEditPopup(null);
    }, 200);
  }, [posToTime, editPopup]);

  const handleGridDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-event-chip]') || target.closest('[data-popup]') || target.closest('[data-resize-handle]')) return;

    // Cancel pending single-click
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    const pos = posToTime(e.clientX, e.clientY);
    if (!pos) return;

    const topPx = ((pos.hour - HOURS[0]) + pos.minutes / 60) * HOUR_HEIGHT;
    const leftCss = `calc(50px + ${pos.dayIdx} * ((100% - 50px) / ${WORK_DAYS}))`;

    setCreationForm({ dayIdx: pos.dayIdx, hour: pos.hour, minutes: pos.minutes, topPx, leftCss, autoFocus: true });
    setEditPopup(null);
  }, [posToTime]);

  // ── Keyboard shortcut: N to create event at current time ──

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'n' || e.key === 'N' || e.key === 'т' || e.key === 'Т') {
        // Ignore if inside an input/textarea or form
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if ((e.target as HTMLElement).isContentEditable) return;

        e.preventDefault();
        const now = new Date();
        const hour = now.getHours();
        const minutes = Math.round(now.getMinutes() / 15) * 15;
        const adjustedHour = minutes === 60 ? hour + 1 : hour;
        const adjustedMinutes = minutes === 60 ? 0 : minutes;

        if (adjustedHour < HOURS[0] || adjustedHour > HOURS[HOURS.length - 1]) return;

        // Find today's column index
        const todayDate = new Date();
        todayDate.setHours(0, 0, 0, 0);
        let dayIdx = -1;
        for (let i = 0; i < days.length; i++) {
          if (days[i].getTime() === todayDate.getTime()) {
            dayIdx = i;
            break;
          }
        }
        if (dayIdx === -1) return; // today not visible

        const topPx = ((adjustedHour - HOURS[0]) + adjustedMinutes / 60) * HOUR_HEIGHT;
        const leftCss = `calc(50px + ${dayIdx} * ((100% - 50px) / ${WORK_DAYS}))`;
        setCreationForm({ dayIdx, hour: adjustedHour, minutes: adjustedMinutes, topPx, leftCss, autoFocus: true });
        setEditPopup(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [days]);

  // ── Event click (edit popup) ──

  const handleEventClick = useCallback((ev: CalendarEvent) => {
    const evStart = new Date(ev.start_time);
    const startHour = evStart.getHours() + evStart.getMinutes() / 60;
    const topPx = (startHour - HOURS[0]) * HOUR_HEIGHT;

    let dayIdx = 0;
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (evStart.getFullYear() === d.getFullYear() && evStart.getMonth() === d.getMonth() && evStart.getDate() === d.getDate()) {
        dayIdx = i;
        break;
      }
    }

    const leftCss = `calc(50px + ${dayIdx} * ((100% - 50px) / ${WORK_DAYS}))`;
    setEditPopup({ event: ev, topPx, leftCss });
    setCreationForm(null);
  }, [days]);

  // ── Create event submit ──

  const handleCreateSubmit = useCallback((title: string, startH: number, startM: number, endH: number, endM: number, dayIdx: number) => {
    const day = days[dayIdx];
    const startDate = new Date(day);
    startDate.setHours(startH, startM, 0, 0);
    const endDate = new Date(day);
    endDate.setHours(endH, endM, 0, 0);

    createEvent({
      title,
      start_time: localISO(startDate),
      end_time: localISO(endDate),
    });
    setCreationForm(null);
  }, [days, createEvent]);

  // ── Drag handlers ──

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragState) return;
    const pos = posToTime(e.clientX, e.clientY - dragState.offsetY);
    setDropPreview(pos);
  }, [dragState, posToTime]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!dragState || !dropPreview) {
      setDragState(null);
      setDropPreview(null);
      return;
    }

    const { event } = dragState;
    const { dayIdx, hour, minutes } = dropPreview;

    const oldStart = new Date(event.start_time);
    const oldEnd = new Date(event.end_time);
    const durationMs = oldEnd.getTime() - oldStart.getTime();

    const newStart = new Date(days[dayIdx]);
    newStart.setHours(hour, minutes, 0, 0);
    const newEnd = new Date(newStart.getTime() + durationMs);

    updateEvent(event.id, {
      start_time: localISO(newStart),
      end_time: localISO(newEnd),
    });

    // Briefly highlight the dropped event
    setJustDroppedId(event.id);
    setTimeout(() => setJustDroppedId(null), 1200);

    setDragState(null);
    setDropPreview(null);
  }, [dragState, dropPreview, days, updateEvent]);

  const handleDragEnd = useCallback(() => {
    setDragState(null);
    setDropPreview(null);
  }, []);

  // ── Resize handlers ──

  const handleResizeStart = useCallback((eventId: string, event: CalendarEvent, startY: number) => {
    setResizeState({ eventId, event, startY, originalEndTime: event.end_time });
    const endDate = new Date(event.end_time);
    setResizePreviewEndMin(endDate.getHours() * 60 + endDate.getMinutes());
  }, []);

  useEffect(() => {
    if (!resizeState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newEndMin = yToMinutes(e.clientY);
      const evStart = new Date(resizeState.event.start_time);
      const startMin = evStart.getHours() * 60 + evStart.getMinutes();
      // Minimum 15 minutes duration
      const clampedEnd = Math.max(newEndMin, startMin + 15);
      // Clamp to grid bounds
      const maxMin = (HOURS[HOURS.length - 1] + 1) * 60;
      setResizePreviewEndMin(Math.min(clampedEnd, maxMin));
    };

    const handleMouseUp = () => {
      if (resizePreviewEndMin !== null && resizeState) {
        const evStart = new Date(resizeState.event.start_time);
        const newEnd = new Date(evStart);
        const endH = Math.floor(resizePreviewEndMin / 60);
        const endM = resizePreviewEndMin % 60;
        newEnd.setHours(endH, endM, 0, 0);

        // Find the day for this event
        let dayDate = new Date(evStart);
        dayDate.setHours(0, 0, 0, 0);

        updateEvent(resizeState.eventId, {
          end_time: localISO(newEnd),
        });
      }
      setResizeState(null);
      setResizePreviewEndMin(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizeState, resizePreviewEndMin, yToMinutes, updateEvent]);

  return (
    <div
      ref={gridRef}
      className="flex-1 overflow-y-auto relative"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={() => setDropPreview(null)}
      onClick={handleGridClick}
      onDoubleClick={handleGridDoubleClick}
      style={resizeState ? { cursor: 'row-resize', userSelect: 'none' } : undefined}
    >
      {/* Day headers (sticky) with event dots */}
      <div className="sticky top-0 z-20 grid grid-cols-[50px_repeat(5,1fr)] border-b border-border bg-card/90 backdrop-blur-sm">
        <div />
        {days.map((d, i) => {
          const isToday = d.getTime() === today.getTime();
          const count = eventCounts[i];
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
              {/* Event density dots */}
              <div className="flex items-center justify-center gap-0.5 mt-0.5 h-2">
                {count >= 1 && count <= 2 && (
                  <div className="h-1 w-1 rounded-full bg-green-500" />
                )}
                {count >= 3 && count <= 4 && (
                  <>
                    <div className="h-1 w-1 rounded-full bg-amber-500" />
                    <div className="h-1 w-1 rounded-full bg-amber-500" />
                  </>
                )}
                {count >= 5 && (
                  <>
                    <div className="h-1 w-1 rounded-full bg-red-500" />
                    <div className="h-1 w-1 rounded-full bg-red-500" />
                    <div className="h-1 w-1 rounded-full bg-red-500" />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid background */}
      <div className="grid grid-cols-[50px_repeat(5,1fr)] relative">
        {HOURS.map((hour) => (
          <div key={hour} className="contents">
            <div className="h-14 border-b border-border/20 pr-2 pt-0.5 text-right text-[10px] text-muted-foreground/50">
              {hour}:00
            </div>
            {days.map((_, di) => (
              <div key={di} className="h-14 border-b border-l border-border/20" />
            ))}
          </div>
        ))}

        {/* Current time indicator */}
        {weekOffset === 0 && <CurrentTimeIndicator />}

        {/* Events overlay */}
        {days.map((day, dayIdx) => (
          <DayColumn
            key={dayIdx}
            dayIdx={dayIdx}
            events={dayEvents[dayIdx]}
            onDelete={deleteEvent}
            onDragStart={(eventId, offsetY) => {
              const ev = events.find((e) => e.id === eventId);
              if (ev) setDragState({ eventId, event: ev, offsetY });
            }}
            onDragEnd={handleDragEnd}
            isDragging={dragState?.eventId}
            globalDragging={!!dragState}
            onEventClick={handleEventClick}
            onResizeStart={handleResizeStart}
            resizeState={resizeState}
            resizePreviewEndMin={resizePreviewEndMin}
            justDroppedId={justDroppedId}
          />
        ))}

        {/* Drop preview ghost */}
        {dropPreview && dragState && (
          <DropGhost
            dayIdx={dropPreview.dayIdx}
            hour={dropPreview.hour}
            minutes={dropPreview.minutes}
            event={dragState.event}
          />
        )}

        {/* Inline creation form */}
        {creationForm && (
          <InlineCreateForm
            form={creationForm}
            onSubmit={handleCreateSubmit}
            onClose={() => setCreationForm(null)}
            dayDate={days[creationForm.dayIdx]}
          />
        )}

        {/* Edit popup */}
        {editPopup && (
          <EventEditPopup
            popup={editPopup}
            onClose={() => setEditPopup(null)}
            onSave={(id, patch) => { updateEvent(id, patch); setEditPopup(null); }}
            onDelete={(id) => { deleteEvent(id); setEditPopup(null); }}
          />
        )}
      </div>
    </div>
  );
}

// ── Current Time Indicator ──

function CurrentTimeIndicator() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const hour = now.getHours();
  const minutes = now.getMinutes();
  if (hour < HOURS[0] || hour > HOURS[HOURS.length - 1]) return null;

  const topPx = ((hour - HOURS[0]) + minutes / 60) * HOUR_HEIGHT;

  return (
    <div
      className="absolute z-30 pointer-events-none"
      style={{ top: `${topPx}px`, left: '44px', right: 0 }}
    >
      {/* Circle on left edge */}
      <div className="absolute -left-[5px] -top-[4px] h-[10px] w-[10px] rounded-full bg-red-500" />
      {/* Line */}
      <div className="h-[2px] w-full bg-red-500" />
    </div>
  );
}

// ── Day Column (event overlay) ──

function DayColumn({
  dayIdx,
  events,
  onDelete,
  onDragStart,
  onDragEnd,
  isDragging,
  globalDragging,
  onEventClick,
  onResizeStart,
  resizeState,
  resizePreviewEndMin,
  justDroppedId,
}: {
  dayIdx: number;
  events: CalendarEvent[];
  onDelete: (id: string) => void;
  onDragStart: (eventId: string, offsetY: number) => void;
  onDragEnd: () => void;
  isDragging?: string;
  globalDragging: boolean;
  onEventClick: (ev: CalendarEvent) => void;
  onResizeStart: (eventId: string, event: CalendarEvent, startY: number) => void;
  resizeState: ResizeState | null;
  resizePreviewEndMin: number | null;
  justDroppedId: string | null;
}) {
  const overlapLayout = useMemo(() => computeOverlapLayout(events), [events]);

  const style: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: `calc(50px + ${dayIdx} * ((100% - 50px) / ${WORK_DAYS}))`,
    width: `calc((100% - 50px) / ${WORK_DAYS})`,
    height: '100%',
    pointerEvents: 'none',
  };

  return (
    <div style={style}>
      {events.map((ev) => {
        // If this event is being resized, override its end time visually
        const isResizing = resizeState?.eventId === ev.id;
        const displayEvent = isResizing && resizePreviewEndMin !== null
          ? { ...ev, end_time: (() => {
              const d = new Date(ev.start_time);
              d.setHours(Math.floor(resizePreviewEndMin / 60), resizePreviewEndMin % 60, 0, 0);
              return localISO(d);
            })() }
          : ev;

        const layout = overlapLayout.get(ev.id);
        const dimmed = globalDragging && isDragging !== ev.id;

        return (
          <EventChip
            key={ev.id}
            event={displayEvent}
            onDelete={() => onDelete(ev.id)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            isDragging={isDragging === ev.id}
            dimmed={dimmed}
            onClick={() => onEventClick(ev)}
            onResizeStart={(startY) => onResizeStart(ev.id, ev, startY)}
            isResizing={isResizing}
            overlapLeft={layout?.left ?? 0}
            overlapWidth={layout?.width ?? 100}
            hasOverlap={layout?.hasOverlap ?? false}
            justDropped={justDroppedId === ev.id}
          />
        );
      })}
    </div>
  );
}

// ── Drop Ghost ──

function DropGhost({ dayIdx, hour, minutes, event }: {
  dayIdx: number;
  hour: number;
  minutes: number;
  event: CalendarEvent;
}) {
  const evStart = new Date(event.start_time);
  const evEnd = new Date(event.end_time);
  const durationMin = (evEnd.getTime() - evStart.getTime()) / 60000;

  const topPx = ((hour - HOURS[0]) + minutes / 60) * HOUR_HEIGHT;
  const heightPx = Math.max(20, (durationMin / 60) * HOUR_HEIGHT);

  return (
    <div
      className="absolute z-30 rounded border-2 border-dashed border-primary/50 bg-primary/10 pointer-events-none transition-[top,left] duration-75 ease-out animate-pulse [animation-duration:2s]"
      style={{
        top: `${topPx}px`,
        left: `calc(50px + ${dayIdx} * ((100% - 50px) / ${WORK_DAYS}) + 2px)`,
        width: `calc((100% - 50px) / ${WORK_DAYS} - 4px)`,
        height: `${heightPx}px`,
      }}
    >
      <div className="px-1.5 py-0.5 text-[10px] font-medium text-primary truncate">
        {event.title}
      </div>
      <div className="px-1.5 text-[9px] text-primary/70">
        {hour}:{String(minutes).padStart(2, '0')}
      </div>
    </div>
  );
}

// ── Event Chip (draggable + resizable) ──

function EventChip({
  event,
  onDelete,
  onDragStart,
  onDragEnd,
  isDragging,
  dimmed,
  onClick,
  onResizeStart,
  isResizing,
  overlapLeft,
  overlapWidth,
  hasOverlap,
  justDropped,
}: {
  event: CalendarEvent;
  onDelete: () => void;
  onDragStart: (eventId: string, offsetY: number) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  dimmed: boolean;
  onClick: () => void;
  onResizeStart: (startY: number) => void;
  isResizing: boolean;
  overlapLeft: number;
  overlapWidth: number;
  hasOverlap: boolean;
  justDropped: boolean;
}) {
  const chipRef = useRef<HTMLDivElement>(null);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const evStart = new Date(event.start_time);
  const evEnd = new Date(event.end_time);

  const startHour = evStart.getHours() + evStart.getMinutes() / 60;
  const topPx = (startHour - HOURS[0]) * HOUR_HEIGHT;
  const durationMin = (evEnd.getTime() - evStart.getTime()) / 60000;
  const heightPx = Math.max(22, (durationMin / 60) * HOUR_HEIGHT);

  const startLabel = `${pad2(evStart.getHours())}:${pad2(evStart.getMinutes())}`;
  const endLabel = `${pad2(evEnd.getHours())}:${pad2(evEnd.getMinutes())}`;
  const timeLabel = `${startLabel} — ${endLabel}`;

  const handleDragStart = (e: React.DragEvent) => {
    // Don't start drag if resize handle was clicked
    const target = e.target as HTMLElement;
    if (target.closest('[data-resize-handle]')) {
      e.preventDefault();
      return;
    }
    const rect = chipRef.current?.getBoundingClientRect();
    const offsetY = rect ? e.clientY - rect.top : 0;
    if (chipRef.current) {
      e.dataTransfer.setDragImage(chipRef.current, 20, offsetY);
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', event.id);
    onDragStart(event.id, offsetY);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!mouseDownPos.current) return;
    const dx = Math.abs(e.clientX - mouseDownPos.current.x);
    const dy = Math.abs(e.clientY - mouseDownPos.current.y);
    mouseDownPos.current = null;
    if (dx < 5 && dy < 5) {
      e.stopPropagation();
      onClick();
    }
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onResizeStart(e.clientY);
  };

  // Softer color using color-mix
  const bgColor = `color-mix(in srgb, ${event.color} 15%, transparent)`;

  return (
    <div
      ref={chipRef}
      data-event-chip
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      className={cn(
        'group absolute z-10 flex flex-col rounded-md px-1.5 py-0.5 text-[10px] leading-tight',
        'cursor-grab active:cursor-grabbing transition-all duration-150',
        'hover:shadow-lg hover:scale-[1.02] hover:z-20',
        isDragging && 'opacity-30 scale-95',
        dimmed && 'opacity-40',
        isResizing && 'z-20 shadow-lg',
        justDropped && 'ring-2 ring-primary/60 ring-offset-1 ring-offset-background animate-pulse [animation-duration:0.6s] [animation-iteration-count:2]',
      )}
      style={{
        top: `${topPx}px`,
        left: `${overlapLeft}%`,
        width: `${overlapWidth}%`,
        height: `${heightPx}px`,
        minHeight: '22px',
        background: bgColor,
        borderLeft: hasOverlap
          ? `3px solid ${event.color}`
          : `3px solid ${event.color}`,
        boxShadow: hasOverlap ? `inset 3px 0 8px -3px rgba(239,68,68,0.4)` : undefined,
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
    >
      <div className="flex items-start gap-0.5 min-w-0">
        <GripVertical
          className="h-3 w-3 shrink-0 text-muted-foreground/30 group-hover:text-muted-foreground/60 mt-px transition-colors"
        />
        <span className="font-medium break-words line-clamp-2 flex-1" style={{ color: event.color }}>
          {event.title}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0 rounded p-0.5 text-muted-foreground hover:text-red-400 transition-opacity"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      </div>
      {durationMin >= 25 && (
        <span className="text-muted-foreground/70 ml-3.5 flex items-center gap-0.5">
          <Clock className="h-2.5 w-2.5" />
          {timeLabel}
        </span>
      )}
      {durationMin >= 60 && event.description && (
        <span className="text-muted-foreground/50 ml-3.5 line-clamp-1 mt-0.5">{event.description}</span>
      )}
      {/* Resize handle at bottom */}
      <div
        data-resize-handle
        className="absolute bottom-0 left-0 right-0 h-1.5 cursor-row-resize opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: `linear-gradient(transparent, ${event.color}40)` }}
        onMouseDown={handleResizeMouseDown}
      />
      {/* Dashed resize preview line */}
      {isResizing && (
        <div className="absolute bottom-0 left-0 right-0 h-px border-b-2 border-dashed" style={{ borderColor: event.color }} />
      )}
    </div>
  );
}

// ── Inline Creation Form ──

function InlineCreateForm({
  form,
  onSubmit,
  onClose,
  dayDate,
}: {
  form: CreationForm;
  onSubmit: (title: string, startH: number, startM: number, endH: number, endM: number, dayIdx: number) => void;
  onClose: () => void;
  dayDate: Date;
}) {
  const checkConflicts = useCalendarStore((s) => s.checkConflicts);
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState(timeStr(form.hour, form.minutes));
  const endH = form.minutes === 0 ? form.hour + 1 : form.hour + 1;
  const endM = form.minutes;
  const [endTime, setEndTime] = useState(timeStr(endH > 23 ? 23 : endH, endM));
  const [conflicts, setConflicts] = useState<CalendarEvent[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const conflictTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Focus the title input after mount
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Debounced conflict check when times change
  useEffect(() => {
    if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
    conflictTimerRef.current = setTimeout(() => {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return;
      const sDate = new Date(dayDate);
      sDate.setHours(sh, sm, 0, 0);
      const eDate = new Date(dayDate);
      eDate.setHours(eh, em, 0, 0);
      if (eDate.getTime() <= sDate.getTime()) { setConflicts([]); return; }
      setConflicts(checkConflicts(localISO(sDate), localISO(eDate)));
    }, 300);
    return () => { if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current); };
  }, [startTime, endTime, dayDate, checkConflicts]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!title.trim()) return;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    onSubmit(title.trim(), sh, sm, eh, em, form.dayIdx);
  };

  return (
    <div
      data-popup
      className="absolute z-40"
      style={{ top: `${form.topPx}px`, left: form.leftCss }}
      onClick={(e) => e.stopPropagation()}
    >
      <form
        onSubmit={handleSubmit}
        className="w-52 rounded-xl border border-border bg-card shadow-xl p-3 flex flex-col gap-2"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Новое событие</span>
          <button type="button" onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <input
          ref={inputRef}
          type="text"
          placeholder="Название"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
        />
        <div className="flex items-center gap-1.5 text-sm">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary/50"
          />
          <span className="text-muted-foreground text-xs">—</span>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        {conflicts.length > 0 && (
          <div className="flex items-start gap-1 text-xs text-amber-400">
            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" strokeWidth={2} />
            <div className="flex flex-col gap-0.5">
              {conflicts.map((c) => {
                const cs = new Date(c.start_time);
                const ce = new Date(c.end_time);
                return (
                  <span key={c.id} className="leading-tight">
                    Конфликт: {c.title} {pad2(cs.getHours())}:{pad2(cs.getMinutes())}–{pad2(ce.getHours())}:{pad2(ce.getMinutes())}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <button
          type="submit"
          disabled={!title.trim()}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          Создать
        </button>
      </form>
    </div>
  );
}

// ── Event Edit Popup ──

function EventEditPopup({
  popup,
  onClose,
  onSave,
  onDelete,
}: {
  popup: EditPopup;
  onClose: () => void;
  onSave: (id: string, patch: Partial<CalendarEvent>) => void;
  onDelete: (id: string) => void;
}) {
  const checkConflicts = useCalendarStore((s) => s.checkConflicts);
  const { event } = popup;
  const evStart = new Date(event.start_time);
  const evEnd = new Date(event.end_time);

  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description || '');
  const [startTime, setStartTime] = useState(timeStr(evStart.getHours(), evStart.getMinutes()));
  const [endTime, setEndTime] = useState(timeStr(evEnd.getHours(), evEnd.getMinutes()));
  const [color, setColor] = useState(event.color);
  const [conflicts, setConflicts] = useState<CalendarEvent[]>([]);
  const popupRef = useRef<HTMLDivElement>(null);
  const conflictTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 100);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  // Debounced conflict check
  useEffect(() => {
    if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
    conflictTimerRef.current = setTimeout(() => {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return;
      const sDate = new Date(evStart);
      sDate.setHours(sh, sm, 0, 0);
      const eDate = new Date(evEnd);
      eDate.setHours(eh, em, 0, 0);
      if (eDate.getTime() <= sDate.getTime()) { setConflicts([]); return; }
      setConflicts(checkConflicts(localISO(sDate), localISO(eDate), event.id));
    }, 300);
    return () => { if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current); };
  }, [startTime, endTime, evStart, evEnd, event.id, checkConflicts]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);

    const newStart = new Date(evStart);
    newStart.setHours(sh, sm, 0, 0);
    const newEnd = new Date(evEnd);
    newEnd.setHours(eh, em, 0, 0);

    onSave(event.id, {
      title: title.trim() || event.title,
      description,
      start_time: localISO(newStart),
      end_time: localISO(newEnd),
      color,
    });
  };

  return (
    <div
      data-popup
      ref={popupRef}
      className="absolute z-50"
      style={{ top: `${popup.topPx}px`, left: popup.leftCss }}
      onClick={(e) => e.stopPropagation()}
    >
      <form
        onSubmit={handleSave}
        className="w-60 rounded-xl border border-border bg-card shadow-xl p-3 flex flex-col gap-2"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Редактировать</span>
          <button type="button" onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Название"
          className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50"
        />
        <div className="flex items-center gap-1.5 text-sm">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary/50"
          />
          <span className="text-muted-foreground text-xs">—</span>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        {conflicts.length > 0 && (
          <div className="flex items-start gap-1 text-xs text-amber-400">
            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" strokeWidth={2} />
            <div className="flex flex-col gap-0.5">
              {conflicts.map((c) => {
                const cs = new Date(c.start_time);
                const ce = new Date(c.end_time);
                return (
                  <span key={c.id} className="leading-tight">
                    Конфликт: {c.title} {pad2(cs.getHours())}:{pad2(cs.getMinutes())}–{pad2(ce.getHours())}:{pad2(ce.getMinutes())}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Описание"
          rows={2}
          className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary/50 resize-none"
        />
        {/* Color picker */}
        <div className="flex items-center gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cn(
                'h-5 w-5 rounded-full border-2 transition-all duration-150 hover:scale-110',
                color === c ? 'border-foreground scale-110' : 'border-transparent',
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5 pt-1">
          <button
            type="submit"
            className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Save className="h-3 w-3" />
            Сохранить
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(event.id); }}
            className="flex items-center justify-center gap-1 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Удалить
          </button>
        </div>
      </form>
    </div>
  );
}
