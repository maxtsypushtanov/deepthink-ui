import { useState, useRef, useEffect, useMemo } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useWebSocketReasoning } from '@/hooks/useWebSocketReasoning';
import { cn, generateId } from '@/lib/utils';
import { ArrowUp, Square, X, Quote, FileText, Loader2, Paperclip, Mic } from 'lucide-react';
import { API_BASE } from '@/lib/api';
import { toast } from '@/hooks/useToast';

// Auto-detect calendar intent from text
const CALENDAR_PATTERN = /(?:завтра|сегодня|послезавтра|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье|в \d{1,2}[:.]\d{2}|\d{1,2}:\d{2}|встреча|расписание|schedule|meeting|tomorrow|today)\b/i;
const GITHUB_PATTERN = /(?:github\.com\/|repo:|issue[s]?\s*#|PR\s*#|pull request)/i;

export function ChatInput() {
  const [input, setInput] = useState('');
  const [quote, setQuote] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<{ id: string; filename: string; char_count: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef(generateId());
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const isStreaming = useChatStore((s) => s.streaming.isStreaming);
  const provider = useChatStore((s) => s.settings.provider);
  const model = useChatStore((s) => s.settings.model);

  const { sendPartial, sendFinal } = useWebSocketReasoning(sessionIdRef.current);

  // Auto-detect context from text
  const detectedCalendar = useMemo(() => CALENDAR_PATTERN.test(input), [input]);
  const detectedGithub = useMemo(() => GITHUB_PATTERN.test(input), [input]);

  // Auto-grow: min 1 line, max 6 lines (~160px)
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  }, [input]);

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Edit / quote / voice events
  useEffect(() => {
    const handleEdit = (e: Event) => {
      const content = (e as CustomEvent).detail;
      if (typeof content === 'string') { setInput(content); textareaRef.current?.focus(); }
    };
    const handleQuote = (e: Event) => {
      const text = (e as CustomEvent).detail;
      if (typeof text === 'string' && text.trim()) { setQuote(text.trim()); textareaRef.current?.focus(); }
    };
    const handleVoice = () => toggleVoice();
    window.addEventListener('deepthink:edit-message', handleEdit);
    window.addEventListener('deepthink:quote-text', handleQuote);
    window.addEventListener('deepthink:toggle-voice', handleVoice);
    return () => {
      window.removeEventListener('deepthink:edit-message', handleEdit);
      window.removeEventListener('deepthink:quote-text', handleQuote);
      window.removeEventListener('deepthink:toggle-voice', handleVoice);
    };
  }, []);

  const toggleVoice = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Браузер не поддерживает голосовой ввод');
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.continuous = true;
    recognition.interimResults = true;

    let finalTranscript = input;

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + transcript;
          setInput(finalTranscript);
        } else {
          interim = transcript;
        }
      }
      if (interim) {
        setInput(finalTranscript + (finalTranscript ? ' ' : '') + interim);
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
      toast.error('Ошибка распознавания речи');
    };

    recognition.onend = () => setIsListening(false);

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
    toast.success('Слушаю...');
  };

  // Arrow up in empty composer → edit last user message
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'ArrowUp' && !input.trim()) {
      const msgs = useChatStore.getState().messages;
      const lastUser = msgs.filter((m) => m.role === 'user').at(-1);
      if (lastUser) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('deepthink:edit-message', { detail: lastUser.content }));
      }
    }
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    if (value.trim().length > 3) {
      sendPartial(value, provider, model);
    }
  };

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (isStreaming) return;

    // File analysis flow
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

      if (!convId) {
        try { convId = await store.createConversation(); }
        catch { toast.error('Не удалось создать диалог'); return; }
      }

      const formData = new FormData();
      for (const f of files) formData.append('file_ids', f.id);
      formData.append('query', query);
      formData.append('model', model);
      formData.append('provider', provider);
      formData.append('conversation_id', convId);

      try {
        const resp = await fetch(`${API_BASE}/api/files/analyze`, { method: 'POST', body: formData });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: 'Error' }));
          toast.error(err.detail);
          return;
        }
        if (resp.body) {
          const fileLabel = files.map(f => `📎 ${f.filename}`).join('\n');
          useChatStore.setState((s) => ({
            messages: [...s.messages, {
              id: generateId(), conversation_id: convId!, role: 'user' as const,
              content: `${fileLabel}\n\n${query}`, created_at: new Date().toISOString(),
            }],
          }));
          store.handleFileAnalysisStream(resp);
        }
      } catch { toast.error('Network error'); }
      sessionIdRef.current = generateId();
      return;
    }

    if (!trimmed) return;

    const fullMessage = quote ? `> ${quote.split('\n').join('\n> ')}\n\n${trimmed}` : trimmed;
    const prefill = sendFinal(trimmed);
    setInput('');
    setQuote(null);
    sendMessage(fullMessage, prefill ?? undefined);
    sessionIdRef.current = generateId();
  };

  // Drag & drop
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const MAX_FILES = 10;
    const remaining = MAX_FILES - attachedFiles.length;
    if (remaining <= 0) { toast.error(`Максимум ${MAX_FILES} файлов`); return; }
    const toUpload = Array.from(files).slice(0, remaining);
    setUploading(true);
    try {
      const results = await Promise.allSettled(
        toUpload.map(async (file) => {
          const fd = new FormData();
          fd.append('file', file);
          const resp = await fetch(`${API_BASE}/api/files/upload`, { method: 'POST', body: fd });
          if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || 'Upload failed');
          return resp.json();
        })
      );
      const newFiles: typeof attachedFiles = [];
      for (const r of results) {
        if (r.status === 'fulfilled') newFiles.push({ id: r.value.id, filename: r.value.filename, char_count: r.value.char_count });
      }
      if (newFiles.length > 0) setAttachedFiles(prev => [...prev, ...newFiles]);
    } catch { toast.error('Ошибка загрузки'); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const hasContent = input.trim() || attachedFiles.length > 0;

  return (
    <div className="px-4 py-3">
      <div className="mx-auto max-w-3xl">
        <div
          className={cn(
            'relative rounded-xl border transition-all duration-150',
            dragging
              ? 'border-foreground/20 bg-foreground/[0.02]'
              : 'border-border bg-card focus-within:border-foreground/15',
          )}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; if (e.dataTransfer.types.includes('Files')) setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current--; if (dragCounter.current === 0) setDragging(false); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => {
            e.preventDefault(); e.stopPropagation(); setDragging(false); dragCounter.current = 0;
            if (e.dataTransfer.files?.length) handleFileUpload({ target: { files: e.dataTransfer.files } } as any);
          }}
        >
          {/* Drop overlay */}
          {dragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-foreground/15 bg-foreground/[0.02]">
              <span className="text-xs text-muted-foreground font-medium">Перетащите файл для анализа</span>
            </div>
          )}

          {/* Quote block */}
          {quote && (
            <div className="mx-3 mt-2.5 animate-quote-in">
              <div className="flex items-start gap-2 pl-3 pr-2 py-1.5 border-l-2 border-foreground/10">
                <Quote className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground/30" />
                <p className="flex-1 text-xs text-muted-foreground/70 line-clamp-3 italic">{quote}</p>
                <button onClick={() => setQuote(null)} className="shrink-0 rounded p-0.5 text-muted-foreground/30 hover:text-foreground transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* Attached files */}
          {attachedFiles.length > 0 && (
            <div className="mx-3 mt-2.5 animate-quote-in flex flex-wrap gap-1.5">
              {attachedFiles.map((file, idx) => (
                <div key={file.id} className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg bg-muted/50 border border-border">
                  <FileText className="h-3 w-3 text-muted-foreground/50" />
                  <span className="text-xs text-muted-foreground truncate max-w-[180px]">{file.filename}</span>
                  <button onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))} className="rounded p-0.5 text-muted-foreground/30 hover:text-foreground transition-colors">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Textarea + Attach + Send */}
          <div className="flex items-center">
            <input ref={fileInputRef} type="file" multiple onChange={handleFileUpload} className="hidden"
              accept=".txt,.md,.py,.js,.ts,.tsx,.json,.pdf,.docx,.pptx,.xlsx,.csv,.html,.css,.sql,.yaml,.yml,.go,.rs,.java,.c,.cpp,.png,.jpg,.jpeg,.gif,.webp"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="pl-3 text-muted-foreground/30 hover:text-muted-foreground transition-colors"
              title="Прикрепить файл"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Сообщение..."
              rows={1}
              className="flex-1 resize-none bg-transparent px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
            <div className="flex items-center gap-1 pr-2">
              <button
                onClick={toggleVoice}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150',
                  isListening
                    ? 'bg-red-500/15 text-red-400 animate-pulse'
                    : 'text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/50',
                )}
                title={isListening ? 'Остановить запись' : 'Голосовой ввод'}
              >
                <Mic className="h-4 w-4" />
              </button>
              {isStreaming ? (
                <button onClick={stopStreaming} className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/10 text-foreground/60 transition-colors hover:bg-foreground/15">
                  <Square className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button onClick={handleSubmit} disabled={!hasContent}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150',
                    hasContent ? 'bg-foreground text-background hover:bg-foreground/90' : 'bg-muted text-muted-foreground/30 cursor-not-allowed',
                  )}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Context badges — auto-detected, appear contextually */}
        <div className="mt-1.5 flex items-center gap-2 px-1 min-h-[18px]">
          {detectedCalendar && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/40 animate-fade-in">
              Обнаружено действие с календарём
            </span>
          )}
          {detectedGithub && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/40 animate-fade-in">
              Режим GitHub
            </span>
          )}
          {uploading && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Загрузка...
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
