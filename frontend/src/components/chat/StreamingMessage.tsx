import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ThinkingStep, StrategySelectedEvent } from '@/types';
import { useChatStore } from '@/stores/chatStore';
import { cn } from '@/lib/utils';
import { STRATEGY_LABELS_RU } from '@/lib/constants';

interface Props {
  content: string;
  isThinking: boolean;
  thinkingSteps: ThinkingStep[];
  strategy: string | null;
  persona?: StrategySelectedEvent | null;
}

function SkeletonLoading() {
  return (
    <div className="space-y-2.5 px-4 py-3">
      <div className="h-3.5 w-[60%] rounded skeleton-shimmer" />
      <div className="h-3.5 w-[80%] rounded skeleton-shimmer" />
      <div className="h-3.5 w-[40%] rounded skeleton-shimmer" />
    </div>
  );
}

function ClarificationUI({ question, onSubmit }: { question: string; onSubmit: (answer: string) => void }) {
  const [answer, setAnswer] = useState('');
  const handleSubmit = () => {
    if (answer.trim()) {
      onSubmit(answer.trim());
      setAnswer('');
    }
  };
  return (
    <div className="rounded-xl border border-border bg-card p-4 mb-4">
      <p className="text-sm text-foreground mb-3">{question}</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="Ваш ответ..."
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
          autoFocus
        />
        <button
          onClick={handleSubmit}
          disabled={!answer.trim()}
          className="rounded-lg bg-foreground px-4 py-2 text-sm text-background hover:bg-foreground/90 disabled:opacity-30 transition-colors"
        >
          Ответить
        </button>
      </div>
    </div>
  );
}

/**
 * Strip only <thinking> tags during streaming. Full cleaning happens in ChatMessage for saved messages.
 */
function lightClean(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/<\/?thinking>/g, '')
    .replace(/^\s*\n/, '')
    .trim();
}

/**
 * ThinkingOrb — a living SVG glyph that encodes strategy, progress, and phase
 * through BEHAVIOR, not text. Each strategy has a unique visual signature.
 *
 * TRIZ #28 "Mechanics Substitution": replace text labels with visual metaphor.
 * One element, zero text, all information encoded in motion.
 */
