import { cn } from '@/lib/utils';
import { AgentCard } from './AgentCard';
import { SandboxOutput } from './SandboxOutput';
import type { AgentType, DevLoopContext, PipelineEvent } from '@/types/pipeline';

interface Props {
  context: DevLoopContext | null;
  events: PipelineEvent[];
}

const AGENT_ORDER: AgentType[] = ['architect', 'developer', 'tester', 'orchestrator'];

function getAgentStatus(
  agent: AgentType,
  iteration: number,
  events: PipelineEvent[],
  isCurrentIteration: boolean,
): 'pending' | 'running' | 'done' {
  const iterEvents = events.filter((e) => e.iteration === iteration);

  const started = iterEvents.some((e) => e.type === 'agent_started' && e.agent === agent);
  if (!started) return 'pending';

  // Agent is done if the next agent in sequence has started, or iteration is complete
  const idx = AGENT_ORDER.indexOf(agent);
  const nextAgent = AGENT_ORDER[idx + 1];
  const iterComplete = iterEvents.some((e) => e.type === 'iteration_complete');

  if (iterComplete) return 'done';
  if (nextAgent && iterEvents.some((e) => e.type === 'agent_started' && e.agent === nextAgent)) {
    return 'done';
  }

  return isCurrentIteration ? 'running' : 'done';
}

export function IterationTimeline({ context, events }: Props) {
  if (!context) return null;

  const totalIterations = Math.max(context.iteration, context.history.length);
  const iterations = Array.from({ length: totalIterations }, (_, i) => i + 1);

  return (
    <div className="space-y-4">
      {iterations.map((num) => {
        const snapshot = context.history.find((h) => h.iteration === num) ?? null;
        const isCurrentIteration = num === context.iteration;
        const iterComplete = events.some(
          (e) => e.type === 'iteration_complete' && e.iteration === num,
        );

        return (
          <div key={num} className="relative">
            {/* Vertical connector */}
            {num < totalIterations && (
              <div className="absolute left-4 top-full h-4 w-px bg-border" />
            )}

            <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
              {/* Iteration header */}
              <div className="flex items-center gap-2.5 border-b border-border px-3 py-2">
                <div
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                    iterComplete
                      ? 'bg-green-500/20 text-green-400'
                      : isCurrentIteration
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {num}
                </div>
                <span className="text-sm font-medium">Итерация {num}</span>
                {iterComplete && (
                  <span className="ml-auto rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-green-400 border border-green-500/20">
                    Готово
                  </span>
                )}
                {isCurrentIteration && !iterComplete && (
                  <span className="ml-auto rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-yellow-400 border border-yellow-500/20">
                    Выполняется
                  </span>
                )}
              </div>

              {/* Agent steps */}
              <div className="p-2 space-y-1.5">
                {AGENT_ORDER.map((agent) => (
                  <AgentCard
                    key={agent}
                    agent={agent}
                    status={getAgentStatus(agent, num, events, isCurrentIteration)}
                    context={isCurrentIteration ? context : null}
                    snapshot={snapshot}
                  />
                ))}
              </div>

              {/* Sandbox output for this iteration */}
              {(snapshot?.test_results || (isCurrentIteration && context.test_results)) && (
                <div className="px-2 pb-2">
                  <SandboxOutput
                    output={snapshot?.test_results ?? context.test_results}
                    isRunning={
                      isCurrentIteration &&
                      !iterComplete &&
                      events.some(
                        (e) =>
                          e.type === 'agent_started' &&
                          e.agent === 'tester' &&
                          e.iteration === num,
                      )
                    }
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
