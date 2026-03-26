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
      return <Search className="h-3 w-3 text-muted-foreground" />;
    case 'tool_result':
      return <Globe className="h-3 w-3 text-muted-foreground" />;
    case 'tool_error':
      return <AlertTriangle className="h-3 w-3 text-muted-foreground" />;
    case 'reasoning':
    case 'extracted_thinking':
    case 'cot_activation':
      return <Brain className="h-3 w-3 text-muted-foreground" />;
    case 'vote':
    case 'synthesis':
    case 'tree_synthesis':
      return <CheckCircle2 className="h-3 w-3 text-muted-foreground" />;
    case 'candidate':
    case 'branch':
      return <Globe className="h-3 w-3 text-muted-foreground" />;
    default:
      return <Wrench className="h-3 w-3 text-muted-foreground" />;
  }
}

// ── Left border — all monochrome with subtle brightness differences ──

function getAccent(type?: string): string {
  switch (type) {
    case 'tool_call': return 'border-l-foreground/20';
    case 'tool_result': return 'border-l-foreground/15';
    case 'tool_error': return 'border-l-foreground/25';
    case 'reasoning':
    case 'extracted_thinking':
    case 'cot_activation': return 'border-l-foreground/15';
    case 'vote':
    case 'synthesis':
    case 'tree_synthesis': return 'border-l-foreground/10';
    case 'candidate':
    case 'branch': return 'border-l-foreground/15';
    default: return 'border-l-foreground/10';
  }
}

// ── TRIZ #11: Mini tree visualization for Tree of Thoughts ──

interface TreeNode {
  id: string;
  level: number;
  branch: number;
  score: number;
  parent: string | null;
  content: string;
  isBestPath?: boolean;
}

function MiniTreeView({ steps }: { steps: ThinkingStep[] }) {
  // Extract tree nodes from thinking steps
  const nodes: TreeNode[] = [];
  const bestPath: string[] = [];

  for (const step of steps) {
    const m = step.metadata || {};
    if (m.type === 'branch' && m.node_id) {
      nodes.push({
        id: m.node_id as string,
        level: (m.level as number) ?? 0,
        branch: (m.branch as number) ?? 0,
        score: (m.score as number) ?? 0.5,
        parent: (m.parent as string) ?? null,
        content: (m.content as string) ?? step.content,
      });
    }
    if (m.type === 'synthesis' && Array.isArray(m.best_path)) {
      bestPath.push(...(m.best_path as string[]));
    }
  }

  if (nodes.length === 0) {
    // Fallback to flat list
    return (
      <div className="text-xs text-muted-foreground/50 text-center py-2">
        Нет данных для визуализации дерева
      </div>
    );
  }

  // Mark best path nodes
  const bestSet = new Set(bestPath);
  for (const n of nodes) n.isBestPath = bestSet.has(n.id);

  // Group by level
  const levels: Map<number, TreeNode[]> = new Map();
  for (const n of nodes) {
    if (!levels.has(n.level)) levels.set(n.level, []);
    levels.get(n.level)!.push(n);
  }

  const scoreColor = (score: number) =>
    score >= 0.8 ? 'text-green-400 bg-green-400/10' :
    score >= 0.5 ? 'text-yellow-400 bg-yellow-400/10' :
    'text-red-400 bg-red-400/10';

  return (
    <div className="flex gap-4 overflow-x-auto py-1">
      {Array.from(levels.entries()).sort(([a], [b]) => a - b).map(([level, levelNodes]) => (
        <div key={level} className="flex flex-col gap-1.5 min-w-[140px]">
          <span className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">
            Уровень {level + 1}
          </span>
          {levelNodes.map((node) => (
            <div
              key={node.id}
              className={cn(
                'rounded-lg border px-2 py-1.5 text-[11px] transition-all',
                node.isBestPath
                  ? 'border-foreground/30 bg-foreground/5 font-medium'
                  : 'border-border bg-card/50',
              )}
            >
              <div className="flex items-center justify-between gap-1 mb-0.5">
                <span className={cn('rounded px-1 py-0.5 text-[9px] font-mono', scoreColor(node.score))}>
                  {node.score.toFixed(2)}
                </span>
                {node.isBestPath && (
                  <CheckCircle2 className="h-2.5 w-2.5 text-foreground/50" />
                )}
              </div>
              <p className="text-muted-foreground line-clamp-2 leading-tight">
                {node.content.slice(0, 80)}
              </p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
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
            <Search className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50" />
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
            <Globe className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50" />
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

      {/* Steps list — tree visualization for tree_of_thoughts, flat list for others */}
      {!collapsed && strategy === 'tree_of_thoughts' && (
        <div className="rounded-b-lg border border-t-0 border-border bg-card/30 p-3">
          <MiniTreeView steps={steps} />
        </div>
      )}
      {!collapsed && strategy !== 'tree_of_thoughts' && (
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
