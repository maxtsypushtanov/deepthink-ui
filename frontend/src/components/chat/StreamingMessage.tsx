import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ThinkingStep, StrategySelectedEvent } from '@/types';
import { ThinkingPanel } from '@/components/reasoning/ThinkingPanel';
import { Bot } from 'lucide-react';

interface Props {
  content: string;
  isThinking: boolean;
  thinkingSteps: ThinkingStep[];
  strategy: string | null;
  persona?: StrategySelectedEvent | null;
}

export function StreamingMessage({ content, isThinking, thinkingSteps, strategy, persona }: Props) {
  return (
    <div className="animate-fade-in mb-6">
      {/* Avatar */}
      <div className="mb-1.5 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <span className="text-xs font-medium text-muted-foreground">Assistant</span>
        {strategy && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {strategy.replace('_', ' ')}
          </span>
        )}
      </div>

      {/* Thinking indicator */}
      {isThinking && (
        <ThinkingPanel steps={thinkingSteps} strategy={strategy || ''} isLive persona={persona} />
      )}

      {/* Content */}
      {content ? (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
          <span className="mt-2 inline-block h-4 w-0.5 animate-pulse bg-foreground" />
        </div>
      ) : isThinking ? null : (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-1.5">
            <div className="thinking-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            <div className="thinking-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            <div className="thinking-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          </div>
        </div>
      )}
    </div>
  );
}
