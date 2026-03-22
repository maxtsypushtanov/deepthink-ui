import { useState } from 'react';
import type { StrategySelectedEvent } from '@/types';
import { Brain, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  persona: StrategySelectedEvent | null;
}

export function PersonaIndicator({ persona }: Props) {
  const [open, setOpen] = useState(false);

  if (!persona) return null;

  const shortLabel = persona.persona_preview.split(' ').slice(0, 5).join(' ');

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
          'border-purple-500/20 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20',
        )}
      >
        <Brain className="h-3 w-3" />
        {shortLabel}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-border bg-card p-4 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-foreground">{persona.label}</span>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {persona.domain.replace(/_/g, ' ')}
              </span>
              <span className="text-[10px] text-muted-foreground">&bull;</span>
              <span className="text-[10px] text-muted-foreground">
                {persona.strategy.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-xs italic text-muted-foreground">
              &ldquo;{persona.persona_preview}&rdquo;
            </p>
          </div>
        </>
      )}
    </div>
  );
}
