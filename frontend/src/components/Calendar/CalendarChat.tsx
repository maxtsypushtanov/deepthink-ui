import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { cn, generateId } from '@/lib/utils';
import { streamChat, API_BASE } from '@/lib/api';
import {
  Send, Loader2, X, CalendarPlus, CalendarX, Pencil,
  Check, Clock, MessageSquare, ChevronDown, ChevronUp, Mic,
} from 'lucide-react';
import { useVoiceInput } from '@/hooks/useVoiceInput';

interface CalendarChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

function formatCalDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export function CalendarChat() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<CalendarChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [draft, setDraft] = useState<any | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [flashEventId, setFlashEventId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const settings = useChatStore((s) => s.settings);
  const loadWeekEvents = useCalendarStore((s) => s.loadWeekEvents);

  const { isListening, isSupported: voiceSupported, toggle: toggleVoice } = useVoiceInput({
    onResult: (text) => {
      setInput((prev) => (prev ? prev + ' ' + text : text));
    },
  });

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages.length, streamContent, draft]);

  // Flash effect on calendar events
  useEffect(() => {
    if (flashEventId) {
      const timer = setTimeout(() => setFlashEventId(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [flashEventId]);

  // Expose flash state for CalendarView to consume
  useEffect(() => {
    if (flashEventId) {
      window.dispatchEvent(new CustomEvent('calendar:flash-event', { detail: flashEventId }));
    }
  }, [flashEventId]);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: CalendarChatMessage = { id: generateId(), role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setStreaming(true);
    setStreamContent('');
    setDraft(null);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const body = {
      message: text,
      model: settings.model,
      provider: settings.provider,
      reasoning_strategy: 'none',
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      calendar_mode: true,
    };

    let fullContent = '';

    try {
      for await (const { event, data } of streamChat(body, abortRef.current.signal)) {
        if (abortRef.current?.signal.aborted) break;

        if (event === 'content_delta' && data.content) {
          fullContent += data.content;
          setStreamContent(fullContent);
        } else if (event === 'done') {
          if (data?.calendar_draft) {
            setDraft(data.calendar_draft);
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        fullContent = fullContent || 'Ошибка при обработке запроса';
      }
    }

    if (fullContent.trim()) {
      setMessages((prev) => [...prev, { id: generateId(), role: 'assistant', content: fullContent }]);
    }
    setStreamContent('');
    setStreaming(false);
  };

  const handleConfirm = async () => {
    if (!draft) return;
    setConfirming(true);
    try {
      const resp = await fetch(`${API_BASE}/api/calendar/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (resp.ok) {
        const result = await resp.json();
        await loadWeekEvents();

        const action = draft.calendar_action || 'create';
        const title = draft.title || draft._event_title || 'событие';
        const feedbackMap: Record<string, string> = {
          create: `✓ «${title}» создана`,
          delete: `✓ «${title}» удалена`,
          update: `✓ «${title}» обновлена`,
        };
        setMessages((prev) => [...prev, {
          id: generateId(),
          role: 'assistant',
          content: feedbackMap[action] || '✓ Готово',
        }]);

        // Flash the affected event
        if (result?.event_id) {
          setFlashEventId(result.event_id);
        }
      }
    } catch {
      setMessages((prev) => [...prev, {
        id: generateId(),
        role: 'assistant',
        content: 'Ошибка при выполнении действия',
      }]);
    }
    setDraft(null);
    setConfirming(false);
  };

  const handleDismiss = () => {
    setDraft(null);
    setMessages((prev) => [...prev, {
      id: generateId(),
      role: 'assistant',
      content: 'Действие отменено',
    }]);
  };

  const action = draft?.calendar_action || 'create';
  const isDelete = action === 'delete';
  const isUpdate = action === 'update';
  const ActionIcon = isDelete ? CalendarX : isUpdate ? Pencil : CalendarPlus;
  const draftTitle = draft?.title || draft?._event_title || '';
  const draftStart = draft?.start_time || draft?._event_start || '';
  const draftEnd = draft?.end_time || draft?._event_end || '';

  return (
    <div className="flex flex-col border-t border-border bg-card/80 backdrop-blur-sm">
      {/* Toggle header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <MessageSquare className="h-3 w-3" />
        <span>Чат-ассистент</span>
        {messages.length > 0 && (
          <span className="ml-0.5 text-[10px] text-muted-foreground/50">({messages.length})</span>
        )}
        <span className="ml-auto">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </span>
      </button>

      {expanded && (
        <>
          {/* Messages */}
          {(messages.length > 0 || streaming) && (
            <div ref={scrollRef} className="max-h-[180px] overflow-y-auto px-3 pb-1 scroll-smooth">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'mb-1 text-xs leading-relaxed',
                    msg.role === 'user'
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground',
                  )}
                >
                  {msg.role === 'user' && <span className="text-primary/60 mr-1">→</span>}
                  {msg.content}
                </div>
              ))}

              {/* Streaming content */}
              {streaming && streamContent && (
                <div className="mb-1 text-xs text-muted-foreground leading-relaxed animate-pulse">
                  {streamContent}
                </div>
              )}

              {/* Streaming indicator */}
              {streaming && !streamContent && (
                <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground/60">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  <span>Думаю...</span>
                </div>
              )}
            </div>
          )}

          {/* Calendar draft inline card */}
          {draft && (
            <div className="mx-3 mb-1.5 rounded-lg border border-primary/20 bg-primary/5 p-2 animate-slide-up">
              <div className="flex items-center gap-2 mb-1">
                <ActionIcon className={cn(
                  'h-3 w-3',
                  isDelete ? 'text-red-400' : isUpdate ? 'text-amber-400' : 'text-primary',
                )} />
                <span className="text-xs font-medium">
                  {isDelete ? 'Удалить' : isUpdate ? 'Изменить' : 'Создать'}
                  {draftTitle && `: ${draftTitle}`}
                </span>
              </div>

              {(draftStart || draftEnd) && (
                <div className="flex items-center gap-1 mb-1.5 text-[10px] text-muted-foreground/70">
                  <Clock className="h-2.5 w-2.5" />
                  {draftStart && formatCalDate(draftStart)}
                  {draftStart && draftEnd && ' — '}
                  {draftEnd && new Date(draftEnd).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleConfirm}
                  disabled={confirming}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors',
                    isDelete
                      ? 'bg-red-500 text-white hover:bg-red-600'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90',
                    confirming && 'opacity-60',
                  )}
                >
                  {confirming ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
                  {isDelete ? 'Удалить' : isUpdate ? 'Сохранить' : 'Создать'}
                </button>
                <button
                  onClick={handleDismiss}
                  disabled={confirming}
                  className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-accent transition-colors"
                >
                  Отмена
                </button>
              </div>
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-1.5 px-3 pb-2 pt-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Добавь встречу, перенеси, удали..."
              rows={1}
              className="flex-1 resize-none rounded-lg border border-border bg-background/80 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40 transition-colors"
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || streaming}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-lg transition-all',
                input.trim() && !streaming
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground/40',
              )}
            >
              {streaming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            </button>
            {voiceSupported && (
              <button
                onClick={toggleVoice}
                aria-label={isListening ? 'Остановить запись' : 'Голосовой ввод'}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-lg transition-all',
                  isListening
                    ? 'bg-red-500/20 text-red-400 animate-pulse'
                    : 'text-muted-foreground/40 hover:text-primary hover:bg-primary/10',
                )}
              >
                <Mic className="h-3 w-3" strokeWidth={1.5} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
