import {
  Brain,
  Sparkles,
  GitBranch,
  TreePine,
  Target,
  Zap,
  Users,
  Bug,
  HelpCircle,
} from 'lucide-react';
import type { ReasoningStrategy } from '@/types';

export interface StrategyOption {
  key: ReasoningStrategy;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  color: string;
  bgColor: string;
}

// All monochrome — strategies are invisible implementation detail
export const STRATEGIES: StrategyOption[] = [
  { key: 'auto',             icon: Zap,        color: 'text-muted-foreground',     bgColor: '' },
  { key: 'none',             icon: Target,     color: 'text-muted-foreground',     bgColor: '' },
  { key: 'cot',              icon: Brain,      color: 'text-muted-foreground',     bgColor: '' },
  { key: 'budget_forcing',   icon: Sparkles,   color: 'text-muted-foreground',     bgColor: '' },
  { key: 'best_of_n',        icon: GitBranch,  color: 'text-muted-foreground',     bgColor: '' },
  { key: 'tree_of_thoughts', icon: TreePine,   color: 'text-muted-foreground',     bgColor: '' },
  { key: 'persona_council',  icon: Users,      color: 'text-muted-foreground',     bgColor: '' },
  { key: 'rubber_duck',      icon: Bug,        color: 'text-muted-foreground',     bgColor: '' },
  { key: 'socratic',         icon: HelpCircle, color: 'text-muted-foreground',     bgColor: '' },
  { key: 'triz',             icon: Sparkles,   color: 'text-muted-foreground',     bgColor: '' },
];

export const STRATEGY_MAP = new Map(STRATEGIES.map((s) => [s.key, s]));

export function getStrategy(key: string): StrategyOption {
  return STRATEGY_MAP.get(key as ReasoningStrategy) ?? STRATEGIES[0];
}
