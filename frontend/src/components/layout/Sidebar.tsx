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
          'flex flex-col border-r border-border bg-card',
          'transition-[width] duration-300 ease-out',
          collapsed ? 'w-14' : 'w-64',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-3">
          {!collapsed && (
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="text-sm font-semibold tracking-tight whitespace-nowrap">Deep Think UI</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Развернуть панель' : 'Свернуть панель'}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* New Chat */}
        <div className="px-2 py-2">
          <button
            onClick={() => createConversation()}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground',
              'transition-colors hover:bg-accent hover:text-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Новый чат</span>}
          </button>
        </div>

        {/* Chat Explorer */}
        <ChatExplorer collapsed={collapsed} />

        {/* Bottom actions */}
        <div className="flex items-center justify-between border-t border-border px-3 py-2.5">
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {!collapsed && (
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Настройки"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
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
