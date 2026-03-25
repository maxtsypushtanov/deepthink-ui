import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useWebSocketReasoning } from '@/hooks/useWebSocketReasoning';
import { STRATEGY_LABELS_RU } from '@/lib/constants';
import { cn, generateId } from '@/lib/utils';
import type { ReasoningStrategy } from '@/types';
import { ArrowUp, Square, Brain, Sparkles, GitBranch, TreePine, Target, Zap, Calendar, Github, X, Quote, Users, Bug, HelpCircle, Paperclip, FileText, Loader2, Mic } from 'lucide-react';
import { API_BASE } from '@/lib/api';
import { useVoiceInput } from '@/hooks/useVoiceInput';

const STRATEGY_OPTIONS: { key: ReasoningStrategy; icon: React.ComponentType<any>; color: string }[] = [
  { key: 'auto', icon: Zap, color: 'text-amber-400' },
  { key: 'none', icon: Target, color: 'text-gray-400' },
  { key: 'cot', icon: Brain, color: 'text-blue-400' },
  { key: 'budget_forcing', icon: Sparkles, color: 'text-purple-400' },
  { key: 'best_of_n', icon: GitBranch, color: 'text-green-400' },
  { key: 'tree_of_thoughts', icon: TreePine, color: 'text-orange-400' },
  { key: 'persona_council', icon: Users, color: 'text-cyan-400' },
  { key: 'rubber_duck', icon: Bug, color: 'text-yellow-400' },
  { key: 'socratic', icon: HelpCircle, color: 'text-rose-400' },
];

const PLACEHOLDERS = [
  'Спросите что угодно...',
  'Докажи, что \u221A2 иррациональное число...',
  'Сравни REST и GraphQL...',
  'Объясни квантовые вычисления простыми словами...',
  'Напиши функцию сортировки на Python...',
];

const CALENDAR_PLACEHOLDERS = [
  'Добавь встречу с командой на завтра в 14:00...',
  'Какое у меня расписание на эту неделю?',
  'Перенеси утреннюю встречу на 15:00...',
  'Удали встречу с дизайнером...',
  'Запланируй созвон на пятницу в 11:00...',
];

const GITHUB_PLACEHOLDERS = [
  'Покажи открытые issues в owner/repo...',
  'Найди код с функцией handleAuth в репозитории...',
  'Какие последние коммиты в main ветке?',
  'Создай issue с описанием бага...',
  'Покажи файлы изменённые в PR #42...',
];

