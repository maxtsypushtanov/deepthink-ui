import { useState, useEffect, useRef } from 'react';
import type { ThinkingStep, StrategySelectedEvent } from '@/types';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Search, Globe, Wrench, AlertTriangle, Loader2, CheckCircle2, Brain, Code2, Users, Layers, Clock } from 'lucide-react';

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
    case 'code_generation':
      return <Code2 className="h-3 w-3 text-muted-foreground" />;
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

// ── Format duration ──

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}мс`;
  const s = (ms / 1000).toFixed(1);
  return `${s}с`;
}

// ── Detect language from code content ──

function detectLanguage(content: string): string {
  if (/^(import |from .+ import |def |class |async def )/.test(content)) return 'Python';
  if (/^(const |let |var |function |import .+ from |export )/.test(content)) return 'JavaScript';
  if (/^(interface |type |export (interface|type) )/.test(content)) return 'TypeScript';
  if (/^(package |func |type .+ struct)/.test(content)) return 'Go';
  if (/^(use |fn |pub |mod |struct |impl )/.test(content)) return 'Rust';
  if (/^(<[a-zA-Z]|<!DOCTYPE)/.test(content)) return 'HTML';
  if (/^(SELECT |INSERT |UPDATE |CREATE |ALTER )/i.test(content)) return 'SQL';
  if (/^\{|\[/.test(content.trim())) return 'JSON';
  return 'Код';
}

// ── Sentiment analysis for persona opinions ──

function analyzeStance(content: string): 'agree' | 'disagree' | 'neutral' {
  const lower = content.toLowerCase();
  const positiveSignals = [
    'согласен', 'поддерживаю', 'верно', 'правильно', 'хороший подход',
    'рекомендую', 'стоит', 'да,', 'определённо', 'безусловно',
    'эффективно', 'оптимально', 'agree', 'support', 'good',
  ];
  const negativeSignals = [
    'не согласен', 'против', 'сомневаюсь', 'рискованно', 'опасно',
    'не рекомендую', 'не стоит', 'проблем', 'слабо', 'нет,',
    'ошибочно', 'неоптимально', 'disagree', 'concern', 'risk',
  ];
  const pos = positiveSignals.filter(s => lower.includes(s)).length;
  const neg = negativeSignals.filter(s => lower.includes(s)).length;
  if (pos > neg) return 'agree';
  if (neg > pos) return 'disagree';
  return 'neutral';
}

// ── Persona role to emoji mapping ──

function personaEmoji(content: string): string {
  const lower = content.toLowerCase();
  if (lower.includes('скептик') || lower.includes('skeptic') || lower.includes('критик')) return '🔬';
  if (lower.includes('практик') || lower.includes('pragmat') || lower.includes('инженер')) return '🔧';
  if (lower.includes('адвокат') || lower.includes('devil') || lower.includes('оппонент')) return '⚖️';
  if (lower.includes('визионер') || lower.includes('vision') || lower.includes('стратег') || lower.includes('новатор')) return '🚀';
  if (lower.includes('аналитик') || lower.includes('analyst')) return '📊';
  if (lower.includes('пользовател') || lower.includes('user') || lower.includes('ux')) return '👤';
  return '💭';
}

// ── Extract persona name from step content ──

function extractPersonaName(content: string): string {
  // Try patterns like "Скептик: ..." or "[Практик] ..." or "**Визионер**"
  const colonMatch = content.match(/^([^:]{2,20}):/);
  if (colonMatch) return colonMatch[1].trim();
  const bracketMatch = content.match(/^\[([^\]]{2,20})\]/);
  if (bracketMatch) return bracketMatch[1].trim();
  const boldMatch = content.match(/^\*\*([^*]{2,20})\*\*/);
  if (boldMatch) return boldMatch[1].trim();
  return 'Эксперт';
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

// ── Typing dots animation for live steps ──

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1">
      <span className="thinking-dot h-1 w-1 rounded-full bg-muted-foreground/40" />
      <span className="thinking-dot h-1 w-1 rounded-full bg-muted-foreground/40" />
      <span className="thinking-dot h-1 w-1 rounded-full bg-muted-foreground/40" />
    </span>
  );
}

// ── Elapsed time tracker for live steps ──

function ElapsedTime({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 100);
    return () => clearInterval(interval);
  }, [startTime]);

  return (
    <span className="text-[9px] text-muted-foreground/40 font-mono tabular-nums shrink-0">
      {formatDuration(elapsed)}
    </span>
  );
}

// ── Persona Council Card ──

function PersonaCard({
  step,
  isLast,
  isLive,
  index,
}: {
  step: ThinkingStep;
  isLast: boolean;
  isLive: boolean;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const type = step.metadata?.type as string | undefined;
  const detail = step.metadata?.content as string | undefined;
  const isSynthesis = type === 'synthesis' || type === 'vote';
  const emoji = personaEmoji(step.content);
  const name = extractPersonaName(step.content);
  const stance = analyzeStance(detail || step.content);
  const liveStartRef = useRef(Date.now());

  // Reset timer when step changes
  useEffect(() => {
    liveStartRef.current = Date.now();
  }, [step.step_number]);

  if (isSynthesis) {
    // Moderator verdict card
    return (
      <div
        className="animate-fade-in border border-foreground/15 rounded-lg p-3 bg-foreground/[0.03]"
        style={{ animationDelay: `${index * 60}ms` }}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">Синтез мнений</span>
          {step.duration_ms > 0 && (
            <span className="text-[9px] text-muted-foreground/40 font-mono ml-auto">
              {formatDuration(step.duration_ms)}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
          {detail || step.content}
        </p>
      </div>
    );
  }

  return (
    <div
      className="animate-fade-in"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <button
        onClick={() => detail && setOpen(!open)}
        className={cn(
          'w-full rounded-lg border px-3 py-2 text-left transition-all',
          'border-border/60 bg-card/30',
          detail && 'hover:bg-accent/20 cursor-pointer',
          !detail && 'cursor-default',
        )}
      >
        <div className="flex items-center gap-2">
          {/* Emoji avatar */}
          <span className="text-sm shrink-0" role="img">{emoji}</span>

          {/* Name and stance */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-foreground truncate">{name}</span>
              {/* Stance indicator */}
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full shrink-0',
                  stance === 'agree' && 'bg-foreground/30',
                  stance === 'disagree' && 'bg-foreground/15',
                  stance === 'neutral' && 'bg-foreground/8',
                )}
                title={
                  stance === 'agree' ? 'Поддерживает' :
                  stance === 'disagree' ? 'Возражает' : 'Нейтрально'
                }
              />
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              {step.content.replace(/^[^:]*:\s*/, '').slice(0, 80)}
            </p>
          </div>

          {/* Duration or live indicator */}
          <div className="flex items-center gap-1 shrink-0">
            {isLive && isLast ? (
              <>
                <ElapsedTime startTime={liveStartRef.current} />
                <ThinkingDots />
              </>
            ) : step.duration_ms > 0 ? (
              <span className="text-[9px] text-muted-foreground/40 font-mono">
                {formatDuration(step.duration_ms)}
              </span>
            ) : null}
          </div>

          {detail && (
            open
              ? <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" />
              : <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          )}
        </div>
      </button>

      {open && detail && (
        <div className="px-3 pb-1 pt-1 pl-10">
          <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap line-clamp-[12]">
            {detail}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Budget Forcing Depth Meter ──

function DepthMeter({ currentRound, totalRounds }: { currentRound: number; totalRounds: number }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5">
      <Layers className="h-3 w-3 text-muted-foreground/50 shrink-0" />
      <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider shrink-0">
        Глубина
      </span>
      <div className="flex gap-0.5 flex-1">
        {Array.from({ length: totalRounds }, (_, i) => (
          <div
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-all duration-300',
              i < currentRound
                ? 'bg-foreground/20'
                : 'bg-foreground/5',
              i === currentRound - 1 && 'bg-foreground/30',
            )}
          />
        ))}
      </div>
      <span className="text-[9px] text-muted-foreground/40 font-mono tabular-nums shrink-0">
        {currentRound}/{totalRounds}
      </span>
    </div>
  );
}

// ── Budget Forcing Round Card ──

function BudgetRoundCard({
  step,
  roundNumber,
  totalRounds,
  isLast,
  isLive,
  index,
}: {
  step: ThinkingStep;
  roundNumber: number;
  totalRounds: number;
  isLast: boolean;
  isLive: boolean;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const type = step.metadata?.type as string | undefined;
  const detail = step.metadata?.content as string | undefined;
  const hasDetail = !!detail && detail.length > 0;
  const isFinalRound = isLast && !isLive;
  const liveStartRef = useRef(Date.now());

  useEffect(() => {
    liveStartRef.current = Date.now();
  }, [step.step_number]);

  return (
    <div
      className={cn(
        'animate-fade-in',
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <button
        onClick={() => hasDetail && setOpen(!open)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors rounded-lg',
          isFinalRound && 'border border-foreground/15 bg-foreground/[0.03]',
          !isFinalRound && 'hover:bg-accent/20',
          hasDetail && 'cursor-pointer',
          !hasDetail && 'cursor-default',
        )}
      >
        {/* Round number badge */}
        <span className={cn(
          'flex items-center justify-center h-5 w-5 rounded text-[9px] font-mono shrink-0',
          isFinalRound
            ? 'bg-foreground/10 text-foreground/70'
            : 'bg-foreground/5 text-muted-foreground/60',
        )}>
          {roundNumber}
        </span>

        {/* Live spinner or step icon */}
        {isLive && isLast ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
        ) : (
          <StepIcon type={type} />
        )}

        <span className={cn(
          'text-xs flex-1 min-w-0 truncate',
          isFinalRound ? 'text-foreground font-medium' : 'text-foreground',
        )}>
          {step.content}
        </span>

        {/* Elapsed / duration */}
        {isLive && isLast ? (
          <ElapsedTime startTime={liveStartRef.current} />
        ) : step.duration_ms > 0 ? (
          <span className="text-[9px] text-muted-foreground/40 font-mono shrink-0">
            {formatDuration(step.duration_ms)}
          </span>
        ) : null}

        {hasDetail && (
          open
            ? <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" />
            : <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        )}
      </button>

      {open && hasDetail && (
        <div className="px-3 pb-2 pl-12">
          <DetailContent type={type} content={detail} />
        </div>
      )}
    </div>
  );
}

// ── Code Generation Block ──

function CodeGenerationBlock({
  step,
  isLast,
  isLive,
  index,
}: {
  step: ThinkingStep;
  isLast: boolean;
  isLive: boolean;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const detail = step.metadata?.content as string | undefined;
  const hasDetail = !!detail && detail.length > 0;
  const language = hasDetail ? detectLanguage(detail) : 'Код';
  const liveStartRef = useRef(Date.now());

  useEffect(() => {
    liveStartRef.current = Date.now();
  }, [step.step_number]);

  return (
    <div
      className="animate-fade-in border-l-2 border-l-foreground/15"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <button
        onClick={() => hasDetail && setOpen(!open)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
          hasDetail && 'hover:bg-accent/20 cursor-pointer',
          !hasDetail && 'cursor-default',
        )}
      >
        {isLive && isLast ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
        ) : (
          <Code2 className="h-3 w-3 text-muted-foreground shrink-0" />
        )}

        <span className="text-xs text-foreground flex-1 min-w-0 truncate">
          Сгенерирован код
        </span>

        {/* Language badge */}
        <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-[9px] text-muted-foreground/60 font-mono shrink-0">
          {language}
        </span>

        {/* Elapsed / duration */}
        {isLive && isLast ? (
          <ElapsedTime startTime={liveStartRef.current} />
        ) : step.duration_ms > 0 ? (
          <span className="text-[9px] text-muted-foreground/40 font-mono shrink-0">
            {formatDuration(step.duration_ms)}
          </span>
        ) : null}

        {hasDetail && (
          open
            ? <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" />
            : <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        )}
      </button>

      {open && hasDetail && (
        <div className="px-3 pb-2 pl-8">
          <pre className="overflow-x-auto rounded-lg bg-muted/30 border border-border p-3 text-[12px] font-mono leading-relaxed whitespace-pre-wrap">
            <code>{detail}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Single collapsible reasoning block (enhanced) ──

function ReasoningBlock({
  step,
  isLast,
  isLive,
  index,
}: {
  step: ThinkingStep;
  isLast: boolean;
  isLive: boolean;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const type = step.metadata?.type as string | undefined;
  const detail = step.metadata?.content as string | undefined;
  const hasDetail = !!detail && detail.length > 0;
  const liveStartRef = useRef(Date.now());

  // Reset timer when step changes
  useEffect(() => {
    liveStartRef.current = Date.now();
  }, [step.step_number]);

  return (
    <div
      className={cn('border-l-2 animate-fade-in', getAccent(type))}
      style={{ animationDelay: `${index * 60}ms` }}
    >
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
          {isLive && isLast && <ThinkingDots />}
        </span>

        {/* Elapsed time for live step or duration for completed */}
        {isLive && isLast ? (
          <ElapsedTime startTime={liveStartRef.current} />
        ) : step.duration_ms > 0 ? (
          <span className="text-[9px] text-muted-foreground/40 font-mono shrink-0">
            {formatDuration(step.duration_ms)}
          </span>
        ) : null}

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
  // Code generation — show as syntax-highlighted block
  if (type === 'code_generation') {
    return (
      <pre className="overflow-x-auto rounded-lg bg-muted/30 border border-border p-3 text-[12px] font-mono leading-relaxed whitespace-pre-wrap">
        <code>{content}</code>
      </pre>
    );
  }

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

// ── Persona Council View ──

function PersonaCouncilView({ steps, isLive }: { steps: ThinkingStep[]; isLive: boolean }) {
  // Separate expert opinions from synthesis
  const expertSteps = steps.filter(s => {
    const t = s.metadata?.type as string | undefined;
    return t !== 'synthesis' && t !== 'vote';
  });
  const synthesisSteps = steps.filter(s => {
    const t = s.metadata?.type as string | undefined;
    return t === 'synthesis' || t === 'vote';
  });

  return (
    <div className="space-y-2 p-2">
      {/* Expert cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {expertSteps.map((step, i) => (
          <PersonaCard
            key={i}
            step={step}
            isLast={i === steps.length - 1 && synthesisSteps.length === 0}
            isLive={isLive}
            index={i}
          />
        ))}
      </div>

      {/* Synthesis / verdict */}
      {synthesisSteps.map((step, i) => (
        <PersonaCard
          key={`synth-${i}`}
          step={step}
          isLast={i === synthesisSteps.length - 1}
          isLive={isLive}
          index={expertSteps.length + i}
        />
      ))}

      {/* Live empty state */}
      {isLive && steps.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-2">
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Собираю совет экспертов...</span>
        </div>
      )}
    </div>
  );
}

// ── Budget Forcing View ──

function BudgetForcingView({ steps, isLive }: { steps: ThinkingStep[]; isLive: boolean }) {
  // Determine rounds: group steps by round metadata or sequentially
  const totalRounds = steps.length;
  const currentRound = isLive ? totalRounds : totalRounds;

  return (
    <div className="space-y-0.5">
      {/* Depth meter */}
      {totalRounds > 0 && (
        <DepthMeter
          currentRound={currentRound}
          totalRounds={Math.max(totalRounds, isLive ? totalRounds + 1 : totalRounds)}
        />
      )}

      {/* Round cards */}
      <div className="divide-y divide-border/20">
        {steps.map((step, i) => (
          <BudgetRoundCard
            key={i}
            step={step}
            roundNumber={i + 1}
            totalRounds={totalRounds}
            isLast={i === steps.length - 1}
            isLive={isLive}
            index={i}
          />
        ))}
      </div>

      {/* Live empty state */}
      {isLive && steps.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-2">
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Начинаю глубокий анализ...</span>
        </div>
      )}
    </div>
  );
}

// ── Generic step renderer that picks specialized view ──

function StepRenderer({
  step,
  isLast,
  isLive,
  index,
}: {
  step: ThinkingStep;
  isLast: boolean;
  isLive: boolean;
  index: number;
}) {
  const type = step.metadata?.type as string | undefined;

  // Code generation gets a dedicated block
  if (type === 'code_generation') {
    return (
      <CodeGenerationBlock
        step={step}
        isLast={isLast}
        isLive={isLive}
        index={index}
      />
    );
  }

  // Default reasoning block
  return (
    <ReasoningBlock
      step={step}
      isLast={isLast}
      isLive={isLive}
      index={index}
    />
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

  // Total elapsed time
  const totalDuration = steps.reduce((sum, s) => sum + (s.duration_ms || 0), 0);

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

        {/* Total duration */}
        {!isLive && totalDuration > 0 && (
          <span className="flex items-center gap-1 text-[9px] text-muted-foreground/40 font-mono">
            <Clock className="h-2.5 w-2.5" />
            {formatDuration(totalDuration)}
          </span>
        )}

        {isLive && (
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
          </span>
        )}
      </button>

      {/* Steps list — specialized views per strategy */}
      {!collapsed && strategy === 'tree_of_thoughts' && (
        <div className="rounded-b-lg border border-t-0 border-border bg-card/30 p-3">
          <MiniTreeView steps={steps} />
        </div>
      )}

      {!collapsed && strategy === 'persona_council' && (
        <div className="rounded-b-lg border border-t-0 border-border bg-card/30">
          <PersonaCouncilView steps={steps} isLive={!!isLive} />
        </div>
      )}

      {!collapsed && strategy === 'budget_forcing' && (
        <div className="rounded-b-lg border border-t-0 border-border bg-card/30">
          <BudgetForcingView steps={steps} isLive={!!isLive} />
        </div>
      )}

      {!collapsed && strategy !== 'tree_of_thoughts' && strategy !== 'persona_council' && strategy !== 'budget_forcing' && (
        <div className="rounded-b-lg border border-t-0 border-border bg-card/30 divide-y divide-border/30">
          {steps.map((step, i) => (
            <StepRenderer
              key={i}
              step={step}
              isLast={i === steps.length - 1}
              isLive={!!isLive}
              index={i}
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
