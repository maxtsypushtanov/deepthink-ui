import { useState } from 'react';
import { cn, formatTimestamp } from '@/lib/utils';
import { ChevronDown, ChevronRight, Plug } from 'lucide-react';
import type { PipelineEvent } from '@/types/pipeline';

interface Props {
  events: PipelineEvent[];
}

export function MCPCallLog({ events }: Props) {
  const [open, setOpen] = useState(false);

  const mcpCalls = events.filter((e) => e.type === 'mcp_call_made');
  if (mcpCalls.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/30"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <Plug className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          MCP Calls ({mcpCalls.length})
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-3 py-2 space-y-1.5">
          {mcpCalls.map((call, i) => {
            const tool = String(call.data?.tool ?? 'unknown');
            const params = String(call.data?.params_summary ?? '');
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="inline-flex rounded bg-purple-500/10 px-1.5 py-0.5 font-mono text-purple-400 border border-purple-500/20">
                  {tool}
                </span>
                {params && (
                  <span className="text-muted-foreground truncate">{params}</span>
                )}
                <span className="ml-auto text-muted-foreground/60">
                  {formatTimestamp(call.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
