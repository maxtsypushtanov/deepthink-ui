import { useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ModelSelector } from './ModelSelector';
import { StreamingMessage } from './StreamingMessage';
import { Zap } from 'lucide-react';

export function ChatArea() {
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const activeId = useChatStore((s) => s.activeConversationId);
  const error = useChatStore((s) => s.error);
  const clearError = useChatStore((s) => s.clearError);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming.currentContent]);

  return (
    <main className="flex flex-1 flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border px-6 py-2">
        <ModelSelector />
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && !streaming.isStreaming ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent">
                <Zap className="h-6 w-6 text-foreground" />
              </div>
              <h2 className="text-lg font-semibold">DeepThink UI</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Любая модель получает суперспособности к рассуждению. Выберите стратегию и начните диалог.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-4 py-6">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}

            {streaming.isStreaming && (
              <StreamingMessage
                content={streaming.currentContent}
                isThinking={streaming.isThinking}
                thinkingSteps={streaming.thinkingSteps}
                strategy={streaming.strategyUsed}
                persona={streaming.currentPersona}
              />
            )}

            {error && (
              <div className="animate-fade-in mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <p>{error}</p>
                <button
                  onClick={clearError}
                  className="mt-1 text-xs underline hover:no-underline"
                >
                  Dismiss
                </button>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput />
    </main>
  );
}
