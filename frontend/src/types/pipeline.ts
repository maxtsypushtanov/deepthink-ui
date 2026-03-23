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

export interface PipelineEvent {
  type:
    | 'agent_started'
    | 'mcp_call_made'
    | 'sandbox_result'
    | 'iteration_complete'
    | 'pipeline_done'
    | 'error';
  agent?: AgentType;
  iteration?: number;
  data?: Record<string, unknown>;
  timestamp: string;
}
