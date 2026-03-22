import { useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ModelSelector } from './ModelSelector';
import { StreamingMessage } from './StreamingMessage';
import { EmptyState } from './EmptyState';
import { PersonaIndicator } from '@/components/reasoning/PersonaIndicator';

export function ChatArea() {
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const activeId = useChatStore((s) => s.activeConversationId);
  const error = useChatStore((s) => s.error);
  const clearError = useChatStore((s) => s.clearError);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (scrollTimeoutRef.current) return;
    scrollTimeoutRef.current = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      scrollTimeoutRef.current = null;
    }, 150);
  }, [messages, streaming.currentContent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  return (
    <main className="flex flex-1 flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border px-6 py-2">
        <ModelSelector />
        <PersonaIndicator persona={streaming.currentPersona} />
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && !streaming.isStreaming ? (
          <EmptyState />
        ) : (
          <div className="mx-auto max-w-3xl px-4 py-6">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}

            {streaming.isStreaming && (streaming.currentContent || streaming.isThinking || streaming.thinkingSteps.length > 0) && (
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