export function ChatInput() {
  const [input, setInput] = useState('');
  const [quote, setQuote] = useState<string | null>(null);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [attachedFiles, setAttachedFiles] = useState<{ id: string; filename: string; char_count: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef(generateId());
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const isStreaming = useChatStore((s) => s.streaming.isStreaming);
  const strategy = useChatStore((s) => s.settings.strategy);
  const provider = useChatStore((s) => s.settings.provider);
  const model = useChatStore((s) => s.settings.model);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const calendarMode = useChatStore((s) => s.calendarMode);
  const toggleCalendarMode = useChatStore((s) => s.toggleCalendarMode);
  const githubMode = useChatStore((s) => s.githubMode);
  const toggleGitHubMode = useChatStore((s) => s.toggleGitHubMode);

  const { sendPartial, sendFinal, isPrethinking, prefillReady } =
    useWebSocketReasoning(sessionIdRef.current);

  const { isListening, isSupported: voiceSupported, toggle: toggleVoice } = useVoiceInput({
    onResult: (text) => {
      setInput((prev) => (prev ? prev + ' ' + text : text));
    },
  });

  const currentOption = STRATEGY_OPTIONS.find((o) => o.key === strategy) || STRATEGY_OPTIONS[0];
  const CurrentIcon = currentOption.icon;

  const placeholders = calendarMode ? CALENDAR_PLACEHOLDERS : githubMode ? GITHUB_PLACEHOLDERS : PLACEHOLDERS;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  useEffect(() => {
    setPlaceholderIdx(0);
    const timer = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % placeholders.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [calendarMode, githubMode]);

  useEffect(() => {
    const handleEdit = (e: Event) => {
      const content = (e as CustomEvent).detail;
      if (typeof content === 'string') {
        setInput(content);
        textareaRef.current?.focus();
      }
    };
    const handleQuote = (e: Event) => {
      const text = (e as CustomEvent).detail;
      if (typeof text === 'string' && text.trim()) {
        setQuote(text.trim());
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('deepthink:edit-message', handleEdit);
    window.addEventListener('deepthink:quote-text', handleQuote);
    return () => {
      window.removeEventListener('deepthink:edit-message', handleEdit);
      window.removeEventListener('deepthink:quote-text', handleQuote);
    };
  }, []);

  const handleInputChange = (value: string) => {
    setInput(value);
    if (!calendarMode && !githubMode && value.trim().length > 3) {
      sendPartial(value, provider, model);
    }
  };

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (isStreaming) return;

    // If files are attached, use file analysis endpoint
    if (attachedFiles.length > 0) {
      const filenames = attachedFiles.map(f => f.filename).join(', ');
      const query = trimmed || (attachedFiles.length === 1
        ? `Проанализируй файл ${attachedFiles[0].filename}`
        : `Проанализируй файлы: ${filenames}`);
      const store = useChatStore.getState();
      let convId = store.activeConversationId;
      setInput('');
      const files = [...attachedFiles];
      setAttachedFiles([]);
      setUploadError(null);

      // Ensure we have a conversation
      if (!convId) {
        try {
          convId = await store.createConversation();
        } catch {
          setUploadError('Не удалось создать диалог');
          return;
        }
      }

      const formData = new FormData();
      for (const f of files) {
        formData.append('file_ids', f.id);
      }
      formData.append('query', query);
      formData.append('model', model);
      formData.append('provider', provider);
      formData.append('conversation_id', convId);

      try {
        const resp = await fetch(`${API_BASE}/api/files/analyze`, {
          method: 'POST',
          body: formData,
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: 'Ошибка анализа' }));
          setUploadError(err.detail);
          return;
        }
        if (resp.body) {
          const fileLabel = files.map(f => `📎 ${f.filename}`).join('\n');
          useChatStore.setState((s) => ({
            messages: [...s.messages, {
              id: generateId(),
              conversation_id: convId!,
              role: 'user' as const,
              content: `${fileLabel}\n\n${query}`,
              created_at: new Date().toISOString(),
            }],
          }));
          store.handleFileAnalysisStream(resp);
        }
      } catch {
        setUploadError('Ошибка сети при анализе файла');
      }
      sessionIdRef.current = generateId();
      return;
    }

    if (!trimmed) return;

    const fullMessage = quote
      ? `> ${quote.split('\n').join('\n> ')}\n\n${trimmed}`
      : trimmed;
    sendFinal(trimmed);
    setInput('');
    setQuote(null);
    sendMessage(fullMessage);
    sessionIdRef.current = generateId();
  };

  const MAX_FILES = 10;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remaining = MAX_FILES - attachedFiles.length;
    if (remaining <= 0) {
      setUploadError(`Максимум ${MAX_FILES} файлов`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const toUpload = Array.from(files).slice(0, remaining);
    if (toUpload.length < files.length) {
      setUploadError(`Добавлено ${toUpload.length} из ${files.length} (лимит ${MAX_FILES})`);
    }

    setUploading(true);
    try {
      const results = await Promise.allSettled(
        toUpload.map(async (file) => {
          const formData = new FormData();
          formData.append('file', file);
          const resp = await fetch(`${API_BASE}/api/files/upload`, {
            method: 'POST',
            body: formData,
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: `Не удалось загрузить ${file.name}` }));
            throw new Error(err.detail);
          }
          return resp.json();
        })
      );

      const newFiles: { id: string; filename: string; char_count: number }[] = [];
      const errors: string[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') {
          newFiles.push({ id: r.value.id, filename: r.value.filename, char_count: r.value.char_count });
        } else {
          errors.push(r.reason?.message || 'Ошибка загрузки');
        }
      }
      if (errors.length > 0) {
        setUploadError(errors.length === 1 ? errors[0] : `${errors.length} файл(ов) не загружено`);
      }
      if (newFiles.length > 0) {
        setAttachedFiles(prev => [...prev, ...newFiles]);
      }
    } catch {
      setUploadError('Ошибка сети при загрузке');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Drag & drop
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    dragCounter.current = 0;
    const dt = e.dataTransfer;
    if (dt.files && dt.files.length > 0) {
      // Reuse the same upload logic via a synthetic-like approach
      const fakeEvent = { target: { files: dt.files } } as unknown as React.ChangeEvent<HTMLInputElement>;
      handleFileUpload(fakeEvent);
    }
  };

  // Active mode determines border accent
  const borderAccent = calendarMode
    ? 'border-primary/30 bg-primary/5'
    : githubMode
      ? 'border-purple-500/30 bg-purple-500/5'
      : dragging
        ? 'border-primary/50 bg-primary/10 ring-2 ring-primary/20'
        : 'border-border bg-card';

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mx-auto max-w-3xl">
        <div
          className={cn(
            'relative rounded-xl border shadow-sm transition-all duration-200',
            borderAccent,
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* Drop overlay */}
          {dragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-primary/10 border-2 border-dashed border-primary/40 backdrop-blur-[1px]">
              <span className="text-xs text-primary font-medium">Перетащите файлы сюда</span>
            </div>
          )}
          {/* Quote block */}
          {quote && (
            <div className="mx-3 mt-2.5 mb-0 animate-quote-in">
              <div className="flex items-start gap-2 pl-3 pr-2 py-1.5 border-l-2 border-primary/30">
                <Quote className="h-3 w-3 shrink-0 mt-0.5 text-primary/40" />
                <p className="flex-1 text-xs text-muted-foreground/70 line-clamp-3 italic min-w-0 leading-relaxed">
                  {quote}
                </p>
                <button
                  onClick={() => setQuote(null)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground/30 hover:text-foreground transition-colors"
                  aria-label="Убрать цитату"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* Attached files indicator */}
          {attachedFiles.length > 0 && (
            <div className="mx-3 mt-2.5 mb-0 animate-quote-in flex flex-wrap gap-1.5">
              {attachedFiles.map((file, idx) => (
                <div key={file.id} className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-primary/10 border border-primary/20">
                  <FileText className="h-3 w-3 shrink-0 text-primary/60" />
                  <span className="text-xs text-muted-foreground/80 truncate max-w-[180px]">
                    {file.filename}
                    {file.char_count > 0 && (
                      <span className="text-muted-foreground/40 ml-1">
                        {file.char_count < 1000
                          ? `(${file.char_count} симв.)`
                          : `(${(file.char_count / 1000).toFixed(1)}k симв.)`}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
                    className="shrink-0 rounded p-0.5 text-muted-foreground/30 hover:text-foreground transition-colors"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
              {attachedFiles.length > 1 && (
                <button
                  onClick={() => setAttachedFiles([])}
                  className="text-[10px] text-muted-foreground/40 hover:text-foreground px-1.5 py-1 transition-colors"
                >
                  Убрать все
                </button>
              )}
            </div>
          )}

          <div className="flex items-center">
          {/* File upload — left side */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.py,.js,.ts,.tsx,.json,.pdf,.docx,.pptx,.xlsx,.xls,.csv,.html,.css,.sql,.yaml,.yml,.go,.rs,.java,.c,.cpp,.png,.jpg,.jpeg,.gif,.webp,.jsx,.rb,.php,.swift,.kt,.xml,.ini,.cfg,.sh,.bash"
            multiple
            onChange={handleFileUpload}
            className="hidden"
          />
          <div className="pl-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label="Прикрепить файл"
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200',
                attachedFiles.length > 0
                  ? 'bg-primary/20 text-primary shadow-sm shadow-primary/20'
                  : 'text-muted-foreground/50 hover:text-primary hover:bg-primary/10',
              )}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" strokeWidth={1.5} />}
            </button>
            {voiceSupported && (
              <button
                onClick={toggleVoice}
                aria-label={isListening ? 'Остановить запись' : 'Голосовой ввод'}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200',
                  isListening
                    ? 'bg-red-500/20 text-red-400 animate-pulse shadow-sm shadow-red-500/20'
                    : 'text-muted-foreground/50 hover:text-primary hover:bg-primary/10',
                )}
              >
                <Mic className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
          </div>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={quote ? 'Ваш комментарий к цитате...' : attachedFiles.length > 0 ? (attachedFiles.length === 1 ? `Задайте вопрос по файлу ${attachedFiles[0].filename}...` : `Задайте вопрос по ${attachedFiles.length} файлам...`) : placeholders[placeholderIdx % placeholders.length]}
            rows={1}
            aria-label="Поле ввода сообщения"
            className="flex-1 resize-none bg-transparent px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
          <div className="flex items-center gap-0.5 px-2">
            {/* GitHub toggle */}
            <button
              onClick={toggleGitHubMode}
              aria-label={githubMode ? 'Отключить GitHub MCP' : 'Подключить GitHub MCP'}
              aria-pressed={githubMode}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200',
                githubMode
                  ? 'bg-purple-500/20 text-purple-400 shadow-sm shadow-purple-500/10'
                  : 'text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent',
              )}
            >
              <Github className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>

            {/* Calendar toggle */}
            <button
              onClick={toggleCalendarMode}
              aria-label={calendarMode ? 'Отключить режим календаря' : 'Включить режим календаря'}
              aria-pressed={calendarMode}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200',
                calendarMode
                  ? 'bg-primary/20 text-primary shadow-sm'
                  : 'text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent',
              )}
            >
              <Calendar className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>

            {/* Strategy chip */}
            <div className="relative">
              <button
                onClick={() => setStrategyOpen(!strategyOpen)}
                aria-label={`Стратегия: ${STRATEGY_LABELS_RU[strategy] || strategy}`}
                aria-expanded={strategyOpen}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                  'hover:bg-accent text-muted-foreground',
                )}
              >
                <CurrentIcon className={cn('h-3.5 w-3.5', currentOption.color)} />
              </button>

              {strategyOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setStrategyOpen(false)} />
                  <div className="absolute bottom-full right-0 z-50 mb-2 w-52 rounded-xl border border-border bg-card p-1.5 shadow-xl animate-fade-in-scale">
                    {STRATEGY_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.key}
                          onClick={() => {
                            updateSettings({ strategy: opt.key });
                            setStrategyOpen(false);
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors hover:bg-accent',
                            strategy === opt.key ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground',
                          )}
                        >
                          <Icon className={cn('h-3.5 w-3.5', opt.color)} />
                          {STRATEGY_LABELS_RU[opt.key] || opt.key}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Send / Stop */}
            {isStreaming ? (
              <button
                onClick={stopStreaming}
                aria-label="Остановить генерацию"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!input.trim() && attachedFiles.length === 0}
                aria-label="Отправить сообщение"
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200',
                  (input.trim() || attachedFiles.length > 0)
                    ? 'bg-foreground text-background hover:bg-foreground/90 shadow-sm'
                    : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
                )}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
          </div> {/* /flex items-center */}
        </div>

        {/* Status bar */}
        <div className="mt-1.5 flex items-center gap-2 px-1">
          {uploadError && (
            <span className="flex items-center gap-1 text-[10px] text-red-400">
              <X className="h-2.5 w-2.5" />
              {uploadError}
              <button onClick={() => setUploadError(null)} className="ml-1 underline hover:no-underline">OK</button>
            </span>
          )}
          {(isPrethinking || prefillReady) && (
            <span
              className={cn(
                'flex items-center gap-1 text-[10px] transition-opacity duration-300',
                isPrethinking ? 'text-amber-400 animate-pulse' : 'text-emerald-400',
              )}
            >
              <Zap className="h-2.5 w-2.5" />
              {isPrethinking ? 'Deep Think уже думает...' : 'Предварительный анализ готов'}
            </span>
          )}
          {githubMode && (
            <span className="flex items-center gap-1 text-[10px] text-purple-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-purple-400" />
              GitHub MCP
            </span>
          )}
          {calendarMode && (
            <span className="flex items-center gap-1 text-[10px] text-primary">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
              Календарь
            </span>
          )}
          {isListening && (
            <span className="flex items-center gap-1 text-[10px] text-red-400 animate-pulse">
              <Mic className="h-2.5 w-2.5" />
              Запись...
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground/50">
            Shift+Enter — новая строка
          </span>
        </div>
      </div>
    </div>
  );
}
