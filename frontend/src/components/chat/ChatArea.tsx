import { useRef, useEffect, useState, useCallback } from 'react';
import { Check, X, AlertCircle, Loader2, ArrowDown, RefreshCw } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useShallow } from 'zustand/react/shallow';
import { ChatMessage } from './ChatMessage';
import { ProactiveMessage } from './ProactiveMessage';
import { ChatInput } from './ChatInput';
import { StreamingMessage } from './StreamingMessage';
import { EmptyState, SuggestionChips } from './EmptyState';
import { CalendarActionCard } from './CalendarActionCard';
import { AmbientCalendarHint } from './AmbientCalendarHint';
import { QuoteToolbar } from './QuoteToolbar';
import { ForkView } from './ForkView';
import { ChatSearch } from './ChatSearch';
import { getStrategy } from '@/lib/strategies';
import { cn } from '@/lib/utils';

/* ── Friendly error messages ── */

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();

  // Network errors
  if (lower.includes('nodename') || lower.includes('servname') || lower.includes('getaddrinfo') || lower.includes('dns'))
    return 'Нет подключения к интернету. Проверь сеть и попробуй снова.';
  if (lower.includes('fetch') || lower.includes('networkerror') || lower.includes('failed to fetch') || lower.includes('network request failed'))
    return 'Не удалось связаться с сервером. Проверь подключение к интернету.';
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('econnaborted'))
    return 'Запрос занял слишком много времени. Попробуй ещё раз.';
  if (lower.includes('econnrefused') || lower.includes('connection refused'))
    return 'Сервер недоступен. Убедись, что бэкенд запущен.';
  if (lower.includes('econnreset') || lower.includes('socket hang up'))
    return 'Соединение оборвалось. Попробуй ещё раз.';

  // Auth errors
  if (lower.includes('no api key') || lower.includes('api_key'))
    return 'API-ключ не настроен. Добавь ключ в настройках, чтобы Нейрон заработал.';
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('authentication'))
    return 'Ключ API не принят. Проверь, что ключ актуальный и введён правильно.';
  if (lower.includes('403') || lower.includes('forbidden'))
    return 'Доступ запрещён. Возможно, ключ не имеет нужных прав.';

  // Rate limits
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many'))
    return 'Слишком много запросов. Подожди немного и попробуй снова.';

  // Server errors
  if (lower.includes('500') || lower.includes('internal server'))
    return 'Что-то пошло не так на сервере. Попробуй ещё раз.';
  if (lower.includes('502') || lower.includes('503') || lower.includes('bad gateway') || lower.includes('service unavailable'))
    return 'Сервис временно недоступен. Попробуй через пару минут.';

  // LLM-specific
  if (lower.includes('context length') || lower.includes('too long') || lower.includes('max tokens'))
    return 'Сообщение слишком длинное для выбранной модели. Попробуй сократить или выбрать модель с большим контекстом.';
  if (lower.includes('content filter') || lower.includes('content_filter'))
    return 'Запрос заблокирован фильтром контента провайдера.';

  // If it looks like a raw technical error (starts with [ or contains errno), wrap it
  if (raw.startsWith('[') || lower.includes('errno'))
    return 'Произошла техническая ошибка. Попробуй ещё раз.';

  return raw;
}

/* ── Plan Card ── */

