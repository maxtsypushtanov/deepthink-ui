import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useThemeStore } from '@/stores/themeStore';
import { useBehaviorStore } from '@/stores/behaviorStore';
import type { ReasoningStrategy } from '@/types';
import {
  Search, MessageSquare, Download, Brain, Calendar, Settings,
  Sun, Moon, Zap, TreePine, Users, HelpCircle, Bug, Sparkles,
  Target, GitBranch, Mic, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { STRATEGY_LABELS_RU } from '@/lib/constants';

interface Command {
  id: string;
  category: string;
  name: string;
  description?: string;
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
  const conversations = useChatStore((s) => s.conversations);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const messages = useChatStore((s) => s.messages);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const theme = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const trackEvent = useBehaviorStore((s) => s.trackEvent);

  // Strategy override: set strategy for next message, then auto-reset
  const overrideStrategy = useCallback((strategy: ReasoningStrategy) => {
    updateSettings({ strategy });
    trackEvent('strategy_override');
    // Auto-reset after next message is sent (or after 5min timeout)
    const unsub = useChatStore.subscribe((state, prevState) => {
      if (state.streaming.isStreaming && !prevState.streaming.isStreaming) {
        setTimeout(() => { updateSettings({ strategy: 'auto' }); unsub(); }, 100);
        clearTimeout(timeout);
      }
    });
    const timeout = setTimeout(() => { updateSettings({ strategy: 'auto' }); unsub(); }, 5 * 60 * 1000);
  }, [updateSettings, trackEvent]);

  const commands = useMemo<Command[]>(() => {
    const exportChat = () => {
      if (!messages.length) return;
      const md = messages.map((m) => `### ${m.role === 'user' ? 'Вы' : 'DeepThink'}\n\n${m.content}`).join('\n\n---\n\n');
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `chat-${activeConversationId || 'export'}.md`; a.click();
      URL.revokeObjectURL(url);
    };

    const strategies: { key: ReasoningStrategy; label: string; desc: string; icon: React.ReactNode }[] = [
      { key: 'auto', label: 'Авто', desc: 'DeepThink выберет сам', icon: <Zap className="h-4 w-4" /> },
      { key: 'cot', label: 'Цепочка мыслей', desc: 'Пошаговое рассуждение', icon: <Brain className="h-4 w-4" /> },
      { key: 'budget_forcing', label: 'Углублённый анализ', desc: 'Многораундовый анализ', icon: <Sparkles className="h-4 w-4" /> },
      { key: 'best_of_n', label: 'Лучший из N', desc: 'Сравнение N вариантов', icon: <GitBranch className="h-4 w-4" /> },
      { key: 'tree_of_thoughts', label: 'Дерево мыслей', desc: 'Исследование ветвей', icon: <TreePine className="h-4 w-4" /> },
      { key: 'persona_council', label: 'Совет экспертов', desc: 'Экспертные перспективы', icon: <Users className="h-4 w-4" /> },
      { key: 'rubber_duck', label: 'Метод утёнка', desc: 'Объясни и исправь', icon: <Bug className="h-4 w-4" /> },
      { key: 'socratic', label: 'Метод Сократа', desc: 'Через вопросы', icon: <HelpCircle className="h-4 w-4" /> },
      { key: 'triz', label: 'Мастер ТРИЗ', desc: 'Изобретательское решение', icon: <Sparkles className="h-4 w-4" /> },
      { key: 'none', label: 'Прямой ответ', desc: 'Без рассуждений', icon: <Target className="h-4 w-4" /> },
    ];

    const cmds: Command[] = [
      // Chat
      { id: 'new-chat', category: 'Chat', name: 'Новый чат', icon: <MessageSquare className="h-4 w-4" />, shortcut: '⌘N', action: () => createConversation() },
      { id: 'search', category: 'Chat', name: 'Поиск в чате', icon: <Search className="h-4 w-4" />, shortcut: '⌘⇧F', action: () => window.dispatchEvent(new CustomEvent('deepthink:toggle-search')) },
      { id: 'export', category: 'Chat', name: 'Экспорт диалога', icon: <Download className="h-4 w-4" />, action: exportChat },
      // Strategy override
      ...strategies.map((s) => ({
        id: `strategy-${s.key}`,
        category: 'Strategy',
        name: s.label,
        description: s.desc + (s.key !== 'auto' ? ' (только следующее сообщение)' : ''),
        icon: s.icon,
        action: () => overrideStrategy(s.key),
      })),
      // Calendar
      { id: 'calendar', category: 'Calendar', name: 'Календарь', icon: <Calendar className="h-4 w-4" />,
        action: () => window.dispatchEvent(new CustomEvent('deepthink:open-inspect', { detail: 'calendar' })) },
      // View
      { id: 'sidebar', category: 'View', name: 'Боковая панель', icon: <Eye className="h-4 w-4" />, shortcut: '⌘\\',
        action: () => { /* handled by App.tsx keydown */ } },
      { id: 'inspect', category: 'View', name: 'Панель анализа', icon: <Eye className="h-4 w-4" />, shortcut: '⌘I',
        action: () => window.dispatchEvent(new CustomEvent('deepthink:open-inspect', { detail: 'metadata' })) },
      { id: 'theme', category: 'View', name: theme === 'dark' ? 'Светлая тема' : 'Тёмная тема', icon: theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />, shortcut: '⌘⇧D',
        action: () => setMode(theme === 'dark' ? 'light' : 'dark') },
      // Voice
      { id: 'voice', category: 'Voice', name: 'Голосовой ввод', icon: <Mic className="h-4 w-4" />,
        action: () => window.dispatchEvent(new CustomEvent('deepthink:toggle-voice')) },
      // Settings
      { id: 'settings', category: 'Settings', name: 'Настройки', icon: <Settings className="h-4 w-4" />, shortcut: '⌘,',
        action: () => window.dispatchEvent(new CustomEvent('deepthink:open-settings')) },
    ];

    return cmds;
  }, [createConversation, overrideStrategy, setMode, theme, messages, activeConversationId]);

  // Conversation search results
  const conversationResults = useMemo(() => {
    if (!query.trim() || query.length < 2) return [];
    const q = query.toLowerCase();
    return conversations
      .filter((c) => c.title.toLowerCase().includes(q))
      .slice(0, 5)
      .map((c) => ({
        id: `conv-${c.id}`,
        category: 'Conversations',
        name: c.title,
        icon: <MessageSquare className="h-4 w-4" />,
        action: () => selectConversation(c.id),
      }));
  }, [conversations, selectConversation, query]);

  // Natural language command parsing — maps free-form queries to strategy/action commands
  const parseNaturalLanguage = useCallback((q: string): Command[] => {
    if (!q.trim()) return [];

    const patterns: { regex: RegExp; commandId: string }[] = [
      { regex: /(?:глубок|тщательн|подробн|углубл)/i, commandId: 'strategy-budget_forcing' },
      { regex: /(?:сравни|сопостав|versus|vs\.?)/i, commandId: 'strategy-best_of_n' },
      { regex: /(?:объясни просто|простым|как ребёнку|like.*5|simply)/i, commandId: 'strategy-rubber_duck' },
      { regex: /(?:эксперт|совет|мнени|perspectiv|opinions)/i, commandId: 'strategy-persona_council' },
      { regex: /(?:пошагов|step.?by.?step|цепочк)/i, commandId: 'strategy-cot' },
      { regex: /(?:отлад|debug|ошибк|bug|fix)/i, commandId: 'strategy-rubber_duck' },
      { regex: /(?:докажи|prove|обоснуй|дерево)/i, commandId: 'strategy-tree_of_thoughts' },
      { regex: /(?:сократ|вопрос|подвопрос|socratic)/i, commandId: 'strategy-socratic' },
      { regex: /(?:тем[аы]|dark|light|светл|тёмн)/i, commandId: 'theme' },
      { regex: /(?:экспорт|export|сохран|download)/i, commandId: 'export' },
    ];

    const matchedIds = new Set<string>();
    for (const { regex, commandId } of patterns) {
      if (regex.test(q)) {
        matchedIds.add(commandId);
      }
    }

    if (matchedIds.size === 0) return [];

    return commands.filter((cmd) => matchedIds.has(cmd.id));
  }, [commands]);

  const filtered = useMemo(() => {
    const allCommands = [...commands, ...conversationResults];
    if (!query.trim()) return commands; // Don't show conversations without query
    const q = query.toLowerCase();
    return allCommands.filter((c) =>
      c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q) || (c as any).description?.toLowerCase().includes(q)
    );
  }, [commands, conversationResults, query]);

  // NL fallback suggestions when exact filtering yields nothing
  const nlSuggestions = useMemo(() => {
    if (filtered.length > 0 || !query.trim()) return [];
    return parseNaturalLanguage(query);
  }, [filtered, query, parseNaturalLanguage]);

  // Combined list for keyboard navigation
  const navigableItems = useMemo(() => {
    if (filtered.length > 0) return filtered;
    return nlSuggestions;
  }, [filtered, nlSuggestions]);

  const grouped = useMemo(() => {
    const groups: { category: string; items: Command[] }[] = [];
    let cur = '';
    for (const cmd of filtered) {
      if (cmd.category !== cur) { cur = cmd.category; groups.push({ category: cur, items: [] }); }
      groups[groups.length - 1].items.push(cmd);
    }
    return groups;
  }, [filtered]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(p => !p); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    if (open) { setQuery(''); setActiveIndex(0); requestAnimationFrame(() => inputRef.current?.focus()); }
  }, [open]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const execute = useCallback((cmd: Command) => { setOpen(false); cmd.action(); }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => (i + 1) % navigableItems.length); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => (i - 1 + navigableItems.length) % navigableItems.length); return; }
    if (e.key === 'Enter') { e.preventDefault(); const cmd = navigableItems[activeIndex]; if (cmd) execute(cmd); }
  }, [navigableItems, activeIndex, execute]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  if (!open) return null;

  let itemIndex = -1;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative z-10 w-full max-w-lg mx-4 rounded-xl border border-border bg-card shadow-2xl animate-fade-in-scale" onKeyDown={handleKeyDown}>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input ref={inputRef} type="text" placeholder="Поиск команд и диалогов..."
            value={query} onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/30" />
          <kbd className="hidden sm:inline-flex rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
        </div>
        <div ref={listRef} className="max-h-[400px] overflow-y-auto py-1">
          {grouped.length === 0 && nlSuggestions.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground/50">Ничего не найдено</div>
          )}
          {grouped.length === 0 && nlSuggestions.length > 0 && (
            <div>
              <div className="text-[10px] uppercase text-muted-foreground/30 px-3 pt-3 pb-1 font-medium tracking-wider">Возможно, вы имели в виду:</div>
              {nlSuggestions.map((cmd) => {
                itemIndex++;
                const isActive = itemIndex === activeIndex;
                const idx = itemIndex;
                return (
                  <button key={cmd.id} data-active={isActive} onClick={() => execute(cmd)} onMouseEnter={() => setActiveIndex(idx)}
                    className={cn('flex w-full items-center gap-3 px-3 py-2 text-left transition-colors', isActive ? 'bg-muted' : 'hover:bg-muted/50')}>
                    <span className="text-muted-foreground shrink-0">{cmd.icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm truncate block">{cmd.name}</span>
                      {cmd.description && <span className="text-[10px] text-muted-foreground/40 block truncate">{cmd.description}</span>}
                    </div>
                    {cmd.shortcut && <span className="text-[10px] text-muted-foreground/30 shrink-0">{cmd.shortcut}</span>}
                  </button>
                );
              })}
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.category}>
              <div className="text-[10px] uppercase text-muted-foreground/30 px-3 pt-3 pb-1 font-medium tracking-wider">{group.category}</div>
              {group.items.map((cmd) => {
                itemIndex++;
                const isActive = itemIndex === activeIndex;
                const idx = itemIndex;
                return (
                  <button key={cmd.id} data-active={isActive} onClick={() => execute(cmd)} onMouseEnter={() => setActiveIndex(idx)}
                    className={cn('flex w-full items-center gap-3 px-3 py-2 text-left transition-colors', isActive ? 'bg-muted' : 'hover:bg-muted/50')}>
                    <span className="text-muted-foreground shrink-0">{cmd.icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm truncate block">{cmd.name}</span>
                      {(cmd as any).description && <span className="text-[10px] text-muted-foreground/40 block truncate">{(cmd as any).description}</span>}
                    </div>
                    {cmd.shortcut && <span className="text-[10px] text-muted-foreground/30 shrink-0">{cmd.shortcut}</span>}
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
