import { useRef, useEffect, useState } from 'react';
import { Brain, Sparkles, GitBranch, TreePine, Target, Zap, Calendar, CalendarPlus, CalendarX, Pencil, Check, X, AlertCircle, Clock, Loader2, Users, Bug, HelpCircle } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { StreamingMessage } from './StreamingMessage';
import { EmptyState } from './EmptyState';
import { PersonaIndicator } from '@/components/reasoning/PersonaIndicator';
import { QuoteToolbar } from './QuoteToolbar';
import { ForkView } from './ForkView';
import { useForkStore } from '@/stores/forkStore';
import { cn } from '@/lib/utils';

const STRATEGY_ICONS: Record<string, React.ComponentType<any>> = {
  auto: Zap,
  cot: Brain,
  budget_forcing: Sparkles,
  best_of_n: GitBranch,
  tree_of_thoughts: TreePine,
  persona_council: Users,
  rubber_duck: Bug,
  socratic: HelpCircle,
  none: Target,
};

function PlanCard() {
  const plan = useChatStore((s) => s.executionPlan);
  const accept = useChatStore((s) => s.acceptPlan);
  const dismiss = useChatStore((s) => s.dismissPlan);

  if (!plan) return null;

  const Icon = STRATEGY_ICONS[plan.strategy] || Zap;

  return (
    <div className="mx-auto mb-4 w-full max-w-lg animate-slide-up">
      <div className="rounded-xl border border-primary/30 bg-card p-4 shadow-lg">
        <div className="mb-3 flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">План выполнения</span>
        </div>

        <div className="mb-3 space-y-2">
          <div className="flex gap-2 text-sm">
            <span className="text-muted-foreground w-24 shrink-0">Стратегия:</span>
            <span className="font-medium">{plan.strategy_label}</span>
          </div>
          <div className="flex gap-2 text-sm">
            <span className="text-muted-foreground w-24 shrink-0">Область:</span>
            <span>{plan.domain_label}</span>
          </div>
          <div className="flex gap-2 text-sm">
            <span className="text-muted-foreground w-24 shrink-0">LLM вызовов:</span>
            <span className="font-mono text-xs">~{plan.estimated_calls}</span>
          </div>
        </div>

        <div className="mb-3">
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Шаги:</p>
          <ol className="space-y-1">
            {plan.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={accept}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Check className="h-3.5 w-3.5" />
            Запустить
          </button>
          <button
            onClick={dismiss}
            className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

function formatCalDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function CalendarDraftCard() {
  const draft = useChatStore((s) => s.calendarDraft);
  const confirm = useChatStore((s) => s.confirmCalendarDraft);
  const dismiss = useChatStore((s) => s.dismissCalendarDraft);
  const [confirming, setConfirming] = useState(false);

  if (!draft) return null;

  const action: string = draft.calendar_action || 'create';
  const isDelete = action === 'delete';
  const isUpdate = action === 'update';

  // For delete/update, use enriched _event_* fields from backend
  const displayTitle = draft.title || draft._event_title || '';
  const displayStart = draft.start_time || draft._event_start || '';
  const displayEnd = draft.end_time || draft._event_end || '';

  const ActionIcon = isDelete ? CalendarX : isUpdate ? Pencil : CalendarPlus;
  const actionLabel = isDelete ? 'Удалить встречу?' : isUpdate ? 'Изменить встречу?' : 'Создать встречу?';
  const accentColor = isDelete ? 'border-red-500/30' : isUpdate ? 'border-amber-500/30' : 'border-primary/30';
  const iconColor = isDelete ? 'text-red-400 bg-red-500/10' : isUpdate ? 'text-amber-400 bg-amber-500/10' : 'text-primary bg-primary/10';

  const handleConfirm = async () => {
    setConfirming(true);
    await confirm();
  };

  return (
    <div className="mx-auto mb-4 w-full max-w-lg animate-slide-up">
      <div className={cn('rounded-xl border bg-card shadow-lg overflow-hidden', accentColor)}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', iconColor)}>
            <ActionIcon className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <span className="text-sm font-semibold">{actionLabel}</span>
        </div>

        {/* Event details */}
        <div className="px-4 pb-3">
          {displayTitle && (
            <p className="text-sm font-medium mt-1">{displayTitle}</p>
          )}

          {(displayStart || displayEnd) && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              <span>
                {displayStart && formatCalDate(displayStart)}
                {displayStart && displayEnd && ' — '}
                {displayEnd && new Date(displayEnd).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}

          {draft.description && (
            <p className="mt-2 text-xs text-muted-foreground/80 italic">{draft.description}</p>
          )}

          {/* For update: show what changed */}
          {isUpdate && draft._event_title && draft.title && draft.title !== draft._event_title && (
            <p className="mt-1.5 text-[10px] text-muted-foreground/60">
              Было: {draft._event_title}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-border/50 px-4 py-3 bg-accent/30">
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors',
              isDelete
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
              confirming && 'opacity-60 pointer-events-none',
            )}
          >
            {confirming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {isDelete ? 'Удалить' : isUpdate ? 'Сохранить' : 'Создать'}
          </button>
          <button
            onClick={dismiss}
            disabled={confirming}
            className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChatArea() {
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const settings = useChatStore((s) => s.settings);
  const activeId = useChatStore((s) => s.activeConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const error = useChatStore((s) => s.error);
  const clearError = useChatStore((s) => s.clearError);
  const lastPersona = useChatStore((s) => s.lastPersona);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const displayPersona = streaming.currentPersona || lastPersona;
  const activeTitle = conversations.find((c) => c.id === activeId)?.title;

  // Auto-scroll: use scrollTop on the container for reliability
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // Always scroll on new messages or when streaming starts
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length, streaming.isStreaming]);

  // Throttled scroll during content streaming
  useEffect(() => {
    if (!streaming.isStreaming) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [streaming.currentContent, streaming.thinkingSteps.length]);

  return (
    <main className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        {activeTitle ? (
          <span className="text-xs text-muted-foreground truncate max-w-[280px]" title={activeTitle}>
            {activeTitle}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/40">DeepThink</span>
        )}
        <PersonaIndicator persona={displayPersona} />
      </header>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scroll-shadow">
        {messages.length === 0 && !streaming.isStreaming ? (
          <EmptyState />
        ) : (
          <div className="mx-auto max-w-3xl px-4 py-6" data-chat-messages>
            {messages.map((msg, i) => (
              <div key={msg.id} style={{ animationDelay: `${Math.min(i * 30, 150)}ms` }}>
                <ChatMessage message={msg} />
              </div>
            ))}

            {streaming.isStreaming && (streaming.currentContent || streaming.isThinking || streaming.thinkingSteps.length > 0) && (
              <StreamingMessage
                content={streaming.currentContent}
                isThinking={streaming.isThinking}
                thinkingSteps={streaming.thinkingSteps}
                strategy={streaming.strategyUsed}
                persona={streaming.currentPersona}
              />
            )}

            {error && (
              <div className="animate-slide-up mb-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-destructive">{error}</p>
                  <button
                    onClick={clearError}
                    className="mt-1.5 text-xs text-destructive/70 hover:text-destructive underline underline-offset-2 transition-colors"
                  >
                    Закрыть
                  </button>
                </div>
              </div>
            )}

            <PlanCard />
            <CalendarDraftCard />

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0">
        <ChatInput />
      </div>

      <QuoteToolbar />
      <ForkView />
    </main>
  );
}
