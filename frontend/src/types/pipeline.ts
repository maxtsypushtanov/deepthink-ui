export type PipelineStatus = 'idle' | 'running' | 'done' | 'error';

export type AgentType = 'architect' | 'developer' | 'tester' | 'orchestrator';

export interface CodeChange {
  file: string;
  content: string;
  action: string;
}

export interface Issue {
  description: string;
  severity: string;
  file: string;
}

export interface IterationSnapshot {
  iteration: number;
  spec: string;
  design_decisions: string[];
  code_changes: CodeChange[];
  issues_found: Issue[];
  test_results: string;
}

export interface DevLoopContext {
  task: string;
  repo: string;
  iteration: number;
  status: PipelineStatus;
  spec: string | null;
  design_decisions: string[];
  code_changes: CodeChange[];
  issues_found: Issue[];
  test_results: string | null;
  pull_request_url: string | null;
  decision: string | null;
  decision_reasoning: string | null;
  history: IterationSnapshot[];
}

export interface ToolCallEvent {
  type: 'tool_call';
  agent: AgentType;
  tool: string;
  input: string;
  call_id: string;
  timestamp: string;
}

export interface ToolResultEvent {
  type: 'tool_result';
  agent: AgentType;
  tool: string;
  call_id: string;
  output: string;
  success: boolean;
  timestamp: string;
}

export type PipelineEvent = {
  type:
    | 'agent_started'
    | 'mcp_call_made'
    | 'sandbox_result'
    | 'iteration_complete'
    | 'pipeline_done'
    | 'tool_call'
    | 'tool_result'
    | 'agent_thinking'
    | 'strategy_selected'
    | 'error';
  agent?: AgentType;
  iteration?: number;
  tool?: string;
  input?: string;
  output?: string;
  call_id?: string;
  success?: boolean;
  chunk?: string;
  complexity?: string;
  test_results?: string;
  decision?: string;
  issues_count?: number;
  status?: string;
  message?: string;
  data?: Record<string, unknown>;
  timestamp: string;
};
