import { useState, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useThemeStore } from '@/stores/themeStore';
import { cn } from '@/lib/utils';
import {
  Plus,
  Settings,
  Moon,
  Sun,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { DeepThinkLogo } from '@/components/icons/DeepThinkLogo';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { ChatExplorer } from '@/components/sidebar/ChatExplorer';

export function Sidebar() {
  const activeId = useChatStore((s) => s.activeConversationId);
  const createConversation = useChatStore((s) => s.createConversation);
  const loadFolders = useChatStore((s) => s.loadFolders);
  const theme = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  return (
    <>
      <aside
        className={cn(
          'flex flex-col border-r border-border bg-card transition-all duration-300 ease-out',
          collapsed ? 'w-14' : 'w-64',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-3">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <DeepThinkLogo size={20} />
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
              'flex w-full items-center gap-2 rounded-lg bg-foreground/5 border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Новый чат</span>}
          </button>
        </div>

        {/* Chat Explorer (folders + conversations tree) */}
        <ChatExplorer collapsed={collapsed} />

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
