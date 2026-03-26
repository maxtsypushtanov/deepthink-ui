import { useState, useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { cn, formatTimestamp } from '@/lib/utils';
import { Plus } from 'lucide-react';

/**
 * Ghost Sidebar — exists 0 seconds except when needed.
 *
 * - Default: invisible, 0px. No placeholder, no edge indicator.
 * - Trigger: hover on left 6px edge of screen OR Cmd+\
 * - Shows: overlay, semi-transparent, last 10 conversations. No search, no folders, no section headers.
 * - Dismiss: click on conversation (switch + hide), click outside, 2s after cursor leaves, Escape
 */
export function Sidebar() {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeConversationId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const createConversation = useChatStore((s) => s.createConversation);

  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const show = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setVisible(true);
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setVisible(false), 2000);
  }, []);

  const hide = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setVisible(false);
  }, []);

  // Hover on left edge of screen
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (e.clientX <= 6 && !visible) {
        show();
      }
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [visible, show]);

  // Cmd+\ toggle
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setVisible((v) => !v);
      }
      if (e.key === 'Escape' && visible) {
        hide();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible, hide]);

  // When cursor leaves sidebar → schedule hide
  const handleMouseLeave = () => {
    scheduleHide();
  };

  // When cursor enters sidebar → cancel hide
  const handleMouseEnter = () => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
  };

  const handleSelect = (id: string) => {
    selectConversation(id);
    hide();
  };

  const handleNewChat = () => {
    createConversation();
    hide();
  };

  // Last 10 conversations only
  const recentConvs = conversations.slice(0, 10);

  if (!visible) return null;

  return (
    <>
      {/* Invisible click-outside area */}
      <div className="fixed inset-0 z-40" onClick={hide} />

      {/* Ghost sidebar */}
      <div
        ref={sidebarRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-card/95 backdrop-blur-md border-r border-border/50"
        style={{ animation: 'slide-in-left 0.15s ease-out both' }}
      >
        {/* Новый чат */}
        <div className="px-3 pt-3 pb-1">
          <button
            onClick={handleNewChat}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Новый чат</span>
          </button>
        </div>

        {/* Conversations — just a list */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {recentConvs.length === 0 && (
            <p className="px-3 py-6 text-[13px] text-muted-foreground/30 text-center">
              Нет диалогов
            </p>
          )}
          {recentConvs.map((conv) => (
            <button
              key={conv.id}
              onClick={() => handleSelect(conv.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors',
                activeId === conv.id
                  ? 'bg-foreground/[0.06] text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground',
              )}
            >
              <span className="flex-1 truncate text-[13px]">{conv.title}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
