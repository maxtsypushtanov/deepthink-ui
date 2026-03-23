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
  const conversations = useChatStore((s) => s.conversations);
  const error = useChatStore((s) => s.error);
  const clearError = useChatStore((s) => s.clearError);
  const lastPersona = useChatStore((s) => s.lastPersona);
  const bottomRef = useRef<HTMLDivElement>(null);

  const displayPersona = streaming.currentPersona || lastPersona;
  const activeTitle = conversations.find((c) => c.id === activeId)?.title;

  // Auto-scroll on new messages and streaming content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming.currentContent]);

  return (
    <main className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-2">
        <ModelSelector />
        {activeTitle && (
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">
            {activeTitle}
          </span>
        )}
        <PersonaIndicator persona={displayPersona} />
      </header>

      {/* Messages — fills remaining space, scrollable */}
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
                  Закрыть
                </button>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input — pinned to bottom */}
      <div className="shrink-0">
        <ChatInput />
      </div>
    </main>
  );
}