function ThinkingOrb({ steps, strategy, isLive }: {
  steps: ThinkingStep[];
  strategy: string | null;
  isLive: boolean;
}) {
  if (!strategy || strategy === 'none') return null;
  if (steps.length === 0 && !isLive) return null;

  const progress = isLive ? Math.min(steps.length / 6, 0.95) : 1;
  const n = steps.length;

  return (
    <div className="flex items-center gap-3 mb-3 px-1 animate-fade-in">
      <svg viewBox="0 0 40 40" className="h-10 w-10 shrink-0" aria-hidden="true">
        {/* Base ring — always present */}
        <circle cx="20" cy="20" r="16" fill="none" stroke="hsl(var(--muted-foreground) / 0.1)" strokeWidth="1" />

        {strategy === 'cot' && (
          /* CoT: single arc that fills clockwise — step by step thinking */
          <>
            <circle cx="20" cy="20" r="16" fill="none"
              stroke="hsl(var(--foreground) / 0.25)" strokeWidth="1.5" strokeLinecap="round"
              strokeDasharray={`${progress * 100.5} 100.5`}
              transform="rotate(-90 20 20)"
              className="transition-all duration-700"
            />
            {isLive && <circle cx="20" cy="20" r="3" fill="hsl(var(--foreground) / 0.15)" className="animate-pulse" />}
            {!isLive && <circle cx="20" cy="20" r="2" fill="hsl(var(--foreground) / 0.3)" />}
          </>
        )}

        {strategy === 'best_of_n' && (
          /* Best-of-N: multiple dots orbiting, converging when done */
          <>
            {[0, 1, 2].map((i) => {
              const angle = (i * 120 + (isLive ? n * 30 : 0)) * Math.PI / 180;
              const r = isLive ? 12 : 4 * (1 - progress) + 2;
              const cx = 20 + Math.cos(angle) * r;
              const cy = 20 + Math.sin(angle) * r;
              return <circle key={i} cx={cx} cy={cy} r={isLive ? 2.5 : 3}
                fill={`hsl(var(--foreground) / ${i === 0 && !isLive ? 0.4 : 0.15})`}
                className="transition-all duration-500" />;
            })}
            {isLive && (
              <circle cx="20" cy="20" r="12" fill="none"
                stroke="hsl(var(--foreground) / 0.08)" strokeWidth="0.5" strokeDasharray="2 3"
                className="origin-center animate-[spin_8s_linear_infinite]" />
            )}
          </>
        )}

        {strategy === 'tree_of_thoughts' && (
          /* Tree: branches growing from center */
          <>
            {[0, 1, 2].map((i) => {
              const angle = (i * 120 - 90) * Math.PI / 180;
              const len = Math.min(n * 3, 14);
              return <line key={i}
                x1="20" y1="20"
                x2={20 + Math.cos(angle) * len}
                y2={20 + Math.sin(angle) * len}
                stroke={`hsl(var(--foreground) / ${0.1 + i * 0.05})`}
                strokeWidth="1.5" strokeLinecap="round"
                className="transition-all duration-500" />;
            })}
            <circle cx="20" cy="20" r={isLive ? 3 : 2.5}
              fill={`hsl(var(--foreground) / ${isLive ? 0.15 : 0.3})`}
              className={isLive ? 'animate-pulse' : ''} />
          </>
        )}

        {strategy === 'persona_council' && (
          /* Council: 4 dots that pulse in sequence, then merge */
          <>
            {[0, 1, 2, 3].map((i) => {
              const angle = (i * 90 - 45) * Math.PI / 180;
              const r = isLive ? 10 : 3;
              return <circle key={i}
                cx={20 + Math.cos(angle) * r}
                cy={20 + Math.sin(angle) * r}
                r={2}
                fill={`hsl(var(--foreground) / ${isLive && n % 4 === i ? 0.4 : 0.12})`}
                className="transition-all duration-300" />;
            })}
            {!isLive && <circle cx="20" cy="20" r="3" fill="hsl(var(--foreground) / 0.25)" />}
          </>
        )}

        {strategy === 'budget_forcing' && (
          /* Budget Forcing: concentric rings that breathe — deeper each round */
          <>
            {Array.from({ length: Math.min(n + 1, 4) }).map((_, i) => (
              <circle key={i} cx="20" cy="20" r={6 + i * 4}
                fill="none" stroke={`hsl(var(--foreground) / ${0.06 + i * 0.04})`}
                strokeWidth="1"
                className={isLive && i === Math.min(n, 3) ? 'animate-pulse' : ''} />
            ))}
            <circle cx="20" cy="20" r="2.5" fill={`hsl(var(--foreground) / ${isLive ? 0.15 : 0.3})`} />
          </>
        )}

        {strategy === 'rubber_duck' && (
          /* Rubber Duck: circle that splits and re-merges (draft → review → fix) */
          <>
            <circle cx={isLive && n >= 1 ? 15 : 20} cy="20" r={isLive ? 5 : 6}
              fill="none" stroke="hsl(var(--foreground) / 0.15)" strokeWidth="1.5"
              className="transition-all duration-700" />
            {(isLive ? n >= 1 : true) && (
              <circle cx={isLive && n < 3 ? 25 : 20} cy="20" r={isLive && n < 3 ? 4 : 6}
                fill="none" stroke="hsl(var(--foreground) / 0.1)" strokeWidth="1"
                className="transition-all duration-700" />
            )}
            <circle cx="20" cy="20" r="1.5" fill={`hsl(var(--foreground) / ${isLive ? 0.15 : 0.3})`} />
          </>
        )}

        {strategy === 'socratic' && (
          /* Socratic: question marks as dots forming a triangle, converging */
          <>
            {[0, 1, 2].map((i) => {
              const angle = (i * 120 - 90) * Math.PI / 180;
              const r = isLive && n <= i + 1 ? 12 : 5;
              return <circle key={i}
                cx={20 + Math.cos(angle) * r}
                cy={20 + Math.sin(angle) * r}
                r={isLive && n <= i + 1 ? 2 : 2.5}
                fill={`hsl(var(--foreground) / ${n > i + 1 || !isLive ? 0.25 : 0.08})`}
                className="transition-all duration-500" />;
            })}
            {!isLive && <circle cx="20" cy="20" r="3" fill="hsl(var(--foreground) / 0.2)" />}
          </>
        )}

        {strategy === 'triz' && (
          /* TRIZ: rotating triangle with inner spark — invention in progress */
          <>
            <polygon points="20,6 34,30 6,30" fill="none"
              stroke="hsl(var(--foreground) / 0.15)" strokeWidth="1.5"
              className={isLive ? 'origin-center animate-[spin_6s_linear_infinite]' : ''} />
            <circle cx="20" cy="22" r={isLive ? 3 : 2.5}
              fill={`hsl(var(--foreground) / ${isLive ? 0.2 : 0.3})`}
              className={isLive ? 'animate-pulse' : ''} />
            {n > 0 && <circle cx="20" cy="22" r={Math.min(n * 3, 10)}
              fill="none" stroke="hsl(var(--foreground) / 0.08)" strokeWidth="0.5" />}
          </>
        )}

        {/* Fallback for auto/unknown */}
        {!['cot','best_of_n','tree_of_thoughts','persona_council','budget_forcing','rubber_duck','socratic','triz'].includes(strategy) && (
          <circle cx="20" cy="20" r="4" fill="hsl(var(--foreground) / 0.1)" className={isLive ? 'animate-pulse' : ''} />
        )}
      </svg>

      {/* Minimal text — only strategy name + step count, no verbose labels */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] font-medium text-muted-foreground/50">
          {STRATEGY_LABELS_RU[strategy] || strategy}
        </span>
        {n > 0 && (
          <span className="text-[10px] text-muted-foreground/30">
            {isLive ? `шаг ${n}` : `${n} ${n === 1 ? 'шаг' : n < 5 ? 'шага' : 'шагов'}`}
          </span>
        )}
      </div>
    </div>
  );
}

