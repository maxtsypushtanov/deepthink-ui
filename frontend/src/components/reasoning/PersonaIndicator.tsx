import { useState } from 'react';
import type { StrategySelectedEvent } from '@/types';
import { Brain, X, Sparkles, Target, GitBranch, TreePine, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STRATEGY_LABELS_RU } from '@/lib/constants';

const DOMAIN_LABELS_RU: Record<string, string> = {
  software_engineering: 'Разработка',
  mathematics: 'Математика',
  medicine: 'Медицина',
  law: 'Право',
  finance: 'Финансы',
  science: 'Наука',
  creative_writing: 'Тексты',
  business: 'Бизнес',
  philosophy: 'Философия',
  general: 'Общее',
};

const STRATEGY_ICONS: Record<string, React.ComponentType<any>> = {
  none: Target,
  cot: Brain,
  budget_forcing: Sparkles,
  best_of_n: GitBranch,
  tree_of_thoughts: TreePine,
  auto: Zap,
};

interface Props {
  persona: StrategySelectedEvent | null;
}

export function PersonaIndicator({ persona }: Props) {
  const [open, setOpen] = useState(false);

  if (!persona) return null;

  const domainLabel = DOMAIN_LABELS_RU[persona.domain] || persona.domain;
  const strategyLabel = STRATEGY_LABELS_RU[persona.strategy] || persona.strategy;
  const StrategyIcon = STRATEGY_ICONS[persona.strategy] || Brain;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-300',
          'border-border bg-accent/50 text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <StrategyIcon className="h-3 w-3" />
        <span>{domainLabel}</span>
        <span className="text-muted-foreground/50">·</span>
        <span className="text-muted-foreground/70">{strategyLabel}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-border bg-card p-4 shadow-lg animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-foreground">Текущая персона</span>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-foreground">
                  {domainLabel}
                </span>
                <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {strategyLabel}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {persona.persona_preview}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
