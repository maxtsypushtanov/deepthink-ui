export type ReasoningStrategy =
  | 'none'
  | 'cot'
  | 'budget_forcing'
  | 'best_of_n'
  | 'tree_of_thoughts'
  | 'persona_council'
  | 'rubber_duck'
  | 'socratic'
  | 'triz'
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
  folder_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Folder {
  id: string;
  name: string;
  parent_folder_id: string | null;
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
  persona_detail?: string;
}

export type ThemeMode = 'dark' | 'light';

/** Discriminated union for all SSE event types from /api/chat */
export type SSEEvent =
  | { event: 'conversation'; data: { conversation_id: string } }
  | { event: 'strategy_selected'; data: StrategySelectedEvent }
  | { event: 'thinking_start'; data: { strategy: string } }
  | { event: 'thinking_step'; data: ThinkingStep }
  | { event: 'thinking_end'; data: Record<string, unknown> }
  | { event: 'content_delta'; data: { content: string; tokens?: number } }
  | { event: 'done'; data: { message_id?: string; tokens_used?: number; model?: string; images?: string[]; generated_images?: string[]; mermaid_code?: string } }
  | { event: 'error'; data: { error: string } }
  | { event: 'calendar_draft'; data: Record<string, unknown> }
  | { event: 'execution_plan'; data: { strategy: string; strategy_label: string; domain: string; domain_label: string; steps: string[]; estimated_calls: number } }
  | { event: 'clarification_needed'; data: { question: string } }
  | { event: 'tool_call'; data: { tool: string; arguments: Record<string, unknown> } }
  | { event: 'tool_result'; data: { tool: string; result: string } }
  | { event: 'tool_error'; data: { tool: string; error: string } };

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
  imageModel: string;
}
