import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ThinkingStep } from '@/types';
import { cn, formatTimestamp } from '@/lib/utils';
import { STRATEGY_LABELS_RU } from '@/lib/constants';
import { ThinkingPanel } from '@/components/reasoning/ThinkingPanel';
import { User, Bot, Copy, Check, Pencil } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';

interface Props {
  message: Message;
}

export function ChatMessage({ message }: Props) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const thinkingSteps: ThinkingStep[] = message.reasoning_trace
    ? (() => {
        try {
          return JSON.parse(message.reasoning_trace);
        } catch {
          return [];
        }
      })()
    : [];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEdit = () => {
    const store = useChatStore.getState();
    // Find this message's index and trim messages to it (exclude it)
    const idx = store.messages.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      useChatStore.setState({ messages: store.messages.slice(0, idx) });
    }
    // Put content into input by dispatching a custom event
    window.dispatchEvent(new CustomEvent('deepthink:edit-message', { detail: message.content }));
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
          <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            {formatTimestamp(message.created_at)}
          </span>
        </div>

        {/* Thinking panel (if has reasoning trace) */}
        {thinkingSteps.length > 0 && (
          <ThinkingPanel steps={thinkingSteps} strategy={message.reasoning_strategy || ''} />
        )}

        {/* Content */}
        <div
          className={cn(
            'rounded-xl px-4 py-3',
            isUser
              ? 'bg-foreground/90 text-background'
              : 'bg-card border border-border',
          )}
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={handleCopy}
            title="Копировать текст"
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" /> Скопировано
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
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Pencil className="h-3 w-3" /> Изменить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
