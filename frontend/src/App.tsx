import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { ChatArea } from '@/components/chat/ChatArea';
import { PipelineView } from '@/components/Pipeline/PipelineView';
import { CalendarView } from '@/components/Calendar/CalendarView';
import { useThemeStore } from '@/stores/themeStore';
import { useChatStore } from '@/stores/chatStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { cn } from '@/lib/utils';
import { MessageSquare, GitBranch, Calendar } from 'lucide-react';

type Tab = 'chat' | 'pipeline' | 'calendar';

export default function App() {
  const theme = useThemeStore((s) => s.mode);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const createConversation = useChatStore((s) => s.createConversation);
  const pipelineStatus = usePipelineStore((s) => s.status);
  const [activeTab, setActiveTab] = useState<Tab>('chat');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (pipelineStatus === 'running') {
      setActiveTab('pipeline');
    }
  }, [pipelineStatus]);

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center border-b border-border bg-card/50 px-2">
          <TabButton
            active={activeTab === 'chat'}
            onClick={() => setActiveTab('chat')}
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            label="Чат"
          />
          <TabButton
            active={activeTab === 'pipeline'}
            onClick={() => setActiveTab('pipeline')}
            icon={<GitBranch className="h-3.5 w-3.5" />}
            label="Пайплайн"
            badge={pipelineStatus === 'running'}
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
          {activeTab === 'pipeline' && <PipelineView />}
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
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
      {badge && (
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
      )}
    </button>
  );
}
