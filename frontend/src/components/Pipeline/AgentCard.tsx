import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentType, DevLoopContext, IterationSnapshot } from '@/types/pipeline';

interface Props {
  agent: AgentType;
  status: 'pending' | 'running' | 'done';
  context: DevLoopContext | null;
  snapshot: IterationSnapshot | null;
}

const AGENT_META: Record<AgentType, { icon: string; label: string; color: string }> = {
  architect: { icon: '\u{1F3DB}', label: 'Architect', color: 'text-orange-400' },
  developer: { icon: '\u{1F4BB}', label: 'Developer', color: 'text-blue-400' },
  tester: { icon: '\u{1F9EA}', label: 'Tester', color: 'text-green-400' },
  orchestrator: { icon: '\u{1F3AF}', label: 'Orchestrator', color: 'text-purple-400' },
};

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-gray-500',
  running: 'bg-yellow-400 animate-pulse',
  done: 'bg-green-400',
};

export function AgentCard({ agent, status, context, snapshot }: Props) {
  const [expanded, setExpanded] = useState(false);
  const meta = AGENT_META[agent];
  const data = snapshot ?? context;

  return (
    <div className="rounded-md border border-border bg-card/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/20"
      >
        <div className={cn('h-2 w-2 rounded-full', STATUS_DOT[status])} />
        <span className="text-base">{meta.icon}</span>
        <span className={cn('text-sm font-medium', meta.color)}>{meta.label}</span>
        <span className="ml-auto text-muted-foreground">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {expanded && data && (
        <div className="border-t border-border px-3 py-2.5 text-xs space-y-2">
          {agent === 'architect' && <ArchitectDetails spec={data.spec} decisions={data.design_decisions} />}
          {agent === 'developer' && <DeveloperDetails changes={data.code_changes} />}
          {agent === 'tester' && <TesterDetails issues={data.issues_found} />}
          {agent === 'orchestrator' && context && (
            <OrchestratorDetails decision={context.decision} reasoning={context.decision_reasoning} />
          )}
        </div>
      )}
    </div>
  );
}

function ArchitectDetails({ spec, decisions }: { spec: string | null; decisions: string[] }) {
  return (
    <>
      {spec && (
        <div>
          <div className="text-muted-foreground mb-1 font-medium">Spec</div>
          <p className="text-foreground/80 whitespace-pre-wrap">{spec}</p>
        </div>
      )}
      {decisions.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1 font-medium">Design Decisions</div>
          <ul className="list-disc list-inside space-y-0.5 text-foreground/80">
            {decisions.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function DeveloperDetails({ changes }: { changes: { file: string; action: string }[] }) {
  const ACTION_BADGE: Record<string, string> = {
    create: 'bg-green-500/10 text-green-400 border-green-500/20',
    modify: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    delete: 'bg-red-500/10 text-red-400 border-red-500/20',
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {changes.map((c, i) => (
        <span
          key={i}
          className={cn(
            'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono',
            ACTION_BADGE[c.action] ?? ACTION_BADGE.modify,
          )}
        >
          {c.action[0].toUpperCase()} {c.file}
        </span>
      ))}
      {changes.length === 0 && <span className="text-muted-foreground">No changes</span>}
    </div>
  );
}

function TesterDetails({ issues }: { issues: { description: string; severity: string; file: string }[] }) {
  const SEV_BADGE: Record<string, string> = {
    critical: 'bg-red-500/10 text-red-400 border-red-500/20',
    high: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    low: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  };

  if (issues.length === 0) {
    return <span className="text-green-400">All tests passed — no issues found</span>;
  }

  return (
    <div className="space-y-1">
      {issues.map((issue, i) => (
        <div key={i} className="flex items-start gap-2">
          <span
            className={cn(
              'mt-0.5 inline-flex shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase font-semibold',
              SEV_BADGE[issue.severity] ?? SEV_BADGE.medium,
            )}
          >
            {issue.severity}
          </span>
          <span className="text-foreground/80">{issue.description}</span>
        </div>
      ))}
    </div>
  );
}

function OrchestratorDetails({
  decision,
  reasoning,
}: {
  decision: string | null;
  reasoning: string | null;
}) {
  return (
    <>
      {decision && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Decision:</span>
          <span
            className={cn(
              'inline-flex rounded border px-1.5 py-0.5 font-medium',
              decision === 'done'
                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
            )}
          >
            {decision}
          </span>
        </div>
      )}
      {reasoning && <p className="text-foreground/80 whitespace-pre-wrap">{reasoning}</p>}
    </>
  );
}
