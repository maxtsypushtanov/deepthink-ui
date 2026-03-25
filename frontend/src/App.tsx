import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { ChatArea } from '@/components/chat/ChatArea';
import { CalendarView } from '@/components/Calendar/CalendarView';
import { CommandPalette } from '@/components/CommandPalette';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { useThemeStore } from '@/stores/themeStore';
import { useChatStore } from '@/stores/chatStore';
import { cn } from '@/lib/utils';
import { MessageSquare, Calendar } from 'lucide-react';

type Tab = 'chat' | 'calendar';

export default function App() {
  const theme = useThemeStore((s) => s.mode);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const createConversation = useChatStore((s) => s.createConversation);
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        createConversation();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        document.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [createConversation]);

  // Listen for custom events from CommandPalette
  useEffect(() => {
    const handleSwitchTab = (e: Event) => {
      const tab = (e as CustomEvent).detail as Tab;
      setActiveTab(tab);
    };
    const handleOpenSettings = () => {
      setSettingsOpen(true);
    };
    window.addEventListener('deepthink:switch-tab', handleSwitchTab);
    window.addEventListener('deepthink:open-settings', handleOpenSettings);
    return () => {
      window.removeEventListener('deepthink:switch-tab', handleSwitchTab);
      window.removeEventListener('deepthink:open-settings', handleOpenSettings);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar />
      <CommandPalette />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Tab bar */}
        <div role="tablist" className="flex items-center gap-1 border-b border-border bg-card/50 px-3">
          <TabButton
            active={activeTab === 'chat'}
            onClick={() => setActiveTab('chat')}
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            label="Чат"
          />
          <TabButton
            active={activeTab === 'calendar'}
            onClick={() => setActiveTab('calendar')}
            icon={<Calendar className="h-3.5 w-3.5" />}
            label="Календарь"
          />
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'chat' && <ChatArea />}
          {activeTab === 'calendar' && <CalendarView />}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: boolean;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-0 rounded-t-md',
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
      {badge && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-400" />
        </span>
      )}
      {/* Active indicator line */}
      {active && (
        <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground rounded-full" />
      )}
    </button>
  );
}
