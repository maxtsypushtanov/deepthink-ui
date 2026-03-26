/**
 * ProactiveMessage — the agent initiates conversation.
 * Looks like an organic chat message from DeepThink, not a notification.
 */

import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Sun, Calendar, MessageCircle, Sparkles, Moon, X } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';

const POLL_INTERVAL = 5 * 60 * 1000;

const ICONS = {
  sun: Sun,
  calendar: Calendar,
  message: MessageCircle,
  sparkle: Sparkles,
  moon: Moon,
};

export function ProactiveMessage() {
  const [msg, setMsg] = useState<{ type: string; icon: string; message: string } | null>(null);
  const [phase, setPhase] = useState<'hidden' | 'entering' | 'visible' | 'leaving'>('hidden');
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const isStreaming = useChatStore((s) => s.streaming.isStreaming);

  useEffect(() => {
    const check = async () => {
      // Don't interrupt streaming
      if (useChatStore.getState().streaming.isStreaming) return;

      try {
        const resp = await fetch(`${API_BASE}/api/proactive/check`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.message) {
          setMsg(data);
          setPhase('entering');
          requestAnimationFrame(() =>
            requestAnimationFrame(() => setPhase('visible'))
          );
        }
      } catch { /* silent */ }
    };

    check();
    intervalRef.current = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, []);

  const dismiss = () => {
    setPhase('leaving');
    setTimeout(() => { setPhase('hidden'); setMsg(null); }, 500);
  };

  if (phase === 'hidden' || !msg) return null;
  if (isStreaming) return null; // Hide during streaming

  const IconComp = ICONS[msg.icon as keyof typeof ICONS] || Sparkles;

  return (
    <div className={cn(
      'mb-6 transition-all duration-500 ease-out',
      phase === 'entering' && 'opacity-0 translate-y-3 blur-sm',
      phase === 'visible' && 'opacity-100 translate-y-0 blur-0',
      phase === 'leaving' && 'opacity-0 -translate-y-2 blur-sm',
    )}>
      {/* Looks like a regular assistant message */}
      <div className="group">
        {/* Subtle indicator that this is proactive, not a response */}
        <div className="flex items-center gap-1.5 mb-1.5 px-1">
          <IconComp className="h-3 w-3 text-muted-foreground/25" />
          <span className="text-[10px] text-muted-foreground/20">DeepThink</span>
          <button
            onClick={dismiss}
            className="ml-auto opacity-0 group-hover:opacity-100 rounded p-0.5 text-muted-foreground/20 hover:text-muted-foreground transition-all"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>

        {/* Message body — same style as regular assistant messages */}
        <div className="rounded-2xl px-4 py-3">
          <p className="text-[15px] text-foreground/80 leading-relaxed whitespace-pre-wrap">
            {msg.message}
          </p>
        </div>
      </div>
    </div>
  );
}
