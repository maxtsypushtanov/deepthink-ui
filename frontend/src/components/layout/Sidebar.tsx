import { useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useThemeStore } from '@/stores/themeStore';
import { cn, formatTimestamp } from '@/lib/utils';
import {
  Plus,
  MessageSquare,
  Trash2,
  Settings,
  Moon,
  Sun,
  ChevronLeft,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { SettingsDialog } from '@/components/settings/SettingsDialog';

export function Sidebar() {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeConversationId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const createConversation = useChatStore((s) => s.createConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const theme = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <aside
        className={cn(
          'flex flex-col border-r border-border bg-card transition-all duration-200',
          collapsed ? 'w-14' : 'w-64',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-3">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-foreground" />
              <span className="text-sm font-semibold tracking-tight">DeepThink</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* New Chat */}
        <div className="px-2 py-2">
          <button
            onClick={() => createConversation()}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Новый чат</span>}
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-2">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={cn(
                'group relative mb-0.5 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                activeId === conv.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                collapsed && 'justify-center px-0',
              )}
              onClick={() => selectConversation(conv.id)}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              {!collapsed && (
                <>
                  <span className="truncate">{conv.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                    className="ml-auto hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Bottom actions */}
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <button
            onClick={toggleTheme}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {!collapsed && (
            <button
              onClick={() => setSettingsOpen(true)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
        </div>
      </aside>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