export function StreamingMessage({ content, isThinking, thinkingSteps, strategy, persona }: Props) {
  const clarificationQuestion = useChatStore((s) => s.streaming.clarificationQuestion);
  const sendClarification = useChatStore((s) => s.sendClarification);
  const tokensGenerated = useChatStore((s) => s.streaming.tokensGenerated);
  const isStreaming = useChatStore((s) => s.streaming.isStreaming);


  const strategyBarClass = strategy && strategy !== 'none' ? `strategy-bar-${strategy}` : '';

  // Light clean: only strip <thinking> tags, keep everything else visible during streaming
  const displayContent = content ? lightClean(content) : '';

  return (
    <div className="mb-6">
      {/* ThinkingOrb — living visual glyph that shows reasoning strategy */}
      <ThinkingOrb
        steps={thinkingSteps}
        strategy={strategy}
        isLive={isStreaming}
      />

      {/* Clarification question — inline form */}
      {clarificationQuestion && (
        <ClarificationUI question={clarificationQuestion} onSubmit={sendClarification} />
      )}

      {/* Content */}
      {displayContent ? (
        <div className={cn('animate-diffuse-in', strategyBarClass && 'border-l-2', strategyBarClass)}>
          <div className="px-4 py-3">
            <div className="prose prose-sm max-w-none break-words text-foreground">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayContent}
              </ReactMarkdown>
            </div>
            <span className="streaming-cursor" />
          </div>
          {tokensGenerated > 0 && (
            <div className="px-4 pb-1">
              <span className="text-[11px] font-mono text-muted-foreground/30">{tokensGenerated} tok</span>
            </div>
          )}
        </div>
      ) : clarificationQuestion ? null : isStreaming ? (
        <SkeletonLoading />
      ) : null}
    </div>
  );
}
