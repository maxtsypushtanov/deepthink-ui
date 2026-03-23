import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ReasoningTreeView } from './ReasoningTreeView';
import type { AgentType, DevLoopContext, IterationSnapshot } from '@/types/pipeline';

interface Props {
  agent: AgentType;
  status: 'pending' | 'running' | 'done';
  context: DevLoopContext | null;
  snapshot: IterationSnapshot | null;
}

const AGENT_META: Record<AgentType, { icon: string; label: string; color: string }> = {
  architect: { icon: '\u{1F3D7}', label: 'Архитектор', color: 'text-orange-400' },
  developer: { icon: '\u{1F4BB}', label: 'Разработчик', color: 'text-blue-400' },
  tester: { icon: '\u{1F9EA}', label: 'Тестировщик', color: 'text-green-400' },
  orchestrator: { icon: '\u{1F3AF}', label: 'Оркестратор', color: 'text-purple-400' },
};

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-gray-500',
  running: 'bg-yellow-400 animate-pulse',
  done: 'bg-green-400',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '',
  running: 'работает...',
  done: 'готово',
};

/** Build a single raw text from whatever the agent produced */
function getAgentOutput(agent: AgentType, context: DevLoopContext | null, snapshot: IterationSnapshot | null): string | null {
  const data = snapshot ?? context;
  if (!data) return null;

  switch (agent) {
    case 'architect': {
      const parts: string[] = [];
      if (data.spec) parts.push(data.spec);
      if (data.design_decisions.length > 0) {
        parts.push('\n\nDesign decisions:\n' + data.design_decisions.map((d, i) => `${i + 1}. ${d}`).join('\n'));
      }
      return parts.join('') || null;
    }
    case 'developer': {
      if (data.code_changes.length === 0) return null;
      return data.code_changes
        .map((c) => `[${c.action}] ${c.file}\n\`\`\`\n${c.content}\n\`\`\``)
        .join('\n\n');
    }
    case 'tester': {
      const parts: string[] = [];
      if (data.test_results) parts.push(data.test_results);
      if (data.issues_found.length > 0) {
        parts.push('\n\nIssues:\n' + data.issues_found.map((i) => `- [${i.severity}] ${i.description} (${i.file})`).join('\n'));
      }
      return parts.join('') || null;
    }
    case 'orchestrator': {
      if (!context) return null;
      const parts: string[] = [];
      if (context.decision) parts.push(`Decision: ${context.decision}`);
      if (context.decision_reasoning) parts.push(context.decision_reasoning);
      return parts.join('\n\n') || null;
    }
    default:
      return null;
  }
}

export function AgentCard({ agent, status, context, snapshot }: Props) {
  const [expanded, setExpanded] = useState(status === 'running');
  const meta = AGENT_META[agent];
  const rawOutput = getAgentOutput(agent, context, snapshot);

  return (
    <div className={cn(
      'rounded-md border overflow-hidden transition-colors',
      status === 'running'
        ? 'border-border bg-card/50'
        : 'border-border/60 bg-card/30',
    )}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/20"
      >
        <div className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[status])} />
        <span className="text-base">{meta.icon}</span>
        <span className={cn('text-sm font-medium', meta.color)}>{meta.label}</span>
        {STATUS_LABEL[status] && (
          <span className="text-[10px] text-muted-foreground">{STATUS_LABEL[status]}</span>
        )}
        <span className="ml-auto text-muted-foreground">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {/* Tree of Thoughts visualization */}
      {expanded && (
        <div className="border-t border-border/50">
          <ReasoningTreeView
            agentColor={meta.color}
            agentIcon={meta.icon}
            agentLabel={meta.label}
            status={status}
            rawOutput={rawOutput}
          />
          {/* Agent-specific summary badges */}
          {status === 'done' && <AgentSummary agent={agent} context={context} snapshot={snapshot} />}
        </div>
      )}
    </div>
  );
}

/** Compact badge summary under the tree */
function AgentSummary({ agent, context, snapshot }: { agent: AgentType; context: DevLoopContext | null; snapshot: IterationSnapshot | null }) {
  const data = snapshot ?? context;
  if (!data) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-2 pt-1">
      {agent === 'developer' && data.code_changes.map((c, i) => (
        <span key={i} className={cn(
          'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono',
          c.action === 'create' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
          c.action === 'delete' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
          'bg-blue-500/10 text-blue-400 border-blue-500/20',
        )}>
          {c.action[0].toUpperCase()} {c.file}
        </span>
      ))}

      {agent === 'tester' && data.issues_found.length === 0 && (
        <span className="text-[10px] text-green-400">Тесты пройдены</span>
      )}
      {agent === 'tester' && data.issues_found.map((issue, i) => (
        <span key={i} className={cn(
          'inline-flex rounded border px-1.5 py-0.5 text-[10px] uppercase font-semibold',
          issue.severity === 'critical' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
          issue.severity === 'high' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
          'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
        )}>
          {issue.severity}
        </span>
      ))}

      {agent === 'orchestrator' && context?.decision && (
        <span className={cn(
          'inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold',
          context.decision === 'done'
            ? 'bg-green-500/10 text-green-400 border-green-500/20'
            : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
        )}>
          {context.decision === 'done' ? 'Готово' : 'Следующая итерация'}
        </span>
      )}
    </div>
  );
}
