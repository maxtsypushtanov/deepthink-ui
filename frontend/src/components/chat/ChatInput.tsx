import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { cn } from '@/lib/utils';
import { ArrowUp, Square } from 'lucide-react';

export function ChatInput() {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const isStreaming = useChatStore((s) => s.streaming.isStreaming);
  const strategy = useChatStore((s) => s.settings.strategy);

  const STRATEGY_LABELS: Record<string, string> = {
    none: 'No reasoning',
    cot: 'Chain-of-Thought',
    budget_forcing: 'Budget Forcing',
    best_of_n: 'Best-of-N',
    tree_of_thoughts: 'Tree of Thoughts',
    auto: 'Auto (detect complexity)',
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

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
        <div className="relative flex items-end rounded-xl border border-border bg-card shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            rows={1}
            className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
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
        <div className="mt-1.5 flex items-center justify-between px-1">
          <span className="text-[10px] text-muted-foreground">
            Strategy: {STRATEGY_LABELS[strategy] || strategy}
          </span>
          <span className="text-[10px] text-muted-foreground">
            Shift+Enter for new line
          </span>
        </div>
      </div>
    </div>
  );
}
