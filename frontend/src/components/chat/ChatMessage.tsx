import { useState, useMemo, useEffect, useRef, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ThinkingStep, ReasoningStrategy } from '@/types';
import { cn, formatTimestamp, cleanAssistantContent } from '@/lib/utils';
import { STRATEGY_LABELS_RU } from '@/lib/constants';
import { ConfidenceBar } from '@/components/reasoning/ConfidenceBar';
import { ThinkingPanel } from '@/components/reasoning/ThinkingPanel';
import {
  Copy, Check, Pencil, GitFork, RefreshCw,
  Clipboard, ClipboardCheck, Play, Loader2,
} from 'lucide-react';
import { API_BASE } from '@/lib/api';
import { useChatStore } from '@/stores/chatStore';
import { useForkStore } from '@/stores/forkStore';
import { STRATEGIES, getStrategy } from '@/lib/strategies';

/* ── Syntax highlighting ── */

const KW_REGEX = /\b(function|const|let|var|return|if|else|for|while|import|export|from|class|def|async|await|try|catch|throw|new|type|interface|extends|implements|yield|switch|case|break|continue|default|do|in|of|typeof|instanceof|void|null|undefined|true|false|None|True|False|self|this|print|raise|except|finally|with|as|lambda|pass|del|global|nonlocal|assert|elif|struct|enum|fn|pub|mod|use|impl|trait|match|mut|ref|where|package|func|go|defer|chan|select|map|range|fmt|println|main)\b/g;
const STR_REGEX = /(["'`])(?:(?!\1|\\).|\\.)*?\1/g;
const COMMENT_REGEX = /(\/\/.*?$|#.*?$|\/\*[\s\S]*?\*\/)/gm;
const NUM_REGEX = /\b(\d+\.?\d*(?:e[+-]?\d+)?|0x[0-9a-f]+)\b/gi;
const FUNC_REGEX = /\b([a-zA-Z_]\w*)\s*\(/g;

function highlightCode(code: string): string {
  const placeholders: { token: string; html: string }[] = [];
  let idx = 0;
  const ph = (html: string) => { const t = `__PH${idx++}__`; placeholders.push({ token: t, html }); return t; };
  let result = code.replace(STR_REGEX, (m) => ph(`<span class="tok-str">${esc(m)}</span>`));
  result = result.replace(COMMENT_REGEX, (m) => ph(`<span class="tok-cmt">${esc(m)}</span>`));
  result = result.replace(KW_REGEX, (m) => ph(`<span class="tok-kw">${esc(m)}</span>`));
  result = result.replace(NUM_REGEX, (m) => ph(`<span class="tok-num">${esc(m)}</span>`));
  result = result.replace(FUNC_REGEX, (_, name) => ph(`<span class="tok-fn">${esc(name)}</span>`) + '(');
  result = esc(result);
  for (const { token, html } of placeholders) result = result.replace(token, html);
  return result;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ output: string; error: string | null; images: string[] } | null>(null);
  const highlighted = useMemo(() => highlightCode(code), [code]);
  useEffect(() => { if (copied) { const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); } }, [copied]);

  const isPython = !language || language === 'python' || language === 'py';

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const resp = await fetch(`${API_BASE}/api/tools/python`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await resp.json();
      setResult(data);
    } catch {
      setResult({ output: '', error: 'Ошибка сети', images: [] });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-lg overflow-hidden my-3 border border-border">
      <div className="flex items-center justify-between bg-muted/50 border-b border-border px-3 py-1.5">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{language || 'код'}</span>
        <div className="flex items-center gap-1">
          {isPython && (
            <button onClick={handleRun} disabled={running}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors disabled:opacity-30">
              {running
                ? <><Loader2 className="h-3 w-3 animate-spin" /><span>Выполняю...</span></>
                : <><Play className="h-3 w-3" /><span>Выполнить</span></>
              }
            </button>
          )}
          <button onClick={() => { navigator.clipboard.writeText(code); setCopied(true); }}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            {copied ? <><ClipboardCheck className="h-3 w-3 text-foreground/50" /><span className="text-foreground/50">Скопировано</span></> :
              <><Clipboard className="h-3 w-3" /><span>Копировать</span></>}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto bg-muted/30 p-3 text-[13.5px] font-mono leading-relaxed">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
      {/* Execution result */}
      {result && (
        <div className="border-t border-border bg-muted/20 px-3 py-2 animate-fade-in">
          {result.error ? (
            <pre className="text-[12px] text-red-400/70 font-mono whitespace-pre-wrap">{result.error}</pre>
          ) : (
            <>
              {result.output && (
                <pre className="text-[12px] text-foreground/60 font-mono whitespace-pre-wrap">{result.output}</pre>
              )}
              {result.images?.map((img, i) => (
                <img key={i} src={`data:image/png;base64,${img}`} alt={`Результат ${i + 1}`}
                  className="mt-2 rounded-lg max-w-full" />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Domain detection from reasoning trace ── */

function getDomain(message: Message): string | null {
  if (!message.reasoning_trace) return null;
  try {
    const steps: ThinkingStep[] = JSON.parse(message.reasoning_trace);
    for (const step of steps) {
      if (step.metadata?.domain) return step.metadata.domain as string;
    }
  } catch {}
  return null;
}

/* ── Main component ── */

const ChatMessageInner = memo(function ChatMessage({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const regenRef = useRef<HTMLDivElement>(null);
  // Determine if menu should open upward or downward
  const regenDropUp = useMemo(() => {
    if (!regenOpen || !regenRef.current) return true;
    const rect = regenRef.current.getBoundingClientRect();
    return rect.top > 300; // If button is >300px from top, open upward; otherwise downward
  }, [regenOpen]);
  const isUser = message.role === 'user';

  useEffect(() => { if (copied) { const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); } }, [copied]);

  const domain = useMemo(() => getDomain(message), [message]);
  const strategyBarClass = !isUser && message.reasoning_strategy && message.reasoning_strategy !== 'none'
    ? `strategy-bar-${message.reasoning_strategy}` : '';

  const handleCopy = () => { navigator.clipboard.writeText(message.content); setCopied(true); };
  const handleEdit = () => {
    const store = useChatStore.getState();
    const idx = store.messages.findIndex((m) => m.id === message.id);
    if (idx >= 0) useChatStore.setState({ messages: store.messages.slice(0, idx) });
    window.dispatchEvent(new CustomEvent('deepthink:edit-message', { detail: message.content }));
  };
  const handleFork = async () => {
    const store = useChatStore.getState();
    const convId = store.activeConversationId;
    if (!convId) return;
    const idx = store.messages.findIndex((m) => m.id === message.id);
    if (idx >= 0) await useForkStore.getState().createFork(convId, idx);
  };
  const handleRegenerate = (selectedStrategy: ReasoningStrategy) => {
    const store = useChatStore.getState();
    const msgs = store.messages;
    const idx = msgs.findIndex((m) => m.id === message.id);
    const userMsg = msgs.slice(0, idx).reverse().find((m) => m.role === 'user');
    if (!userMsg) return;
    useChatStore.setState({ messages: msgs.slice(0, idx) });
    store.updateSettings({ strategy: selectedStrategy });
    store.sendMessage(userMsg.content);
    setRegenOpen(false);
  };

  const handleConfidenceClick = () => {
    // Parse reasoning trace and open inspect panel with ThinkingPanel content
    let steps: ThinkingStep[] = [];
    if (message.reasoning_trace) {
      try { steps = JSON.parse(message.reasoning_trace); } catch {}
    }
    const content = steps.length > 0 ? (
      <ThinkingPanel
        steps={steps}
        strategy={message.reasoning_strategy || 'none'}
      />
    ) : null;
    window.dispatchEvent(new CustomEvent('deepthink:open-inspect', {
      detail: { mode: 'reasoning', content }
    }));
  };

  // Domain-aware: hide confidence for creative writing
  const showConfidence = !isUser && domain !== 'creative_writing';
  // Domain-aware: hide strategy badge for creative writing
  const showStrategyBadge = !isUser && message.reasoning_strategy && message.reasoning_strategy !== 'none' && domain !== 'creative_writing';

  return (
    <div className={cn('animate-message-appear group mb-6', isUser ? 'flex justify-end' : '')}>
      <div className={cn('max-w-full', isUser ? 'max-w-[80%]' : '')}>
        {/* Hover actions — above message, invisible by default */}
        <div className={cn(
          'flex items-center gap-0.5 mb-1 h-6 opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100',
          isUser ? 'justify-end' : 'justify-start',
        )}>
          <button onClick={handleCopy} title="Копировать"
            className="rounded-md p-1 text-muted-foreground/50 hover:text-foreground transition-colors">
            {copied ? <Check className="h-4 w-4 text-foreground/50" /> : <Copy className="h-4 w-4" />}
          </button>
          {isUser && (
            <button onClick={handleEdit} title="Редактировать"
              className="rounded-md p-1 text-muted-foreground/50 hover:text-foreground transition-colors">
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {!isUser && (
            <>
              <button onClick={handleFork} title="Ответвление"
                className="rounded-md p-1 text-muted-foreground/50 hover:text-foreground transition-colors">
                <GitFork className="h-4 w-4" />
              </button>
              <div className="relative" ref={regenRef}>
                <button onClick={() => setRegenOpen(!regenOpen)} title="Перегенерировать"
                  className="rounded-md p-1 text-muted-foreground/50 hover:text-foreground transition-colors">
                  <RefreshCw className="h-4 w-4" />
                </button>
                {regenOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setRegenOpen(false)} />
                    <div className={cn(
                      'absolute left-0 z-50 w-56 rounded-xl border border-border bg-card shadow-xl p-1 animate-fade-in-scale',
                      regenDropUp ? 'bottom-full mb-1' : 'top-full mt-1',
                    )}>
                      {STRATEGIES.map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <button key={opt.key} onClick={() => handleRegenerate(opt.key)}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors">
                            <Icon className={cn('h-3.5 w-3.5', opt.color)} strokeWidth={1.5} />
                            {STRATEGY_LABELS_RU[opt.key] || opt.key}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
          {/* Timestamp on hover */}
          <span className="text-[11px] font-mono text-muted-foreground/40 ml-1 tracking-wide">
            {formatTimestamp(message.created_at)}
          </span>
        </div>

        {/* Message content */}
        <div className={cn(
          domain ? `domain-${domain}` : '',
        )}>
          <div className={cn(
            'rounded-2xl px-4 py-3',
            isUser
              ? 'bg-card border border-border'
              : cn(strategyBarClass && 'border-l-2', strategyBarClass),
          )}>
            {isUser ? (
              <p className="text-[15px] whitespace-pre-wrap break-words">{message.content}</p>
            ) : (
              <div className="prose prose-sm max-w-none break-words text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}
                  urlTransform={(url) => url}
                  components={{
                    code({ className, children, ...props }) {
                      const isBlock = className?.startsWith('language-');
                      if (!isBlock) return <code className={className} {...props}>{children}</code>;
                      return <CodeBlock language={className?.replace('language-', '') || ''} code={String(children).replace(/\n$/, '')} />;
                    },
                    img({ src, alt, ...props }) {
                      return <img src={src} alt={alt || ''} className="my-3 rounded-lg max-w-full" loading="lazy" {...props} />;
                    },
                  }}
                >{cleanAssistantContent(message.content)}</ReactMarkdown>
              </div>
            )}
          </div>

          {/* ConfidenceBar + Strategy badge — only for assistant messages */}
          {!isUser && (
            <div className="mt-1.5 space-y-1">
              {showConfidence && (
                <ConfidenceBar
                  strategy={message.reasoning_strategy}
                  reasoningTrace={message.reasoning_trace}
                  onClick={handleConfidenceClick}
                />
              )}
              {showStrategyBadge && (
                <div className="flex items-center gap-1.5">
                  {(() => { const s = getStrategy(message.reasoning_strategy!); const I = s.icon; return <I className={cn('h-3 w-3', s.color)} strokeWidth={1.5} />; })()}
                  <span className="text-[11px] text-muted-foreground/50">
                    {STRATEGY_LABELS_RU[message.reasoning_strategy!] || message.reasoning_strategy}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export const ChatMessage = ChatMessageInner;
