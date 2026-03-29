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
  Clipboard, ClipboardCheck, Play, Loader2, Download,
  PanelRightOpen, Pin,
} from 'lucide-react';
import { API_BASE } from '@/lib/api';
import { useChatStore } from '@/stores/chatStore';
import { useForkStore } from '@/stores/forkStore';
import { useArtifactStore } from '@/stores/artifactStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { STRATEGIES, getStrategy } from '@/lib/strategies';

/* ── Extract code blocks from markdown and return cleaned text + code entries ── */

interface ExtractedCode {
  language: string;
  code: string;
}

interface ExtractedBlock {
  type: 'code' | 'mermaid';
  language: string;
  code: string;
  title: string;
}

function extractCodeBlocks(markdown: string): { cleaned: string; codeBlocks: ExtractedCode[]; allBlocks: ExtractedBlock[] } {
  const codeBlocks: ExtractedCode[] = [];
  const allBlocks: ExtractedBlock[] = [];
  const cleaned = markdown.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const trimmed = code.trimEnd();
    if (lang === 'mermaid') {
      allBlocks.push({ type: 'mermaid', language: 'mermaid', code: trimmed, title: 'Диаграмма' });
      return match; // Keep mermaid blocks visible — they are diagrams, not code
    }
    const language = lang || 'code';
    codeBlocks.push({ language, code: trimmed });
    // Derive a title from first meaningful line or filename patterns
    const firstLine = trimmed.split('\n')[0] || '';
    const fileMatch = firstLine.match(/[#/]\s*(\S+\.\w+)/) || firstLine.match(/(\w+\.\w+)/);
    const title = fileMatch ? fileMatch[1] : `${language} код`;
    allBlocks.push({ type: 'code', language, code: trimmed, title });
    return '';
  });
  return { cleaned: cleaned.replace(/\n{3,}/g, '\n\n').trim(), codeBlocks, allBlocks };
}

/* ── PDF download helper ── */

async function downloadPdf(markdown: string, filename: string) {
  const resp = await fetch(`${API_BASE}/api/export/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown, filename, title: filename.replace(/\.pdf$/i, '') }),
  });
  if (!resp.ok) return;
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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

/* ── Open artifact helper ── */

function openArtifactByCode(code: string) {
  const store = useArtifactStore.getState();
  const match = store.artifacts.find((a) => a.content === code);
  if (match) {
    store.setActive(match.id);
  }
}

/* ── Mermaid Diagram Block ── */

function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
          fontFamily: 'Geist, system-ui, sans-serif',
          fontSize: 13,
        });
        const id = `mermaid-${Math.random().toString(36).slice(2, 8)}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3 my-3">
        <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">{code}</pre>
      </div>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-border bg-card/50 overflow-x-auto">
      <div ref={containerRef} className="p-4" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="border-t border-border px-3 py-1.5 flex justify-end">
        <button
          onClick={() => openArtifactByCode(code)}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors"
        >
          <PanelRightOpen className="h-3 w-3" /><span>Открыть в панели</span>
        </button>
      </div>
    </div>
  );
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
          <button onClick={() => openArtifactByCode(code)}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors">
            <PanelRightOpen className="h-3 w-3" /><span>Открыть в панели</span>
          </button>
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

/* ── Image with artifact tracking (side effect in useEffect, not render) ── */

function ImageWithArtifact({ src, alt, messageId, ...props }: { src?: string; alt?: string; messageId: string; [k: string]: any }) {
  useEffect(() => {
    if (!src) return;
    const aStore = useArtifactStore.getState();
    const exists = aStore.artifacts.some((a) => a.type === 'image' && a.content === src && a.messageId === messageId);
    if (!exists) {
      aStore.addArtifact({
        type: 'image',
        title: alt || 'Изображение',
        content: src,
        messageId,
      });
    }
  }, [src, alt, messageId]);

  return <img src={src} alt={alt || ''} className="my-3 rounded-lg max-w-full" loading="lazy" {...props} />;
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

  // Extract code blocks from assistant messages → hide in reasoning panel
  const { displayContent, codeBlocks, codeThinkingSteps, allBlocks } = useMemo(() => {
    if (isUser) return { displayContent: message.content, codeBlocks: [] as ExtractedCode[], codeThinkingSteps: [] as ThinkingStep[], allBlocks: [] as ExtractedBlock[] };
    const cleaned = cleanAssistantContent(message.content);
    const { cleaned: withoutCode, codeBlocks: blocks, allBlocks } = extractCodeBlocks(cleaned);
    const steps: ThinkingStep[] = blocks.map((b, i) => ({
      step_number: i + 1,
      strategy: 'code_generation',
      content: `Сгенерирован код (${b.language})`,
      duration_ms: 0,
      metadata: { type: 'code_generation', content: b.code, language: b.language },
    }));

    return { displayContent: withoutCode, codeBlocks: blocks, codeThinkingSteps: steps, allBlocks };
  }, [message.content, message.id, isUser]);

  // Create artifacts for extracted code/mermaid blocks (side effect — must be in useEffect)
  useEffect(() => {
    if (isUser || allBlocks.length === 0) return;
    const store = useArtifactStore.getState();
    const existing = store.artifacts.filter((a) => a.messageId === message.id);
    if (existing.length > 0) return;
    for (const block of allBlocks) {
      store.addArtifact({
        type: block.type,
        title: block.title,
        content: block.code,
        language: block.type === 'code' ? block.language : undefined,
        messageId: message.id,
      });
    }
  }, [message.id, isUser, allBlocks]);

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

  const handlePinToCanvas = () => {
    useCanvasStore.getState().addFromMessage(message.content, message.conversation_id);
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
          <button onClick={handlePinToCanvas} title="На канвас"
            className="rounded-md p-1 text-muted-foreground/50 hover:text-foreground transition-colors">
            <Pin className="h-4 w-4" />
          </button>
          {/* Timestamp on hover */}
          <span className="text-[11px] font-mono text-muted-foreground/40 ml-1 tracking-wide">
            {formatTimestamp(message.created_at)}
          </span>
        </div>

        {/* Message content */}
        <div className={cn(
          domain ? `domain-${domain}` : '',
        )}>
          {/* Code blocks hidden in reasoning panel */}
          {!isUser && codeBlocks.length > 0 && (
            <ThinkingPanel
              steps={codeThinkingSteps}
              strategy={message.reasoning_strategy || 'none'}
            />
          )}

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
                      const lang = className?.replace('language-', '') || '';
                      const codeStr = String(children).replace(/\n$/, '');
                      if (lang === 'mermaid') return <MermaidBlock code={codeStr} />;
                      return <CodeBlock language={lang} code={codeStr} />;
                    },
                    img({ src, alt, ...props }) {
                      return <ImageWithArtifact src={src} alt={alt} messageId={message.id} {...props} />;
                    },
                    a({ href, children }) {
                      const text = String(children);
                      if (href?.endsWith('.pdf') || text.endsWith('.pdf')) {
                        const filename = text.endsWith('.pdf') ? text : 'export.pdf';
                        return (
                          <button
                            onClick={() => downloadPdf(displayContent, filename)}
                            className="inline-flex items-center gap-1 text-foreground underline underline-offset-2 hover:opacity-70 transition-opacity"
                          >
                            <Download className="h-3.5 w-3.5" />
                            {children}
                          </button>
                        );
                      }
                      return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
                    },
                  }}
                >{displayContent}</ReactMarkdown>
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
