import { useState, useEffect } from 'react';
import type { ThinkingStep, StrategySelectedEvent } from '@/types';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Search, Globe, Wrench, AlertTriangle, Loader2, CheckCircle2, Brain } from 'lucide-react';

interface Props {
  steps: ThinkingStep[];
  strategy: string;
  isLive?: boolean;
  persona?: StrategySelectedEvent | null;
  clarificationQuestion?: string | null;
  onClarificationSubmit?: (answer: string) => void;
}

// ── Icon per step type ──

function StepIcon({ type }: { type?: string }) {
  switch (type) {
    case 'tool_call':
      return <Search className="h-3 w-3 text-indigo-400" />;
    case 'tool_result':
      return <Globe className="h-3 w-3 text-cyan-400" />;
    case 'tool_error':
      return <AlertTriangle className="h-3 w-3 text-red-400" />;
    case 'reasoning':
    case 'extracted_thinking':
    case 'cot_activation':
      return <Brain className="h-3 w-3 text-blue-400" />;
    case 'vote':
    case 'synthesis':
    case 'tree_synthesis':
      return <CheckCircle2 className="h-3 w-3 text-emerald-400" />;
    case 'candidate':
    case 'branch':
      return <Globe className="h-3 w-3 text-orange-400" />;
    default:
      return <Wrench className="h-3 w-3 text-muted-foreground" />;
  }
}

// ── Accent color for the left border per type ──

function getAccent(type?: string): string {
  switch (type) {
    case 'tool_call': return 'border-l-indigo-400';
    case 'tool_result': return 'border-l-cyan-400';
    case 'tool_error': return 'border-l-red-400';
    case 'reasoning':
    case 'extracted_thinking':
    case 'cot_activation': return 'border-l-blue-400';
    case 'vote':
    case 'synthesis':
    case 'tree_synthesis': return 'border-l-emerald-400';
    case 'candidate':
    case 'branch': return 'border-l-orange-400';
    default: return 'border-l-muted-foreground/40';
  }
}

// ── Single collapsible reasoning block ──

function ReasoningBlock({ step, isLast, isLive }: { step: ThinkingStep; isLast: boolean; isLive: boolean }) {
  const [open, setOpen] = useState(false);
  const type = step.metadata?.type as string | undefined;
  const detail = step.metadata?.content as string | undefined;
  const hasDetail = !!detail && detail.length > 0;

  return (
    <div className={cn('border-l-2 animate-fade-in', getAccent(type))}>
      {/* Block header — title is the action being performed */}
      <button
        onClick={() => hasDetail && setOpen(!open)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
          hasDetail && 'hover:bg-accent/20 cursor-pointer',
          !hasDetail && 'cursor-default',
        )}
      >
        {/* Live spinner for last active step */}
        {isLive && isLast ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
        ) : (
          <StepIcon type={type} />
        )}

        <span className="text-xs text-foreground flex-1 min-w-0 truncate">
          {step.content}
        </span>

        {hasDetail && (
          open
            ? <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" />
            : <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        )}
      </button>

      {/* Expanded detail */}
      {open && hasDetail && (
        <div className="px-3 pb-2 pl-8">
          <DetailContent type={type} content={detail} />
        </div>
      )}
    </div>
  );
}

// ── Render detail content based on step type ──

function DetailContent({ type, content }: { type?: string; content: string }) {
  // Tool calls — show as search-query-like lines
  if (type === 'tool_call') {
    return (
      <div className="space-y-0.5">
        {content.split('\n').filter(Boolean).map((line, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Search className="h-2.5 w-2.5 shrink-0 text-indigo-400/60" />
            <span className="truncate font-mono">{line}</span>
          </div>
        ))}
      </div>
    );
  }

  // Tool results — show as source-like lines
  if (type === 'tool_result') {
    const lines = content.split('\n').filter(Boolean);
    const show = lines.slice(0, 4);
    const rest = lines.length - 4;
    return (
      <div className="space-y-0.5">
        {show.map((line, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Globe className="h-2.5 w-2.5 shrink-0 text-cyan-400/60" />
            <span className="truncate">{line}</span>
          </div>
        ))}
        {rest > 0 && (
          <span className="text-[10px] text-muted-foreground/50 pl-4">+{rest} ещё</span>
        )}
      </div>
    );
  }

  // Default — plain text reasoning
  return (
    <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap line-clamp-[12]">
      {content}
    </p>
  );
}

// ── Main ThinkingPanel ──

export function ThinkingPanel({ steps, strategy, isLive, persona, clarificationQuestion, onClarificationSubmit }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [clarificationAnswer, setClarificationAnswer] = useState('');

  // Auto-expand when live
  useEffect(() => {
    if (isLive) setCollapsed(false);
  }, [isLive]);

  if (steps.length === 0 && !isLive) return null;

  return (
    <div className="mb-3 overflow-hidden">
      {/* Collapsible outer wrapper */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 rounded-t-lg bg-accent/30 px-3 py-2 text-left transition-colors hover:bg-accent/50"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}

        <span className="text-xs font-medium text-foreground">
          {isLive ? 'Рассуждаю' : 'Рассуждение'}
        </span>

        <span className="text-[10px] text-muted-foreground/60">
          {steps.length} {steps.length === 1 ? 'шаг' : steps.length < 5 ? 'шага' : 'шагов'}
        </span>

        {isLive && (
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
          </span>
        )}
      </button>

      {/* Steps list */}
      {!collapsed && (
        <div className="rounded-b-lg border border-t-0 border-border bg-card/30 divide-y divide-border/30">
          {steps.map((step, i) => (
            <ReasoningBlock
              key={i}
              step={step}
              isLast={i === steps.length - 1}
              isLive={!!isLive}
            />
          ))}

          {/* Empty live state */}
          {isLive && steps.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Анализирую запрос...</span>
            </div>
          )}
        </div>
      )}

      {/* Clarification prompt */}
      {clarificationQuestion && (
        <div className="border border-t-0 border-border rounded-b-lg px-3 py-3 bg-card/30">
          <p className="text-xs font-medium text-foreground mb-2">{clarificationQuestion}</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={clarificationAnswer}
              onChange={(e) => setClarificationAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && clarificationAnswer.trim() && onClarificationSubmit) {
                  onClarificationSubmit(clarificationAnswer.trim());
                  setClarificationAnswer('');
                }
              }}
              placeholder="Ваш ответ..."
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
            <button
              onClick={() => {
                if (clarificationAnswer.trim() && onClarificationSubmit) {
                  onClarificationSubmit(clarificationAnswer.trim());
                  setClarificationAnswer('');
                }
              }}
              disabled={!clarificationAnswer.trim()}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                clarificationAnswer.trim()
                  ? 'bg-foreground text-background hover:bg-foreground/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed',
              )}
            >
              Ответить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
