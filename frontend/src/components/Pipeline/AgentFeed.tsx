import { useState, useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  Building2, Code2, FlaskConical, Cpu,
  Search, FileText, FilePlus, GitCommit, GitPullRequest, Terminal,
  CheckCircle, XCircle, Loader2,
  ChevronDown, ChevronRight, Zap, Settings,
} from 'lucide-react';
import type { AgentType, PipelineEvent, DevLoopContext } from '@/types/pipeline';

// ── Config ──

const AGENT_CONFIG: Record<AgentType, { Icon: typeof Building2; label: string; color: string }> = {
  architect: { Icon: Building2, label: 'Архитектор', color: 'text-cyan-400' },
  developer: { Icon: Code2, label: 'Разработчик', color: 'text-purple-400' },
  tester: { Icon: FlaskConical, label: 'Тестировщик', color: 'text-yellow-400' },
  orchestrator: { Icon: Cpu, label: 'Оркестратор', color: 'text-orange-400' },
};

const TOOL_ICON: Record<string, typeof Search> = {
  search_code: Search,
  get_file_contents: FileText,
  get_file: FileText,
  list_issues: Search,
  search_issues: Search,
  create_pull_request: GitPullRequest,
  list_commits: GitCommit,
  create_or_update_file: FilePlus,
};

const AGENT_VERBS: Record<AgentType, string> = {
  architect: 'анализирует репозиторий',
  developer: 'пишет код',
  tester: 'запускает тесты',
  orchestrator: 'принимает решение',
};

// ── Helpers ──

interface ToolCall {
  call_id: string;
  tool: string;
  input: string;
  output: string | null;
  success: boolean | null;
  pending: boolean;
}

function collectToolCalls(agent: AgentType, events: PipelineEvent[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const e of events) {
    if (e.type === 'tool_call' && e.agent === agent) {
      calls.push({ call_id: e.call_id!, tool: e.tool!, input: e.input || '', output: null, success: null, pending: true });
    }
    if (e.type === 'tool_result' && e.agent === agent) {
      const c = calls.find((x) => x.call_id === e.call_id);
      if (c) { c.output = e.output || ''; c.success = e.success ?? true; c.pending = false; }
    }
  }
  return calls;
}

function collectThinking(agent: AgentType, events: PipelineEvent[]): string {
  let t = '';
  for (const e of events) {
    if (e.type === 'agent_thinking' && e.agent === agent && e.chunk) t += e.chunk;
  }
  return t;
}

function getAgentStatus(agent: AgentType, events: PipelineEvent[], done: boolean): 'pending' | 'running' | 'done' {
  const started = events.some((e) => e.type === 'agent_started' && e.agent === agent);
  if (!started) return 'pending';
  if (done) return 'done';
  const order: AgentType[] = ['architect', 'developer', 'tester', 'orchestrator'];
  const myIdx = order.indexOf(agent);
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'agent_started' && events[i].agent) {
      const activeIdx = order.indexOf(events[i].agent!);
      return activeIdx > myIdx ? 'done' : 'running';
    }
  }
  return 'running';
}

function formatOutput(tool: string, raw: string): string {
  try {
    const data = JSON.parse(raw);
    if (tool === 'list_commits' && Array.isArray(data)) {
      if (!data.length) return 'Коммитов не найдено';
      const s = (data[0].sha || '').slice(0, 7);
      const m = data[0].commit?.message?.split('\n')[0] || '';
      return `${s} ${m}${data.length > 1 ? ` (+${data.length - 1})` : ''}`;
    }
    if (tool === 'search_code') return `Найдено ${data.total_count ?? data.items?.length ?? 0} результатов`;
    if (tool === 'get_file_contents' || tool === 'get_file') {
      const n = data.name || data.path || '';
      const c = (data.content || '').split('\n').slice(0, 3).join('\n');
      return n ? `${n}\n${c}` : c || raw.slice(0, 120);
    }
    if (tool === 'create_or_update_file') return `Файл создан: ${data.content?.path || data.path || ''}`;
    if (tool === 'create_pull_request') return data.html_url ? `PR: ${data.html_url}` : raw.slice(0, 120);
  } catch { /* not JSON */ }
  const lines = raw.split('\n').filter((l) => l.trim());
  return lines.slice(0, 2).join('\n') || raw.slice(0, 120);
}

// ── Feed items ──

interface FeedItem {
  id: string;
  kind: 'agent_start' | 'tool_group' | 'thinking' | 'result' | 'done' | 'error';
  agent?: AgentType;
  toolCalls?: ToolCall[];
  thinking?: string;
  text?: string;
  status: 'running' | 'done' | 'error';
}

