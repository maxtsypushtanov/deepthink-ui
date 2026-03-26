import { useState } from 'react';
import type { ThinkingStep } from '@/types';
import { STRATEGY_LABELS_RU } from '@/lib/constants';
import { getStrategy } from '@/lib/strategies';
import { cn } from '@/lib/utils';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface Props {
  steps: ThinkingStep[];
  strategy: string;
  isLive?: boolean;
}

/**
 * TRIZ Principle 2 (Extraction) + Principle 17 (Another Dimension):
 * Instead of inline thinking steps that overwhelm the content area,
 * extract reasoning into a horizontal timeline that can be scrubbed
 * like a video. Steps shown as dots, hover for preview, click to expand.
 */
export function ReasoningTimeline({ steps, strategy, isLive }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [activeStep, setActiveStep] = useState<number | null>(null);

  if (steps.length === 0) return null;

  const stratOpt = getStrategy(strategy);
  const StratIcon = stratOpt.icon;

  return (
    <div className="mb-3 rounded-lg border border-border bg-card overflow-hidden">
      {/* Compact timeline bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-accent/30 transition-colors"
      >
        <StratIcon className={cn('h-3.5 w-3.5 shrink-0', stratOpt.color)} />

        {/* Step dots as timeline */}
        <div className="flex-1 flex items-center gap-1">
          {steps.map((step, i) => (
            <div
              key={i}
              className="group relative flex items-center"
            >
              {/* Connector line */}
              {i > 0 && (
                <div className={cn(
                  'h-px w-2 -ml-1 mr-0',
                  i <= (activeStep ?? steps.length) ? 'bg-foreground/30' : 'bg-muted-foreground/15',
                )} />
              )}
              {/* Dot */}
              <div
                onMouseEnter={() => setActiveStep(i)}
                onMouseLeave={() => setActiveStep(null)}
                className={cn(
                  'h-2 w-2 rounded-full transition-all duration-200 cursor-pointer',
                  i === activeStep
                    ? 'h-3 w-3 bg-foreground ring-2 ring-foreground/20'
                    : isLive && i === steps.length - 1
                      ? 'bg-foreground animate-pulse'
                      : 'bg-muted-foreground/40 hover:bg-muted-foreground',
                )}
              />

              {/* Hover tooltip */}
              {i === activeStep && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 w-56 rounded-lg border border-border bg-card p-2.5 shadow-xl pointer-events-none animate-fade-in">
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">
                    {STRATEGY_LABELS_RU[step.strategy] || step.strategy}
                    {step.duration_ms > 0 && (
                      <span className="ml-1 text-muted-foreground/50">
                        {(step.duration_ms / 1000).toFixed(1)}s
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-foreground/80 line-clamp-4 leading-relaxed">
                    {step.content.slice(0, 200)}
                  </p>
                </div>
              )}
            </div>
          ))}

          {isLive && (
            <div className="ml-1 flex gap-0.5">
              <div className="thinking-dot h-1 w-1 rounded-full bg-muted-foreground" />
              <div className="thinking-dot h-1 w-1 rounded-full bg-muted-foreground" />
              <div className="thinking-dot h-1 w-1 rounded-full bg-muted-foreground" />
            </div>
          )}
        </div>

        <span className="text-[10px] text-muted-foreground/50 tabular-nums shrink-0">
          {steps.length} {steps.length === 1 ? 'шаг' : steps.length < 5 ? 'шага' : 'шагов'}
        </span>

        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/40" />
        ) : (
          <ChevronUp className="h-3 w-3 text-muted-foreground/40" />
        )}
      </button>

      {/* Expanded: full step list */}
      {expanded && (
        <div className="border-t border-border max-h-64 overflow-y-auto">
          {steps.map((step, i) => (
            <div
              key={i}
              className={cn(
                'flex gap-3 px-3 py-2.5 text-xs transition-colors',
                i % 2 === 0 ? 'bg-transparent' : 'bg-accent/20',
              )}
            >
              {/* Step number */}
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-muted-foreground">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {STRATEGY_LABELS_RU[step.strategy] || step.strategy}
                  </span>
                  {step.duration_ms > 0 && (
                    <span className="text-[10px] text-muted-foreground/40">
                      {(step.duration_ms / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                <p className="text-foreground/70 whitespace-pre-wrap leading-relaxed">
                  {step.content}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
