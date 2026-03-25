import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useThemeStore } from '@/stores/themeStore';
import type { ReasoningStrategy } from '@/types';
import {
  Search,
  MessageSquare,
  Download,
  Brain,
  Calendar,
  Settings,
  Sun,
  Moon,
  Github,
  Zap,
  TreePine,
  Users,
  HelpCircle,
  Bug,
  Sparkles,
  ToggleLeft,
  Navigation,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Command {
  id: string;
  category: string;
  name: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const createConversation = useChatStore((s) => s.createConversation);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const toggleCalendarMode = useChatStore((s) => s.toggleCalendarMode);
  const toggleGitHubMode = useChatStore((s) => s.toggleGitHubMode);
  const messages = useChatStore((s) => s.messages);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const setMode = useThemeStore((s) => s.setMode);

  const commands = useMemo<Command[]>(() => {
    const exportChat = () => {
      if (!messages.length) return;
      const md = messages
        .map((m) => `### ${m.role === 'user' ? 'Вы' : 'Ассистент'}\n\n${m.content}`)
        .join('\n\n---\n\n');
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${activeConversationId || 'export'}.md`;
      a.click();
      URL.revokeObjectURL(url);
    };

    const strategies: { key: ReasoningStrategy; label: string; icon: React.ReactNode }[] = [
      { key: 'auto', label: 'Авто', icon: <Sparkles className="h-4 w-4" /> },
      { key: 'cot', label: 'Рассуждение', icon: <Brain className="h-4 w-4" /> },
      { key: 'budget_forcing', label: 'Углублённый анализ', icon: <Zap className="h-4 w-4" /> },
      { key: 'best_of_n', label: 'Сравнение вариантов', icon: <Users className="h-4 w-4" /> },
      { key: 'tree_of_thoughts', label: 'Исследование подходов', icon: <TreePine className="h-4 w-4" /> },
      { key: 'persona_council', label: 'Совет экспертов', icon: <Users className="h-4 w-4" /> },
      { key: 'rubber_duck', label: 'Объясни и исправь', icon: <Bug className="h-4 w-4" /> },
      { key: 'socratic', label: 'Метод Сократа', icon: <HelpCircle className="h-4 w-4" /> },
      { key: 'none', label: 'Без рассуждений', icon: <MessageSquare className="h-4 w-4" /> },
    ];

    return [
      // Chat
      {
        id: 'new-chat',
        category: 'Чат',
        name: 'Новый чат',
        icon: <MessageSquare className="h-4 w-4" />,
        shortcut: '⌘N',
        action: () => { createConversation(); },
      },
      {
        id: 'export-chat',
        category: 'Чат',
        name: 'Экспорт чата',
        icon: <Download className="h-4 w-4" />,
        action: exportChat,
      },
      // Strategies
      ...strategies.map((s) => ({
        id: `strategy-${s.key}`,
        category: 'Стратегии',
        name: `Стратегия: ${s.label}`,
        icon: s.icon,
        action: () => { updateSettings({ strategy: s.key }); },
      })),
      // Navigation
      {
        id: 'nav-chat',
        category: 'Навигация',
        name: 'Чат',
        icon: <MessageSquare className="h-4 w-4" />,
        action: () => { window.dispatchEvent(new CustomEvent('deepthink:switch-tab', { detail: 'chat' })); },
      },
      {
        id: 'nav-calendar',
        category: 'Навигация',
        name: 'Календарь',
        icon: <Calendar className="h-4 w-4" />,
        action: () => { window.dispatchEvent(new CustomEvent('deepthink:switch-tab', { detail: 'calendar' })); },
      },
      {
        id: 'nav-settings',
        category: 'Навигация',
        name: 'Настройки',
        icon: <Settings className="h-4 w-4" />,
        action: () => { window.dispatchEvent(new CustomEvent('deepthink:open-settings')); },
      },
      // Modes
      {
        id: 'mode-calendar',
        category: 'Режимы',
        name: 'Режим: Календарь',
        icon: <ToggleLeft className="h-4 w-4" />,
        action: toggleCalendarMode,
      },
      {
        id: 'mode-github',
        category: 'Режимы',
        name: 'Режим: GitHub',
        icon: <Github className="h-4 w-4" />,
        action: toggleGitHubMode,
      },
      // Theme
      {
        id: 'theme-dark',
        category: 'Тема',
        name: 'Тёмная тема',
        icon: <Moon className="h-4 w-4" />,
        action: () => { setMode('dark'); },
      },
      {
        id: 'theme-light',
        category: 'Тема',
        name: 'Светлая тема',
        icon: <Sun className="h-4 w-4" />,
        action: () => { setMode('light'); },
      },
    ];
  }, [createConversation, updateSettings, toggleCalendarMode, toggleGitHubMode, setMode, messages, activeConversationId]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) => c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q));
  }, [commands, query]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: { category: string; items: Command[] }[] = [];
    let currentCategory = '';
    for (const cmd of filtered) {
      if (cmd.category !== currentCategory) {
        currentCategory = cmd.category;
        groups.push({ category: currentCategory, items: [] });
      }
      groups[groups.length - 1].items.push(cmd);
    }
    return groups;
  }, [filtered]);

  const flatFiltered = filtered;

  // Open/close with Cmd+K
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const execute = useCallback((cmd: Command) => {
    setOpen(false);
    cmd.action();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % flatFiltered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + flatFiltered.length) % flatFiltered.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = flatFiltered[activeIndex];
        if (cmd) execute(cmd);
      }
    },
    [flatFiltered, activeIndex, execute],
  );

  // Reset activeIndex when filtered list changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  let itemIndex = -1;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-lg mx-4 rounded-xl border border-border bg-card shadow-2xl animate-fade-in-scale"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Введите команду..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[400px] overflow-y-auto py-2">
          {grouped.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Ничего не найдено
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.category}>
              <div className="text-[10px] uppercase text-muted-foreground/50 px-3 pt-3 pb-1 font-medium tracking-wider">
                {group.category}
              </div>
              {group.items.map((cmd) => {
                itemIndex++;
                const isActive = itemIndex === activeIndex;
                const currentIndex = itemIndex;
                return (
                  <button
                    key={cmd.id}
                    data-active={isActive}
                    onClick={() => execute(cmd)}
                    onMouseEnter={() => setActiveIndex(currentIndex)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                      isActive ? 'bg-accent' : 'hover:bg-accent/50',
                    )}
                  >
                    <span className="text-muted-foreground">{cmd.icon}</span>
                    <span className="text-sm">{cmd.name}</span>
                    {cmd.shortcut && (
                      <span className="text-[10px] text-muted-foreground/50 ml-auto">
                        {cmd.shortcut}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
