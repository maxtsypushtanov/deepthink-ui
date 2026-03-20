import { useEffect } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { ChatArea } from '@/components/chat/ChatArea';
import { useThemeStore } from '@/stores/themeStore';
import { useChatStore } from '@/stores/chatStore';

export default function App() {
  const theme = useThemeStore((s) => s.mode);
  const loadConversations = useChatStore((s) => s.loadConversations);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar />
      <ChatArea />
    </div>
  );
}