function PlanCard() {
  const plan = useChatStore((s) => s.executionPlan);
  const accept = useChatStore((s) => s.acceptPlan);
  const dismiss = useChatStore((s) => s.dismissPlan);
  if (!plan) return null;
  const { icon: Icon } = getStrategy(plan.strategy);

  return (
    <div className="mx-auto mb-4 w-full max-w-lg animate-slide-up">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">План выполнения</span>
        </div>
        <div className="mb-3 space-y-1.5 text-sm">
          <div className="flex gap-2"><span className="text-muted-foreground w-24 shrink-0">Стратегия:</span><span>{plan.strategy_label}</span></div>
          <div className="flex gap-2"><span className="text-muted-foreground w-24 shrink-0">Домен:</span><span>{plan.domain_label}</span></div>
          <div className="flex gap-2"><span className="text-muted-foreground w-24 shrink-0">Вызовов LLM:</span><span className="font-mono text-xs">~{plan.estimated_calls}</span></div>
        </div>
        <ol className="mb-3 space-y-1">
          {plan.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold">{i + 1}</span>
              <span className="text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>
        <div className="flex gap-2">
          <button onClick={accept} className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90 transition-colors">
            <Check className="inline h-3.5 w-3.5 mr-1" />Выполнить
          </button>
          <button onClick={dismiss} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors">Отмена</button>
        </div>
      </div>
    </div>
  );
}

/* ── Chat Area ── */

export function ChatArea() {
  const { messages, streaming, activeId, conversations, error } = useChatStore(
    useShallow((s) => ({
      messages: s.messages,
      streaming: s.streaming,
      activeId: s.activeConversationId,
      conversations: s.conversations,
      error: s.error,
    })),
  );
  const clearError = useChatStore((s) => s.clearError);
  const sendMessage = useChatStore((s) => s.sendMessage);

  const handleRetry = () => {
    const lastUserMsg = messages.filter((m) => m.role === 'user').at(-1);
    if (!lastUserMsg) return;
    clearError();
    sendMessage(lastUserMsg.content);
  };

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const userScrolledUp = useRef(false);

  const activeTitle = conversations.find((c) => c.id === activeId)?.title;
  const isEmpty = messages.length === 0 && !streaming.isStreaming && !streaming.clarificationQuestion;

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    userScrolledUp.current = false;
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const h = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      userScrolledUp.current = dist > 80;
      setShowScrollBtn(dist > 80 && messages.length > 0);
    };
    el.addEventListener('scroll', h, { passive: true });
    return () => el.removeEventListener('scroll', h);
  }, [messages.length]);

  useEffect(() => {
    if (userScrolledUp.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages.length, streaming.isStreaming]);

  useEffect(() => {
    if (!streaming.isStreaming || userScrolledUp.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(raf);
  }, [streaming.currentContent, streaming.thinkingSteps.length]);

  // Empty state: centered composer
  if (isEmpty) {
    return (
      <div className="relative flex h-full flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-full max-w-xl">
            <EmptyState />
            <ChatInput />
            <SuggestionChips />
          </div>
        </div>
        <div className="pb-3 text-center">
          <p className="text-[11px] text-muted-foreground/30 select-none">
            ⌘K команды · Перетащите файлы · Просто начните писать
          </p>
        </div>
        <ChatSearch />
        <QuoteToolbar />
        <ForkView />
      </div>
    );
  }

  // Has messages
  return (
    <div className="relative flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2 min-h-[40px]">
        <div className="flex items-center gap-2 min-w-0">
          {activeTitle ? (
            <span className="text-[13px] text-muted-foreground truncate max-w-[400px]">{activeTitle}</span>
          ) : (
            <span className="text-[13px] text-muted-foreground/30">DeepThink</span>
          )}
          {streaming.isStreaming && (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground animate-fade-in">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-foreground/40 animate-pulse" />
              {streaming.isThinking ? 'Думает...' : 'Пишет...'}
            </span>
          )}
        </div>
      </header>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6" data-chat-messages>
          {/* Proactive agent: morning briefing & meeting reminders */}
          <ProactiveMessage />

          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}

          {(streaming.isStreaming || streaming.clarificationQuestion) && (
            <StreamingMessage
              content={streaming.currentContent}
              isThinking={streaming.isThinking}
              thinkingSteps={streaming.thinkingSteps}
              strategy={streaming.strategyUsed}
              persona={streaming.currentPersona}
            />
          )}

          {error && (
            <div className="animate-slide-up mb-4 flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <AlertCircle className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground/70">
                  {friendlyError(error)}
                </p>
                <div className="mt-2 flex gap-2">
                  {(error.toLowerCase().includes('no api key') || error.toLowerCase().includes('api_key') || error.toLowerCase().includes('401') || error.toLowerCase().includes('authentication')) && (
                    <button
                      onClick={() => { clearError(); window.dispatchEvent(new CustomEvent('deepthink:open-settings')); }}
                      className="flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-xs text-background hover:bg-foreground/90 transition-colors"
                    >
                      Открыть настройки
                    </button>
                  )}
                  {messages.some((m) => m.role === 'user') && !error.toLowerCase().includes('no api key') && (
                    <button onClick={handleRetry} className="flex items-center gap-1 rounded-lg bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <RefreshCw className="h-3 w-3" />Повторить
                    </button>
                  )}
                  <button onClick={clearError} className="text-xs text-muted-foreground/50 hover:text-foreground transition-colors">Скрыть</button>
                </div>
              </div>
            </div>
          )}

          <PlanCard />
          <CalendarActionCard />
          <div ref={bottomRef} />
        </div>
      </div>

      {showScrollBtn && (
        <div className="absolute bottom-[72px] left-1/2 -translate-x-1/2 z-10 animate-fade-in">
          <button onClick={scrollToBottom}
            className="flex items-center rounded-full border border-border bg-card/95 backdrop-blur-sm px-3 py-1.5 hover:bg-muted transition-colors">
            <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* Ambient calendar hint + composer */}
      <div className="shrink-0 border-t border-border">
        <AmbientCalendarHint />
        <ChatInput />
      </div>

      <ChatSearch />
      <QuoteToolbar />
      <ForkView />
    </div>
  );
}
