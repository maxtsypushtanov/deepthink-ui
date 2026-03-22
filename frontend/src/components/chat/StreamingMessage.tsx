import type { ThinkingStep, StrategySelectedEvent } from '@/types';
import { ThinkingPanel } from '@/components/reasoning/ThinkingPanel';
import { STRATEGY_LABELS_RU } from '@/lib/constants';
import { useChatStore } from '@/stores/chatStore';
import { Bot } from 'lucide-react';

interface Props {
  content: string;
  isThinking: boolean;
  thinkingSteps: ThinkingStep[];
  strategy: string | null;
  persona?: StrategySelectedEvent | null;
}

export function StreamingMessage({ content, isThinking, thinkingSteps, strategy, persona }: Props) {
  const clarificationQuestion = useChatStore((s) => s.streaming.clarificationQuestion);
  const sendClarification = useChatStore((s) => s.sendClarification);
  const tokensGenerated = useChatStore((s) => s.streaming.tokensGenerated);

  return (
    <div className="animate-fade-in mb-6">
      {/* Avatar */}
      <div className="mb-1.5 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <span className="text-xs font-medium text-muted-foreground">Ассистент</span>
        {strategy && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {STRATEGY_LABELS_RU[strategy] || strategy.replace('_', ' ')}
          </span>
        )}
      </div>

      {/* Thinking indicator */}
      {isThinking && (
        <ThinkingPanel steps={thinkingSteps} strategy={strategy || ''} isLive persona={persona} clarificationQuestion={clarificationQuestion} onClarificationSubmit={sendClarification} />
      )}

      {/* Content */}
      {content ? (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap break-words">
            {content}
          </div>
          <span className="mt-1 inline-flex items-center gap-1.5">
            <span className="inline-block h-4 w-0.5 animate-pulse bg-foreground" />
            {tokensGenerated > 0 && (
              <span className="text-[10px] text-muted-foreground">{tokensGenerated} tok</span>
            )}
          </span>
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
