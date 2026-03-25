import { useState, useMemo, useEffect, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ThinkingStep, ReasoningStrategy } from '@/types';
import { cn, formatTimestamp, cleanAssistantContent } from '@/lib/utils';
import { STRATEGY_LABELS_RU } from '@/lib/constants';
import { ThinkingPanel } from '@/components/reasoning/ThinkingPanel';
import {
  User, Bot, Copy, Check, Pencil, GitFork, RefreshCw,
  Zap, Brain, Sparkles, GitBranch, TreePine, Target, Users, Bug, HelpCircle,
  Clipboard, ClipboardCheck,
} from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useForkStore } from '@/stores/forkStore';

/* ── Code block with copy button ── */

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
  };

  return (
    <div className="rounded-lg overflow-hidden my-3 border border-border">
      <div className="flex items-center justify-between bg-muted/50 border-b border-border px-3 py-1.5">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          {copied ? (
            <>
              <ClipboardCheck className="h-3 w-3 text-green-500" />
              <span className="text-green-500">Скопировано!</span>
            </>
          ) : (
            <>
              <Clipboard className="h-3 w-3" />
              <span>Копировать</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto bg-muted/30 p-3 text-sm">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const STRATEGY_OPTIONS: { key: ReasoningStrategy; icon: React.ComponentType<any>; color: string }[] = [
  { key: 'auto', icon: Zap, color: 'text-amber-400' },
  { key: 'none', icon: Target, color: 'text-gray-400' },
  { key: 'cot', icon: Brain, color: 'text-blue-400' },
  { key: 'budget_forcing', icon: Sparkles, color: 'text-purple-400' },
  { key: 'best_of_n', icon: GitBranch, color: 'text-green-400' },
  { key: 'tree_of_thoughts', icon: TreePine, color: 'text-orange-400' },
  { key: 'persona_council', icon: Users, color: 'text-cyan-400' },
  { key: 'rubber_duck', icon: Bug, color: 'text-yellow-400' },
  { key: 'socratic', icon: HelpCircle, color: 'text-rose-400' },
];

interface Props {
  message: Message;
}

const ChatMessageInner = memo(function ChatMessage({ message }: Props) {
  const [copied, setCopied] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const isUser = message.role === 'user';

  const thinkingSteps: ThinkingStep[] = useMemo(() => {
    if (!message.reasoning_trace) return [];
    try { return JSON.parse(message.reasoning_trace); }
    catch { return []; }
  }, [message.reasoning_trace]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
  };

  const handleEdit = () => {
    const store = useChatStore.getState();
    const idx = store.messages.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      useChatStore.setState({ messages: store.messages.slice(0, idx) });
    }
    window.dispatchEvent(new CustomEvent('deepthink:edit-message', { detail: message.content }));
  };

  const handleFork = async () => {
    const store = useChatStore.getState();
    const convId = store.activeConversationId;
    if (!convId) return;
    const idx = store.messages.findIndex((m) => m.id === message.id);
    if (idx < 0) return;
    await useForkStore.getState().createFork(convId, idx);
  };

  const handleRegenerate = (selectedStrategy: ReasoningStrategy) => {
    const store = useChatStore.getState();
    const msgs = store.messages;
    const idx = msgs.findIndex((m) => m.id === message.id);
    // Find the user message before this assistant message
    const userMsg = msgs.slice(0, idx).reverse().find((m) => m.role === 'user');
    if (!userMsg) return;
    // Truncate messages to before this assistant response
    useChatStore.setState({ messages: msgs.slice(0, idx) });
    // Update strategy and resend
    store.updateSettings({ strategy: selectedStrategy });
    store.sendMessage(userMsg.content);
    setRegenOpen(false);
  };

  return (
    <div className={cn('animate-fade-in group mb-6', isUser ? 'flex justify-end' : '')}>
      <div className={cn('max-w-full', isUser ? 'max-w-[80%]' : '')}>
        {/* Avatar & role */}
        <div className="mb-1.5 flex items-center gap-2">
          <div
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md',
              isUser ? 'bg-foreground text-background' : 'bg-accent',
            )}
          >
            {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            {isUser ? 'Вы' : message.model || 'Ассистент'}
          </span>
          {message.reasoning_strategy && message.reasoning_strategy !== 'none' && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {STRATEGY_LABELS_RU[message.reasoning_strategy] || message.reasoning_strategy.replace('_', ' ')}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground transition-colors ml-auto">
            {formatTimestamp(message.created_at)}
          </span>
        </div>

        {/* Thinking panel */}
        {thinkingSteps.length > 0 && (
          <ThinkingPanel steps={thinkingSteps} strategy={message.reasoning_strategy || ''} />
        )}

        {/* Content */}
        <div
          className={cn(
            'rounded-xl px-4 py-3',
            isUser
              ? 'bg-foreground text-background border border-foreground/10'
              : 'bg-card border border-border',
          )}
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }) {
                    const isBlock = className?.startsWith('language-');
                    if (!isBlock) {
                      return <code className={className} {...props}>{children}</code>;
                    }
                    const language = className?.replace('language-', '') || '';
                    return <CodeBlock language={language} code={String(children).replace(/\n$/, '')} />;
                  },
                }}
              >
                {cleanAssistantContent(message.content)}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            onClick={handleCopy}
            title="Копировать текст"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-green-500" /> Скопировано
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" /> Копировать
              </>
            )}
          </button>
          {isUser && (
            <button
              onClick={handleEdit}
              title="Редактировать сообщение"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Pencil className="h-3 w-3" /> Изменить
            </button>
          )}
          {!isUser && (
            <button
              onClick={handleFork}
              title="Разветвить диалог с этой точки"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <GitFork className="h-3 w-3" /> Fork
            </button>
          )}
          {!isUser && (
            <div className="relative">
              <button
                onClick={() => setRegenOpen(!regenOpen)}
                title="Переделать с другой стратегией"
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <RefreshCw className="h-3 w-3" /> Переделать
              </button>
              {regenOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setRegenOpen(false)} />
                  <div className="absolute -left-2 bottom-full mb-1 z-50 w-52 rounded-xl border border-border bg-card shadow-xl p-1.5 animate-fade-in-scale">
                    {STRATEGY_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.key}
                          onClick={() => handleRegenerate(opt.key)}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors hover:bg-accent text-muted-foreground"
                        >
                          <Icon className={cn('h-3.5 w-3.5', opt.color)} />
                          {STRATEGY_LABELS_RU[opt.key] || opt.key}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export const ChatMessage = ChatMessageInner;
