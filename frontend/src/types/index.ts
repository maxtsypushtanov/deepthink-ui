export type ReasoningStrategy =
  | 'none'
  | 'cot'
  | 'budget_forcing'
  | 'best_of_n'
  | 'tree_of_thoughts'
  | 'auto';

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  provider?: string;
  reasoning_strategy?: string;
  reasoning_trace?: string;
  tokens_used?: number;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderSettings {
  id: string;
  provider: string;
  api_key: string;
  api_key_preview?: string;
  base_url: string;
  enabled: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  context: number;
}

export interface ThinkingStep {
  step_number: number;
  strategy: string;
  content: string;
  duration_ms: number;
  metadata: Record<string, unknown>;
}

export interface TreeNode {
  id: string;
  level: number;
  score: number;
  parent: string | null;
  thought?: string;
}

export interface StrategySelectedEvent {
  strategy: string;
  intent: string;
  domain: string;
  label: string;
  persona_preview: string;
}

export type ThemeMode = 'dark' | 'light';

export interface ChatSettings {
  model: string;
  provider: string;
  strategy: ReasoningStrategy;
  temperature: number;
  maxTokens: number;
  budgetRounds: number;
  bestOfN: number;
  treeBreadth: number;
  treeDepth: number;
}