function buildFeed(events: PipelineEvent[], pipelineDone: boolean): FeedItem[] {
  const items: FeedItem[] = [];
  const order: AgentType[] = ['architect', 'developer', 'tester', 'orchestrator'];

  for (const agent of order) {
    const status = getAgentStatus(agent, events, pipelineDone);
    if (status === 'pending') continue;

    items.push({ id: `start-${agent}`, kind: 'agent_start', agent, status });

    const calls = collectToolCalls(agent, events);
    if (calls.length > 0) {
      items.push({ id: `tools-${agent}`, kind: 'tool_group', agent, toolCalls: calls, status });
    }

    const thinking = collectThinking(agent, events);
    if (thinking) {
      items.push({ id: `think-${agent}`, kind: 'thinking', agent, thinking, status });
    }
  }

  // Pipeline completion
  if (pipelineDone) {
    const errEvent = events.find((e) => e.type === 'error');
    if (errEvent) {
      items.push({ id: 'err', kind: 'error', text: errEvent.message || String(errEvent.data?.message ?? 'Ошибка'), status: 'error' });
    } else {
      items.push({ id: 'done', kind: 'done', text: 'Пайплайн завершён', status: 'done' });
    }
  }

  return items;
}

// ── Components ──

interface Props {
  events: PipelineEvent[];
  context: DevLoopContext | null;
  pipelineDone: boolean;
  task: string;
  onNewRun?: (task: string, repo: string) => void;
}

