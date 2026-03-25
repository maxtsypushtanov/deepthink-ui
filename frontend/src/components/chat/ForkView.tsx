import { useEffect, useRef, useState } from 'react';
import { useForkStore } from '@/stores/forkStore';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { StreamingMessage } from './StreamingMessage';
import { cn } from '@/lib/utils';
import { X, GitFork } from 'lucide-react';
import type { Message } from '@/types';
import { API_BASE } from '@/lib/api';

/**
 * Split-view container for forked conversations.
 * Shows two chat panels side by side (or as tabs on mobile).
 */
export function ForkView() {
  const activeFork = useForkStore((s) => s.activeFork);
  const closeFork = useForkStore((s) => s.closeFork);
  const [mobileTab, setMobileTab] = useState<'left' | 'right'>('right');

  if (!activeFork) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-in slide-in-from-right duration-200">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2 shrink-0 bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <GitFork className="h-4 w-4 text-primary" strokeWidth={1.5} />
          <span className="text-sm font-medium">Разветвление диалога</span>
        </div>

        {/* Mobile tabs */}
        <div className="flex items-center gap-1 sm:hidden">
          <button
            onClick={() => setMobileTab('left')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors',
              mobileTab === 'left' ? 'bg-accent text-foreground' : 'text-muted-foreground',
            )}
          >
            Оригинал
          </button>
          <button
            onClick={() => setMobileTab('right')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors',
              mobileTab === 'right' ? 'bg-primary/20 text-primary' : 'text-muted-foreground',
            )}
          >
            Ветка
          </button>
        </div>

        <button
          onClick={closeFork}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title="Закрыть разветвление"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Split panels */}
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 overflow-hidden">
        {/* Left: original branch */}
        <div className={cn(
          'flex flex-col overflow-hidden border-r border-border',
          mobileTab !== 'left' && 'hidden sm:flex',
        )}>
          <PanelHeader label="Оригинал" variant="default" />
          <ForkPanel conversationId={activeFork.left} readonly />
        </div>

        {/* Right: forked branch */}
        <div className={cn(
          'flex flex-col overflow-hidden',
          mobileTab !== 'right' && 'hidden sm:flex',
        )}>
          <PanelHeader label="Ветка" variant="fork" />
          <ForkPanel conversationId={activeFork.right} />
        </div>
      </div>
    </div>
  );
}

function PanelHeader({ label, variant }: { label: string; variant: 'default' | 'fork' }) {
  return (
    <div className={cn(
      'px-4 py-1.5 text-xs font-medium border-b shrink-0',
      variant === 'fork'
        ? 'border-primary/20 bg-primary/5 text-primary'
        : 'border-border bg-card/50 text-muted-foreground',
    )}>
      {variant === 'fork' && <GitFork className="h-3 w-3 inline mr-1.5 -mt-px" />}
      {label}
    </div>
  );
}

/**
 * A self-contained chat panel that loads and displays a conversation.
 * If `readonly`, no input field is shown (original branch).
 */
function ForkPanel({ conversationId, readonly }: { conversationId: string; readonly?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Main chatStore state — only used for the active (right) panel
  const storeMessages = useChatStore((s) => s.messages);
  const activeId = useChatStore((s) => s.activeConversationId);
  const streaming = useChatStore((s) => s.streaming);
  const selectConversation = useChatStore((s) => s.selectConversation);

  // For the fork branch: sync with chatStore when it's the active conversation
  const isActiveInStore = activeId === conversationId;

  useEffect(() => {
    if (!readonly && !isActiveInStore) {
      selectConversation(conversationId);
    }
  }, [conversationId, readonly, isActiveInStore, selectConversation]);

  // Load messages for readonly panel (original) independently
  useEffect(() => {
    if (!readonly) return;
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/api/conversations/${conversationId}/messages`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setMessages(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [conversationId, readonly]);

  // For active (right) panel, use store messages
  const displayMessages = readonly ? messages : isActiveInStore ? storeMessages : messages;

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayMessages.length, streaming.currentContent]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-1">
          {loading && readonly && displayMessages.length === 0 && (
            <p className="text-xs text-muted-foreground/50 text-center py-8">Загрузка...</p>
          )}
          {displayMessages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          {!readonly && isActiveInStore && streaming.isStreaming && (
            <StreamingMessage
              content={streaming.currentContent}
              isThinking={streaming.isThinking}
              thinkingSteps={streaming.thinkingSteps}
              strategy={streaming.strategyUsed}
              persona={streaming.currentPersona}
            />
          )}
        </div>
      </div>
      {!readonly && (
        <ChatInput />
      )}
    </div>
  );
}
