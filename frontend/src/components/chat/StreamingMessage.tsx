import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ThinkingStep, StrategySelectedEvent } from '@/types';
import { ThinkingPanel } from '@/components/reasoning/ThinkingPanel';
import { useChatStore } from '@/stores/chatStore';
import { Bot } from 'lucide-react';

const STRATEGY_LABELS_RU: Record<string, string> = {
  cot: 'Цепочка мыслей',
  budget_forcing: 'Углублённый анализ',
  best_of_n: 'Лучший из N',
  tree_of_thoughts: 'Дерево мыслей',
  none: 'Прямой ответ',
  auto: 'Авто',
};

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