export function AgentFeed({ events, context, pipelineDone, task, onNewRun }: Props) {
  const feedRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => buildFeed(events, pipelineDone), [events, pipelineDone]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [items.length, events.length]);

  return (
    <div className="flex h-full flex-col">
      {/* Feed */}
      <div ref={feedRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-6 space-y-3">
          {/* Task header + strategy badge */}
          <div className="flex items-start gap-3 pb-3 border-b border-border/30">
            <Zap className="h-4 w-4 shrink-0 text-primary mt-0.5" strokeWidth={1.5} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Задача</span>
                <StrategyBadge events={events} />
              </div>
              <div className="text-sm font-medium text-foreground">{task}</div>
            </div>
          </div>

          {items.map((item) => (
            <FeedItemView key={item.id} item={item} events={events} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FeedItemView({ item, events }: { item: FeedItem; events: PipelineEvent[] }) {
  switch (item.kind) {
    case 'agent_start':
      return <AgentStartItem agent={item.agent!} status={item.status} />;
    case 'tool_group':
      return <ToolGroupItem agent={item.agent!} calls={item.toolCalls!} status={item.status} />;
    case 'thinking':
      return <ThinkingItem agent={item.agent!} text={item.thinking!} status={item.status} />;
    case 'done':
      return <DoneItem text={item.text!} />;
    case 'error':
      return <ErrorItem text={item.text!} />;
    default:
      return null;
  }
}

// ── Agent Start ──

function AgentStartItem({ agent, status }: { agent: AgentType; status: string }) {
  const cfg = AGENT_CONFIG[agent];
  const Icon = cfg.Icon;

  return (
    <div className="flex items-center gap-2.5 animate-fade-in">
      {status === 'running' ? (
        <Loader2 className={cn('h-3.5 w-3.5 animate-spin', cfg.color)} strokeWidth={1.5} />
      ) : status === 'done' ? (
        <CheckCircle className="h-3.5 w-3.5 text-green-400" strokeWidth={1.5} />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-red-400" strokeWidth={1.5} />
      )}
      <Icon className={cn('h-3.5 w-3.5', cfg.color)} strokeWidth={1.5} />
      <span className="text-sm font-medium text-foreground">{cfg.label}</span>
      <span className="text-xs text-muted-foreground">{AGENT_VERBS[agent]}</span>
    </div>
  );
}

// ── Tool Group ──

function ToolGroupItem({ agent, calls, status }: { agent: AgentType; calls: ToolCall[]; status: string }) {
  const [expanded, setExpanded] = useState(true);
  const cfg = AGENT_CONFIG[agent];
  const pendingCount = calls.filter((c) => c.pending).length;

  return (
    <div className="ml-6 animate-fade-in">
      {/* Collapse header */}
      {calls.length > 1 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
          ) : (
            <ChevronRight className="h-3 w-3" strokeWidth={1.5} />
          )}
          <span>
            {expanded ? 'Выполнение задач' : `${calls.length} вызовов`}
            {pendingCount > 0 && ` (${pendingCount} в процессе)`}
          </span>
        </button>
      )}

      {/* Tool calls */}
      {(expanded || calls.length === 1) && (
        <div className="space-y-1.5">
          {calls.map((call) => (
            <ToolCallItem key={call.call_id} call={call} agentColor={cfg.color} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCallItem({ call, agentColor }: { call: ToolCall; agentColor: string }) {
  const [showRaw, setShowRaw] = useState(false);
  const ToolIcon = TOOL_ICON[call.tool] || Terminal;

  return (
    <div className="animate-fade-in">
      {/* Tool badge line */}
      <div className="flex items-center gap-2">
        {call.pending ? (
          <Loader2 className={cn('h-3 w-3 animate-spin', agentColor)} strokeWidth={1.5} />
        ) : call.success ? (
          <CheckCircle className="h-3 w-3 text-green-400/70" strokeWidth={1.5} />
        ) : (
          <XCircle className="h-3 w-3 text-red-400/70" strokeWidth={1.5} />
        )}

        <div className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
          'border-border/50 bg-card/50',
        )}>
          <ToolIcon className={cn('h-3 w-3', agentColor)} strokeWidth={1.5} />
          <span className={cn('text-[11px] font-mono font-medium', agentColor)}>
            {call.tool}
          </span>
          {call.input && (
            <span className="text-[11px] text-muted-foreground truncate max-w-[180px]">
              ({call.input})
            </span>
          )}
        </div>
      </div>

      {/* Output */}
      {!call.pending && call.output && (
        <div
          className="ml-5 mt-1 cursor-pointer"
          onClick={() => setShowRaw(!showRaw)}
        >
          <div className="text-[11px] text-muted-foreground/70 font-mono whitespace-pre-wrap leading-relaxed">
            {formatOutput(call.tool, call.output)}
          </div>
          {showRaw && (
            <div className="mt-1 rounded border border-border/30 bg-[#0d1117] p-2 text-[10px] font-mono text-gray-500 max-h-28 overflow-y-auto whitespace-pre-wrap">
              {call.output}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Thinking Stream ──

function ThinkingItem({ agent, text, status }: { agent: AgentType; text: string; status: string }) {
  const [expanded, setExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cfg = AGENT_CONFIG[agent];
  const isActive = status === 'running';

  useEffect(() => {
    if (scrollRef.current && isActive) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text, isActive]);

  // Truncate for display
  const displayText = text.length > 600 && !expanded ? '...' + text.slice(-400) : text;

  return (
    <div className="ml-6 animate-fade-in">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        {isActive && <Loader2 className={cn('h-2.5 w-2.5 animate-spin', cfg.color)} strokeWidth={1.5} />}
        {expanded ? (
          <ChevronDown className="h-2.5 w-2.5" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="h-2.5 w-2.5" strokeWidth={1.5} />
        )}
        <span>Рассуждения</span>
      </button>
      {expanded && (
        <div
          ref={scrollRef}
          className="mt-1 max-h-32 overflow-y-auto text-[11px] text-muted-foreground/40 font-mono italic leading-relaxed whitespace-pre-wrap"
        >
          {displayText}
          {isActive && (
            <span className="inline-block w-1 h-3 ml-0.5 animate-pulse bg-muted-foreground/30" />
          )}
        </div>
      )}
    </div>
  );
}

// ── Done / Error ──

function DoneItem({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2.5 pt-2 border-t border-border/30 animate-fade-in">
      <CheckCircle className="h-4 w-4 text-green-400" strokeWidth={1.5} />
      <span className="text-sm font-medium text-green-400">{text}</span>
    </div>
  );
}

function ErrorItem({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2.5 pt-2 border-t border-border/30 animate-fade-in">
      <XCircle className="h-4 w-4 text-red-400" strokeWidth={1.5} />
      <span className="text-sm font-medium text-red-400">{text}</span>
    </div>
  );
}

// ── Strategy Badge ──

const STRATEGY_CONFIG: Record<string, { Icon: typeof Zap; label: string; color: string; bg: string; border: string }> = {
  simple: { Icon: Zap, label: 'Простая задача', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20' },
  medium: { Icon: Settings, label: 'Средняя задача', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  complex: { Icon: FlaskConical, label: 'Сложная задача', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
};

function StrategyBadge({ events }: { events: PipelineEvent[] }) {
  const strategyEvent = events.find((e) => e.type === 'strategy_selected');
  if (!strategyEvent) return null;

  const complexity = strategyEvent.complexity || 'medium';
  const cfg = STRATEGY_CONFIG[complexity] || STRATEGY_CONFIG.medium;
  const Icon = cfg.Icon;

  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
      cfg.bg, cfg.border, cfg.color,
    )}>
      <Icon className="h-2.5 w-2.5" strokeWidth={1.5} />
      {cfg.label}
    </span>
  );
}
