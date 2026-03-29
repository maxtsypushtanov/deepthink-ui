import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  X, Copy, Check, Download, Play, Loader2,
  FileCode, FileText, Table, GitBranch, Image,
  ChevronDown,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { useArtifactStore, type ArtifactType } from '@/stores/artifactStore';
import { API_BASE } from '@/lib/api';

/* ── Type icons ── */

const TYPE_ICONS: Record<ArtifactType, typeof FileCode> = {
  code: FileCode,
  document: FileText,
  table: Table,
  mermaid: GitBranch,
  image: Image,
};

const TYPE_LABELS: Record<ArtifactType, string> = {
  code: 'Код',
  document: 'Документ',
  table: 'Таблица',
  mermaid: 'Диаграмма',
  image: 'Изображение',
};

/* ── Syntax highlight (same as ChatMessage) ── */

const KW_REGEX = /\b(function|const|let|var|return|if|else|for|while|import|export|from|class|def|async|await|try|catch|throw|new|type|interface|extends|implements|yield|switch|case|break|continue|default|do|in|of|typeof|instanceof|void|null|undefined|true|false|None|True|False|self|this|print|raise|except|finally|with|as|lambda|pass|del|global|nonlocal|assert|elif|struct|enum|fn|pub|mod|use|impl|trait|match|mut|ref|where|package|func|go|defer|chan|select|map|range|fmt|println|main)\b/g;
const STR_REGEX = /(["'`])(?:(?!\1|\\).|\\.)*?\1/g;
const COMMENT_REGEX = /(\/\/.*?$|#.*?$|\/\*[\s\S]*?\*\/)/gm;
const NUM_REGEX = /\b(\d+\.?\d*(?:e[+-]?\d+)?|0x[0-9a-f]+)\b/gi;
const FUNC_REGEX = /\b([a-zA-Z_]\w*)\s*\(/g;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

/* ── Mermaid renderer ── */

function MermaidRenderer({ code }: { code: string }) {
  const [svg, setSvg] = useState('');
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
        const id = `mermaid-panel-${Math.random().toString(36).slice(2, 8)}`;
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
      <div className="p-4">
        <p className="mb-2 text-xs font-medium text-destructive">Ошибка рендеринга диаграммы</p>
        <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">{code}</pre>
        <p className="mt-2 text-xs text-destructive">{error}</p>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className="p-4 overflow-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/* ── Table renderer ── */

function TableRenderer({ content }: { content: string }) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const { headers, rows } = useMemo(() => {
    const lines = content.trim().split('\n').filter((l) => l.trim());
    if (lines.length === 0) return { headers: [] as string[], rows: [] as string[][] };

    // Try to parse as markdown table
    const headerLine = lines[0];
    const cells = (line: string) =>
      line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);

    const hdrs = cells(headerLine);
    // Skip separator line (---|---|---)
    const startIdx = lines[1]?.match(/^[\s|:-]+$/) ? 2 : 1;
    const dataRows = lines.slice(startIdx).map(cells);

    return { headers: hdrs, rows: dataRows };
  }, [content]);

  const sortedRows = useMemo(() => {
    if (sortCol === null) return rows;
    return [...rows].sort((a, b) => {
      const va = a[sortCol] ?? '';
      const vb = b[sortCol] ?? '';
      const na = Number(va), nb = Number(vb);
      if (!isNaN(na) && !isNaN(nb)) return sortAsc ? na - nb : nb - na;
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [rows, sortCol, sortAsc]);

  const handleSort = (col: number) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  };

  return (
    <div className="overflow-auto p-4">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                onClick={() => handleSort(i)}
                className="border border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors select-none"
              >
                {h}
                {sortCol === i && (
                  <span className="ml-1">{sortAsc ? '↑' : '↓'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => (
            <tr key={i} className="hover:bg-muted/30 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="border border-border px-3 py-1.5 text-foreground">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Code renderer with line numbers ── */

function CodeRenderer({ code, language }: { code: string; language?: string }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ output: string; error: string | null; images: string[] } | null>(null);
  const highlighted = useMemo(() => highlightCode(code), [code]);
  const lines = code.split('\n');
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
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 shrink-0">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {language || 'код'}
        </span>
        {isPython && (
          <button
            onClick={handleRun}
            disabled={running}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors disabled:opacity-30"
          >
            {running
              ? <><Loader2 className="h-3 w-3 animate-spin" /><span>Выполняю...</span></>
              : <><Play className="h-3 w-3" /><span>Выполнить</span></>
            }
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        <pre className="p-3 text-[13px] font-mono leading-relaxed">
          <table className="border-collapse">
            <tbody>
              {lines.map((_, i) => (
                <tr key={i}>
                  <td className="pr-4 text-right text-muted-foreground/40 select-none align-top text-[12px] w-[1%] whitespace-nowrap">
                    {i + 1}
                  </td>
                  <td className="whitespace-pre">
                    <code
                      dangerouslySetInnerHTML={{
                        __html: highlightCode(lines[i]),
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </pre>
      </div>
      {result && (
        <div className="border-t border-border bg-muted/20 px-3 py-2 shrink-0 max-h-[200px] overflow-auto">
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

/* ── Document renderer ── */

function DocumentRenderer({ content }: { content: string }) {
  return (
    <div className="p-4 overflow-auto prose prose-sm max-w-none text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

/* ── Image renderer ── */

function ImageRenderer({ content }: { content: string }) {
  return (
    <div className="flex items-center justify-center p-4 overflow-auto">
      <img
        src={content}
        alt="Артефакт"
        className="max-w-full max-h-full rounded-lg"
      />
    </div>
  );
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

/* ── Main Panel ── */

const ANIM_MS = 250;

export function ArtifactPanel() {
  const panelOpen = useArtifactStore((s) => s.panelOpen);
  const activeId = useArtifactStore((s) => s.activeArtifactId);
  const artifacts = useArtifactStore((s) => s.artifacts);
  const closePanel = useArtifactStore((s) => s.closePanel);

  const artifact = artifacts.find((a) => a.id === activeId) ?? null;

  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [versionIdx, setVersionIdx] = useState<number | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);

  // Reset version selector when artifact changes
  useEffect(() => {
    setVersionIdx(null);
    setVersionOpen(false);
  }, [activeId]);

  useEffect(() => {
    if (panelOpen) {
      setMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
      const timer = setTimeout(() => setMounted(false), ANIM_MS);
      return () => clearTimeout(timer);
    }
  }, [panelOpen]);

  // Escape to close
  useEffect(() => {
    if (!mounted) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closePanel(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mounted, closePanel]);

  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(t);
    }
  }, [copied]);

  const displayContent = useMemo(() => {
    if (!artifact) return '';
    if (versionIdx !== null && artifact.versions[versionIdx]) {
      return artifact.versions[versionIdx].content;
    }
    return artifact.content;
  }, [artifact, versionIdx]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(displayContent);
    setCopied(true);
  }, [displayContent]);

  const handleDownload = useCallback(() => {
    if (!artifact) return;

    if (artifact.type === 'document') {
      downloadPdf(displayContent, `${artifact.title}.pdf`);
      return;
    }

    // For code and other text types, download as file
    const ext = artifact.language === 'python' || artifact.language === 'py' ? '.py'
      : artifact.language === 'javascript' || artifact.language === 'js' ? '.js'
      : artifact.language === 'typescript' || artifact.language === 'ts' ? '.ts'
      : artifact.language === 'html' ? '.html'
      : artifact.language === 'css' ? '.css'
      : artifact.language === 'json' ? '.json'
      : artifact.type === 'mermaid' ? '.mmd'
      : artifact.type === 'table' ? '.csv'
      : '.txt';

    let downloadContent = displayContent;
    if (artifact.type === 'table') {
      // Convert markdown table to CSV
      const lines = displayContent.trim().split('\n').filter((l) => l.trim());
      const cells = (line: string) =>
        line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
      const csvLines = lines.filter((l) => !l.match(/^[\s|:-]+$/)).map((l) => cells(l).join(','));
      downloadContent = csvLines.join('\n');
    }

    if (artifact.type === 'image') {
      const a = document.createElement('a');
      a.href = displayContent;
      a.download = artifact.title;
      a.click();
      return;
    }

    const blob = new Blob([downloadContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.title}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [artifact, displayContent]);

  if (!mounted) return null;

  const Icon = artifact ? TYPE_ICONS[artifact.type] : FileCode;
  const versionCount = artifact?.versions.length ?? 0;

  return (
    <>
      {/* Backdrop on mobile */}
      <div
        className={cn(
          'fixed inset-0 z-30 bg-black/20 backdrop-blur-[1px] xl:hidden transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        onClick={closePanel}
      />

      <aside
        className={cn(
          'flex flex-col border-l border-border bg-card overflow-hidden shrink-0 z-40',
          'fixed right-0 top-0 bottom-0 w-[480px] xl:relative xl:w-[480px]',
          'transition-transform ease-out',
          visible ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ transitionDuration: `${ANIM_MS}ms` }}
      >
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-[13px] font-medium text-foreground truncate">
              {artifact?.title || 'Артефакт'}
            </span>
            {artifact && (
              <span className="text-[11px] text-muted-foreground/50 shrink-0">
                {TYPE_LABELS[artifact.type]}
              </span>
            )}
            {versionCount > 1 && (
              <span className="text-[10px] text-muted-foreground/40 shrink-0">
                v{versionIdx !== null ? versionIdx + 1 : versionCount}
              </span>
            )}
          </div>
          <button
            onClick={closePanel}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {!artifact ? (
            <div className="flex h-full items-center justify-center p-6">
              <p className="text-sm text-muted-foreground/30 text-center">
                Выберите артефакт для просмотра
              </p>
            </div>
          ) : artifact.type === 'code' ? (
            <CodeRenderer code={displayContent} language={artifact.language} />
          ) : artifact.type === 'document' ? (
            <DocumentRenderer content={displayContent} />
          ) : artifact.type === 'table' ? (
            <TableRenderer content={displayContent} />
          ) : artifact.type === 'mermaid' ? (
            <MermaidRenderer code={displayContent} />
          ) : artifact.type === 'image' ? (
            <ImageRenderer content={displayContent} />
          ) : null}
        </div>

        {/* Footer */}
        {artifact && (
          <footer className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2 gap-2">
            {/* Version selector */}
            {versionCount > 1 ? (
              <div className="relative">
                <button
                  onClick={() => setVersionOpen(!versionOpen)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
                >
                  <span>Версия {versionIdx !== null ? versionIdx + 1 : versionCount} из {versionCount}</span>
                  <ChevronDown className="h-3 w-3" />
                </button>
                {versionOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setVersionOpen(false)} />
                    <div className="absolute bottom-full mb-1 left-0 z-50 w-48 rounded-xl border border-border bg-card shadow-xl p-1 animate-fade-in-scale max-h-[200px] overflow-auto">
                      {artifact.versions.map((v, i) => (
                        <button
                          key={i}
                          onClick={() => { setVersionIdx(i); setVersionOpen(false); }}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors',
                            (versionIdx === i || (versionIdx === null && i === versionCount - 1)) && 'bg-muted',
                          )}
                        >
                          <span>v{i + 1}</span>
                          <span className="text-[10px] text-muted-foreground/50">
                            {new Date(v.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-1">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {copied
                  ? <><Check className="h-3 w-3" /><span>Скопировано</span></>
                  : <><Copy className="h-3 w-3" /><span>Скопировать</span></>
                }
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <Download className="h-3 w-3" />
                <span>Скачать</span>
              </button>
            </div>
          </footer>
        )}
      </aside>
    </>
  );
}
