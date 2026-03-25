import { useChatStore } from '@/stores/chatStore';
import { STRATEGY_LABELS_RU } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { ReasoningStrategy } from '@/types';
import { Brain, Sparkles, GitBranch, TreePine, Target, Zap, Users, Bug, HelpCircle, Code, Calculator, Lightbulb, Scale, FlaskConical } from 'lucide-react';

const STRATEGY_OPTIONS: { key: ReasoningStrategy; icon: React.ComponentType<any>; color: string }[] = [
  { key: 'auto', icon: Zap, color: 'text-amber-400 border-amber-500/20 bg-amber-500/10' },
  { key: 'none', icon: Target, color: 'text-gray-400 border-gray-500/20 bg-gray-500/10' },
  { key: 'cot', icon: Brain, color: 'text-blue-400 border-blue-500/20 bg-blue-500/10' },
  { key: 'budget_forcing', icon: Sparkles, color: 'text-purple-400 border-purple-500/20 bg-purple-500/10' },
  { key: 'best_of_n', icon: GitBranch, color: 'text-green-400 border-green-500/20 bg-green-500/10' },
  { key: 'tree_of_thoughts', icon: TreePine, color: 'text-orange-400 border-orange-500/20 bg-orange-500/10' },
  { key: 'persona_council', icon: Users, color: 'text-cyan-400 border-cyan-500/20 bg-cyan-500/10' },
  { key: 'rubber_duck', icon: Bug, color: 'text-yellow-400 border-yellow-500/20 bg-yellow-500/10' },
  { key: 'socratic', icon: HelpCircle, color: 'text-rose-400 border-rose-500/20 bg-rose-500/10' },
];

const EXAMPLE_CARDS: { text: string; icon: React.ComponentType<any>; strategy: ReasoningStrategy }[] = [
  // CoT
  { text: 'Объясни разницу между REST и GraphQL', icon: Code, strategy: 'cot' },
  // Budget Forcing
  { text: 'Докажи, что √2 — иррациональное число', icon: Calculator, strategy: 'budget_forcing' },
  // Best of N
  { text: 'Сравни три подхода к кэшированию в web-приложениях', icon: GitBranch, strategy: 'best_of_n' },
  // Tree of Thoughts
  { text: 'Какие последствия повсеместного внедрения ИИ?', icon: Lightbulb, strategy: 'tree_of_thoughts' },
  // Persona Council
  { text: 'Стоит ли стартапу строить свою LLM или использовать API?', icon: Users, strategy: 'persona_council' },
  // Rubber Duck
  { text: 'Почему быстрая сортировка в среднем O(n log n)?', icon: Bug, strategy: 'rubber_duck' },
  // Socratic
  { text: 'Что такое справедливость и можно ли её измерить?', icon: HelpCircle, strategy: 'socratic' },
  // Budget Forcing
  { text: 'Проанализируй этическую дилемму вагонетки', icon: Scale, strategy: 'budget_forcing' },
  // CoT
  { text: 'Опиши процесс фотосинтеза для школьника', icon: FlaskConical, strategy: 'cot' },
];

export function EmptyState() {
  const strategy = useChatStore((s) => s.settings.strategy);
  const updateSettings = useChatStore((s) => s.updateSettings);

  const handleCardClick = (text: string, cardStrategy: ReasoningStrategy) => {
    updateSettings({ strategy: cardStrategy });
    window.dispatchEvent(new CustomEvent('deepthink:edit-message', { detail: text }));
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8 animate-fade-in" style={{ animationDelay: '0ms', animationFillMode: 'both' }}>
          <h2 className="text-xl font-semibold tracking-tight">Deep Think UI</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Глубокое мышление для любой модели
          </p>
        </div>

        {/* Strategy selector */}
        <div className="mb-8 animate-fade-in" style={{ animationDelay: '100ms', animationFillMode: 'both' }}>
          <p className="mb-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Выберите стратегию
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {STRATEGY_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.key}
                  onClick={() => updateSettings({ strategy: opt.key })}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
                    strategy === opt.key
                      ? cn(opt.color, 'ring-1 ring-offset-1 ring-offset-background')
                      : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {STRATEGY_LABELS_RU[opt.key]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Example cards */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 animate-fade-in" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
          {EXAMPLE_CARDS.map((card, i) => {
            const Icon = card.icon;
            const strategyColor = STRATEGY_OPTIONS.find((o) => o.key === card.strategy);
            return (
              <button
                key={i}
                onClick={() => handleCardClick(card.text, card.strategy)}
                className="group flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-all hover:border-foreground/20 hover:shadow-sm hover:scale-[1.01]"
              >
                <div className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', strategyColor?.color || 'bg-accent text-muted-foreground')}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground group-hover:text-foreground/90 line-clamp-2">
                    {card.text}
                  </p>
                  <span className="mt-1 text-[10px] text-muted-foreground">
                    {STRATEGY_LABELS_RU[card.strategy]}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
