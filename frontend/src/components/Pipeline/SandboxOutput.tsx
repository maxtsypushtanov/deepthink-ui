import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Terminal } from 'lucide-react';

interface Props {
  output: string | null;
  isRunning?: boolean;
}

function colorize(line: string): string {
  if (/PASSED|passed|OK/i.test(line)) return 'text-green-400';
  if (/FAILED|ERRORS?|failed|error/i.test(line)) return 'text-red-400';
  if (/WARNING|warn/i.test(line)) return 'text-yellow-400';
  return 'text-gray-300';
}

export function SandboxOutput({ output, isRunning }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <div className="rounded-lg border border-border bg-[#0d1117] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5">
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Sandbox Output</span>
      </div>

      <div ref={scrollRef} className="max-h-64 overflow-y-auto p-3">
        {isRunning && !output && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
            Running tests...
          </div>
        )}
        {output && (
          <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap">
            {output.split('\n').map((line, i) => (
              <div key={i} className={cn(colorize(line))}>
                {line}
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
