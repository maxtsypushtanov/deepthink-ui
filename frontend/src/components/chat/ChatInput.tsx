import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { STRATEGY_LABELS_RU } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { ReasoningStrategy } from '@/types';
import { ArrowUp, Square, Brain, Sparkles, GitBranch, TreePine, Target, Zap } from 'lucide-react';

const STRATEGY_OPTIONS: { key: ReasoningStrategy; icon: React.ComponentType<any>; color: string }[] = [
  { key: 'auto', icon: Zap, color: 'text-amber-400' },
  { key: 'none', icon: Target, color: 'text-gray-400' },
  { key: 'cot', icon: Brain, color: 'text-blue-400' },
  { key: 'budget_forcing', icon: Sparkles, color: 'text-purple-400' },
  { key: 'best_of_n', icon: GitBranch, color: 'text-green-400' },
  { key: 'tree_of_thoughts', icon: TreePine, color: 'text-orange-400' },
];

const PLACEHOLDERS = [
  'Спросите что угодно...',
  'Докажи, что √2 иррациональное число...',
  'Сравни REST и GraphQL...',
  'Объясни квантовые вычисления простыми словами...',
  'Напиши функцию сортировки на Python...',
];

export function ChatInput() {
  const [input, setInput] = useState('');
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const isStreaming = useChatStore((s) => s.streaming.isStreaming);
  const strategy = useChatStore((s) => s.settings.strategy);
  const updateSettings = useChatStore((s) => s.updateSettings);

  const currentOption = STRATEGY_OPTIONS.find((o) => o.key === strategy) || STRATEGY_OPTIONS[0];
  const CurrentIcon = currentOption.icon;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  useEffect(() => {
    const timer = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  // Listen for edit-message events from ChatMessage
  useEffect(() => {
    const handler = (e: Event) => {
      const content = (e as CustomEvent).detail;
      if (typeof content === 'string') {
        setInput(content);
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('deepthink:edit-message', handler);
    return () => window.removeEventListener('deepthink:edit-message', handler);
  }, []);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput('');
    sendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mx-auto max-w-3xl">
        <div className="relative flex items-end rounded-xl border border-border bg-card shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-2 focus-within:ring-ring/50 focus-within:border-foreground/20">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={PLACEHOLDERS[placeholderIdx]}
            rows={1}
            className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            {/* Strategy chip */}
            <div className="relative">
              <button
                onClick={() => setStrategyOpen(!strategyOpen)}
                className={cn(
                  'flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-medium transition-colors',
                  'hover:bg-accent text-muted-foreground',
                )}
                title={`Стратегия: ${STRATEGY_LABELS_RU[strategy] || strategy}`}
              >
                <CurrentIcon className={cn('h-3.5 w-3.5', currentOption.color)} />
              </button>

              {strategyOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setStrategyOpen(false)} />
                  <div className="absolute bottom-full right-0 z-50 mb-2 w-52 rounded-lg border border-border bg-card p-1.5 shadow-lg">
                    {STRATEGY_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.key}
                          onClick={() => {
                            updateSettings({ strategy: opt.key });
                            setStrategyOpen(false);
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:bg-accent',
                            strategy === opt.key ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground',
                          )}
                        >
                          <Icon className={cn('h-3.5 w-3.5', opt.color)} />
                          {STRATEGY_LABELS_RU[opt.key] || opt.key}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {isStreaming ? (
              <button
                onClick={stopStreaming}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!input.trim()}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                  input.trim()
                    ? 'bg-foreground text-background hover:bg-foreground/90'
                    : 'bg-muted text-muted-foreground cursor-not-allowed',
                )}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-end px-1">
          <span className="text-[10px] text-muted-foreground">
            Shift+Enter — новая строка
          </span>
        </div>
      </div>
    </div>
  );
}
