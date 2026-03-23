import { useState, useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Loader2, Check, X, Search, GitBranch, FileCode, Terminal, ExternalLink } from 'lucide-react';
import type { AgentType, PipelineEvent, DevLoopContext } from '@/types/pipeline';

// ── Agent config ──

const AGENTS: { id: AgentType; icon: string; label: string; neon: string; bg: string; border: string }[] = [
  { id: 'architect', icon: '\u{1F3D7}', label: 'Архитектор', neon: '#06b6d4', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30' },
  { id: 'developer', icon: '\u{1F4BB}', label: 'Разработчик', neon: '#a855f7', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
  { id: 'tester', icon: '\u{1F9EA}', label: 'Тестировщик', neon: '#eab308', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  { id: 'orchestrator', icon: '\u{1F3AF}', label: 'Оркестратор', neon: '#f97316', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
];

const TOOL_ICONS: Record<string, string> = {
  search_code: '\u{1F50D}',
  get_file_contents: '\u{1F4C4}',
  get_file: '\u{1F4C4}',
  list_issues: '\u{1F41B}',
  search_issues: '\u{1F50E}',
  create_pull_request: '\u{1F517}',
  list_commits: '\u{1F4DD}',
};

const STEPS = [
  { label: 'LLM Рассуждение', icon: '\u{1F9E0}' },
  { label: 'MCP GitHub', icon: '\u{1F517}' },
  { label: 'Реальный код', icon: '\u{1F4BB}' },
  { label: 'Готовый ответ', icon: '\u{2705}' },
];

// ── Helpers ──

function getActiveAgent(events: PipelineEvent[]): AgentType | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'agent_started' && events[i].agent) {
      return events[i].agent!;
    }
  }
  return null;
}

function getAgentStatus(agent: AgentType, events: PipelineEvent[], pipelineDone: boolean): 'pending' | 'running' | 'done' {
  const agentEvents = events.filter((e) => e.agent === agent);
  if (agentEvents.length === 0) return 'pending';
  const active = getActiveAgent(events);
  if (active === agent && !pipelineDone) return 'running';
  // If a later agent has started, this one is done
  const order: AgentType[] = ['architect', 'developer', 'tester', 'orchestrator'];
  const myIdx = order.indexOf(agent);
  const activeIdx = active ? order.indexOf(active) : -1;
  if (activeIdx > myIdx) return 'done';
  if (pipelineDone) return 'done';
  return 'running';
}

function getToolCalls(agent: AgentType, events: PipelineEvent[]) {
  const calls: { call_id: string; tool: string; input: string; output: string | null; success: boolean | null; pending: boolean }[] = [];
  for (const e of events) {
    if (e.type === 'tool_call' && e.agent === agent) {
      calls.push({
        call_id: e.call_id!,
        tool: e.tool!,
        input: e.input || '',
        output: null,
        success: null,
        pending: true,
      });
    }
    if (e.type === 'tool_result' && e.agent === agent) {
      const existing = calls.find((c) => c.call_id === e.call_id);
      if (existing) {
        existing.output = e.output || '';
        existing.success = e.success ?? true;
        existing.pending = false;
      }
    }
  }
  return calls;
}

function getCurrentStep(agent: AgentType, events: PipelineEvent[], pipelineDone: boolean): number {
  const status = getAgentStatus(agent, events, pipelineDone);
  if (status === 'pending') return -1;
  if (status === 'done') return 3;
  const toolCalls = getToolCalls(agent, events);
  if (toolCalls.some((t) => t.pending)) return 1;
  if (toolCalls.length > 0 && toolCalls.every((t) => !t.pending)) return 2;
  return 0;
}

// ── Components ──

interface Props {
  events: PipelineEvent[];
  context: DevLoopContext | null;
  pipelineDone: boolean;
  task: string;
}

export function GroundedTree({ events, context, pipelineDone, task }: Props) {
  const activeAgent = getActiveAgent(events);
  const treeRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new events
  useEffect(() => {
    if (treeRef.current) {
      treeRef.current.scrollTop = treeRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tree area */}
      <div ref={treeRef} className="flex-1 overflow-y-auto px-4 py-4">
        {/* Root node */}
        <RootNode task={task} active={!pipelineDone} />

        {/* Neon connector from root */}
        <div className="flex justify-center">
          <div className={cn(
            'h-6 w-px',
            pipelineDone ? 'bg-green-500/40' : 'bg-white/20',
          )} />
        </div>

        {/* Agent nodes */}
        <div className="space-y-3">
          {AGENTS.map((agent) => {
            const status = getAgentStatus(agent.id, events, pipelineDone);
            const toolCalls = getToolCalls(agent.id, events);

            return (
              <AgentNode
                key={agent.id}
                agent={agent}
                status={status}
                isActive={activeAgent === agent.id && !pipelineDone}
                toolCalls={toolCalls}
              />
            );
          })}
        </div>
      </div>

      {/* Bottom status bar */}
      <StepBar activeAgent={activeAgent} events={events} pipelineDone={pipelineDone} />
    </div>
  );
}

// ── Root Node ──

function RootNode({ task, active }: { task: string; active: boolean }) {
  return (
    <div className="flex justify-center mb-2">
      <div className={cn(
        'relative rounded-xl border-2 px-5 py-3 text-center max-w-md transition-all',
        active
          ? 'border-white/30 bg-white/5 shadow-[0_0_20px_rgba(255,255,255,0.1)]'
          : 'border-green-500/30 bg-green-500/5',
      )}>
        {active && (
          <div className="absolute inset-0 rounded-xl animate-pulse bg-white/5" />
        )}
        <div className="relative text-xs text-muted-foreground mb-1">Задача</div>
        <div className="relative text-sm font-medium text-foreground truncate">
          {task}
        </div>
      </div>
    </div>
  );
}

// ── Agent Node ──

function AgentNode({
  agent,
  status,
  isActive,
  toolCalls,
}: {
  agent: typeof AGENTS[number];
  status: 'pending' | 'running' | 'done';
  isActive: boolean;
  toolCalls: ReturnType<typeof getToolCalls>;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={cn(
      'animate-fade-in rounded-lg border transition-all',
      status === 'pending' && 'opacity-40 border-border/30 bg-card/20',
      status === 'running' && `${agent.border} ${agent.bg}`,
      status === 'done' && 'border-border/50 bg-card/30 opacity-80',
    )}
    style={isActive ? { boxShadow: `0 0 16px ${agent.neon}30, 0 0 4px ${agent.neon}20` } : undefined}
    >
      {/* Agent header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left"
      >
        {/* Status indicator */}
        {status === 'running' && (
          <div className="h-2.5 w-2.5 rounded-full animate-pulse" style={{ backgroundColor: agent.neon }} />
        )}
        {status === 'done' && <Check className="h-3.5 w-3.5 text-green-400" />}
        {status === 'pending' && <div className="h-2.5 w-2.5 rounded-full bg-gray-600" />}

        <span className="text-base">{agent.icon}</span>
        <span className="text-sm font-semibold" style={{ color: status !== 'pending' ? agent.neon : undefined }}>
          {agent.label}
        </span>

        {toolCalls.length > 0 && (
          <span className="ml-1 text-[10px] text-muted-foreground">
            {toolCalls.length} вызов{toolCalls.length > 1 ? 'ов' : ''}
          </span>
        )}

        {status === 'running' && (
          <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </button>

      {/* Tool calls tree */}
      {expanded && toolCalls.length > 0 && (
        <div className="border-t border-border/30 px-2 py-2 space-y-1.5">
          {toolCalls.map((tc, i) => (
            <ToolCallNode
              key={tc.call_id}
              call={tc}
              agentNeon={agent.neon}
              isLast={i === toolCalls.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tool Call Node ──

function ToolCallNode({
  call,
  agentNeon,
  isLast,
}: {
  call: ReturnType<typeof getToolCalls>[number];
  agentNeon: string;
  isLast: boolean;
}) {
  const [showOutput, setShowOutput] = useState(false);
  const toolIcon = TOOL_ICONS[call.tool] || '\u{1F527}';

  return (
    <div className="animate-fade-in">
      <div className="flex items-start gap-2">
        {/* Connector line */}
        <div className="flex flex-col items-center pt-1 shrink-0" style={{ width: 16 }}>
          <div className="h-px w-3" style={{ backgroundColor: `${agentNeon}40` }} />
          {!isLast && <div className="w-px flex-1 bg-border/30" />}
        </div>

        {/* Card */}
        <div
          className={cn(
            'flex-1 rounded-md border px-2.5 py-1.5 text-xs transition-all cursor-pointer',
            call.pending
              ? 'border-border/50 bg-card/40'
              : call.success
                ? 'border-border/40 bg-card/30'
                : 'border-red-500/30 bg-red-500/5',
          )}
          onClick={() => call.output && setShowOutput(!showOutput)}
        >
          <div className="flex items-center gap-2">
            {/* Status */}
            {call.pending ? (
              <Loader2 className="h-3 w-3 animate-spin" style={{ color: agentNeon }} />
            ) : call.success ? (
              <Check className="h-3 w-3 text-green-400" />
            ) : (
              <X className="h-3 w-3 text-red-400" />
            )}

            {/* Tool icon + name */}
            <span>{toolIcon}</span>
            <span className="font-mono font-semibold" style={{ color: agentNeon }}>
              {call.tool}
            </span>

            {/* Input preview */}
            {call.input && (
              <span className="text-muted-foreground truncate max-w-[200px]">
                {call.input}
              </span>
            )}
          </div>

          {/* Output preview */}
          {showOutput && call.output && (
            <div className="mt-1.5 rounded border border-border/30 bg-[#0d1117] p-2 font-mono text-[10px] text-gray-400 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {call.output}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Bottom Step Bar ──

function StepBar({
  activeAgent,
  events,
  pipelineDone,
}: {
  activeAgent: AgentType | null;
  events: PipelineEvent[];
  pipelineDone: boolean;
}) {
  const currentStep = activeAgent
    ? getCurrentStep(activeAgent, events, pipelineDone)
    : pipelineDone ? 3 : -1;

  return (
    <div className="shrink-0 border-t border-border bg-card/50 px-4 py-2">
      <div className="flex items-center justify-between max-w-lg mx-auto">
        {STEPS.map((step, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <div className={cn(
                'h-px w-4 mx-1',
                i <= currentStep ? 'bg-primary' : 'bg-border',
              )} />
            )}
            <div className={cn(
              'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all',
              i === currentStep && !pipelineDone
                ? 'bg-primary/20 text-primary ring-1 ring-primary/30'
                : i < currentStep || (pipelineDone && i <= 3)
                  ? 'text-green-400'
                  : 'text-muted-foreground/50',
            )}>
              <span>{step.icon}</span>
              <span className="hidden sm:inline">{step.label}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
