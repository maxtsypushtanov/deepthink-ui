import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { InspectPanel, type InspectMode } from '@/components/layout/InspectPanel';
import { ChatArea } from '@/components/chat/ChatArea';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastContainer } from '@/components/Toast';
import { OnboardingOverlay } from '@/components/OnboardingOverlay';
import { useThemeStore } from '@/stores/themeStore';
import { useChatStore } from '@/stores/chatStore';
import { api } from '@/lib/api';

const CommandPalette = lazy(() => import('@/components/CommandPalette').then((m) => ({ default: m.CommandPalette })));
const SettingsDialog = lazy(() => import('@/components/settings/SettingsDialog').then((m) => ({ default: m.SettingsDialog })));

export default function App() {
  const theme = useThemeStore((s) => s.mode);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const createConversation = useChatStore((s) => s.createConversation);
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    api.getProviders()
      .then((providers) => {
        const hasActiveKey = providers.some(
          (p) => p.provider === 'openrouter' && p.enabled && p.api_key_preview
        );
        setNeedsOnboarding(!hasActiveKey);
      })
      .catch(() => setNeedsOnboarding(true));
  }, []);

  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectMode, setInspectMode] = useState<InspectMode>('reasoning');
  const [inspectContent, setInspectContent] = useState<React.ReactNode>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const closeInspect = useCallback(() => { setInspectOpen(false); setInspectContent(null); }, []);

  const openInspect = useCallback((mode: InspectMode, content?: React.ReactNode) => {
    setInspectMode(mode);
    setInspectContent(content || null);
    setInspectOpen(true);
  }, []);

  const toggleInspect = useCallback((mode: InspectMode) => {
    if (inspectOpen && inspectMode === mode) {
      closeInspect();
    } else {
      openInspect(mode);
    }
  }, [inspectOpen, inspectMode, closeInspect, openInspect]);

  // Global keyboard shortcuts (Cmd+\ handled by Sidebar itself)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === 'n') { e.preventDefault(); createConversation(); }
      if (e.key === '/') { e.preventDefault(); document.querySelector<HTMLTextAreaElement>('textarea')?.focus(); }
      if (e.key === 'i' && !e.shiftKey) { e.preventDefault(); toggleInspect('metadata'); }
      if (e.key === ',') { e.preventDefault(); setSettingsOpen(true); }
      if (e.key === 'd' && e.shiftKey) { e.preventDefault(); useThemeStore.getState().toggle(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [createConversation, toggleInspect]);

  useEffect(() => {
    const handleOpenSettings = () => setSettingsOpen(true);
    const handleOpenInspect = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === 'string') {
        openInspect(detail as InspectMode);
      } else if (detail && typeof detail === 'object') {
        openInspect(detail.mode as InspectMode, detail.content);
      }
    };
    window.addEventListener('deepthink:open-settings', handleOpenSettings);
    window.addEventListener('deepthink:open-inspect', handleOpenInspect);
    return () => {
      window.removeEventListener('deepthink:open-settings', handleOpenSettings);
      window.removeEventListener('deepthink:open-inspect', handleOpenInspect);
    };
  }, [openInspect]);

  if (needsOnboarding === null) {
    return <div className="flex h-screen bg-background" />;
  }

  if (needsOnboarding) {
    return (
      <div className="h-screen bg-background text-foreground">
        <OnboardingOverlay onComplete={() => setNeedsOnboarding(false)} />
        <ToastContainer />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Chat takes full width — sidebar is ghost overlay */}
      <main className="flex-1 flex flex-col min-w-0">
        <ErrorBoundary>
          <ChatArea />
        </ErrorBoundary>
      </main>

      <InspectPanel open={inspectOpen} mode={inspectMode} onClose={closeInspect}>
        {inspectContent}
      </InspectPanel>

      {/* Ghost sidebar — renders as fixed overlay, takes 0px in layout */}
      <Sidebar />

      <Suspense fallback={null}>
        <CommandPalette />
        {settingsOpen && <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />}
      </Suspense>
      <ToastContainer />
    </div>
  );
}
