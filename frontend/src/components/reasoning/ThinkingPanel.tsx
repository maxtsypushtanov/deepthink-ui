import { useState } from 'react';
import type { ThinkingStep, StrategySelectedEvent } from '@/types';
import { cn, formatDuration } from '@/lib/utils';
import { ChevronDown, ChevronRight, Brain, Clock, GitBranch, TreePine, Sparkles, Target } from 'lucide-react';
import { PersonaCard } from './PersonaCard';

interface Props {
  steps: ThinkingStep[];
  strategy: string;
  isLive?: boolean;
  persona?: StrategySelectedEvent | null;
  clarificationQuestion?: string | null;
  onClarificationSubmit?: (answer: string) => void;
}

const STRATEGY_BADGE: Record<string, { label: string; color: string; icon: React.ComponentType<any> }> = {
  cot: { label: 'Цепочка мыслей', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: Brain },
  budget_forcing: { label: 'Углублённый анализ', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: Sparkles },
  best_of_n: { label: 'Лучший из N', color: 'bg-green-500/10 text-green-400 border-green-500/20', icon: GitBranch },
  tree_of_thoughts: { label: 'Дерево мыслей', color: 'bg-orange-500/10 text-orange-400 border-orange-500/20', icon: TreePine },
  none: { label: 'Прямой ответ', color: 'bg-gray-500/10 text-gray-400 border-gray-500/20', icon: Target },
};

export function ThinkingPanel({ steps, strategy, isLive, persona, clarificationQuestion, onClarificationSubmit }: Props) {
  const [open, setOpen] = useState(isLive || false);
  const [clarificationAnswer, setClarificationAnswer] = useState('');

  const badge = STRATEGY_BADGE[strategy] || STRATEGY_BADGE.cot;
  const BadgeIcon = badge.icon;

  return (
    <div className="mb-3 rounded-lg border border-border bg-card/50 overflow-hidden">
      {/* Header — clickable to collapse */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/30"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}

        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium', badge.color)}>
          <BadgeIcon className="h-3 w-3" />
          {badge.label}
        </span>

        <span className="text-[10px] text-muted-foreground">
          {steps.length} {steps.length === 1 ? 'шаг' : steps.length < 5 ? 'шага' : 'шагов'}
        </span>

        {isLive && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
            думаю...
          </span>
        )}
      </button>

      {/* Steps */}
      {open && (
        <div className="border-t border-border px-3 py-2">
          {persona && <PersonaCard persona={persona} />}
          {steps.map((step, i) => (
            <div
              key={i}
              className={cn(
                'animate-fade-in relative border-l-2 py-2 pl-4',
                getStepColor(step),
              )}
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-foreground">
                  {step.step_number}
                </span>
                <span className="text-xs font-medium text-foreground">
                  {step.strategy.replace('_', ' ')}
                </span>
                {step.duration_ms > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                    <Clock className="h-2.5 w-2.5" />
                    {formatDuration(step.duration_ms)}
                  </span>
                )}
                {step.metadata?.score !== undefined && (
                  <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-mono text-foreground">
                    score: {Number(step.metadata.score).toFixed(2)}
                  </span>
                )}
              </div>
              {step.content && (
                <p className="mt-1 text-xs text-muted-foreground line-clamp-3">
                  {step.content}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {clarificationQuestion && (
        <div className="border-t border-border px-3 py-3">
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
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
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

function getStepColor(step: ThinkingStep): string {
  const s = step.strategy;
  if (s === 'cot') return 'border-blue-400/40';
  if (s === 'budget_forcing') return 'border-purple-400/40';
  if (s === 'best_of_n') return 'border-green-400/40';
  if (s === 'tree_of_thoughts') return 'border-orange-400/40';
  if (step.metadata?.type === 'vote') return 'border-emerald-400/40';
  if (step.metadata?.type === 'synthesis') return 'border-amber-400/40';
  return 'border-muted-foreground/40';
}
