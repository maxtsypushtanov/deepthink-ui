import { cn } from '@/lib/utils';
import { Brain } from 'lucide-react';
import type { StrategySelectedEvent } from '@/types';

interface Props {
  persona: StrategySelectedEvent;
}

export function PersonaCard({ persona }: Props) {
  const preview =
    persona.persona_preview.length > 80
      ? persona.persona_preview.slice(0, 80) + '...'
      : persona.persona_preview;

  return (
    <div className="animate-fade-in mb-3 rounded-lg border border-border bg-card/50 px-4 py-3">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{persona.label}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {persona.domain.replace(/_/g, ' ')}
        </span>
        <span className="text-[10px] text-muted-foreground">&bull;</span>
        <span className="text-[10px] text-muted-foreground">
          {persona.strategy.replace(/_/g, ' ')}
        </span>
      </div>
      <p className="mt-1.5 text-xs italic text-muted-foreground">
        &ldquo;{preview}&rdquo;
      </p>
    </div>
  );
}
