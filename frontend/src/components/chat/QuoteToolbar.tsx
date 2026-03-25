import { useState, useEffect, useCallback, useRef } from 'react';
import { Quote } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Floating toolbar that appears when text is selected in the chat area.
 * Dispatches a custom event to insert the quoted text into ChatInput.
 */
export function QuoteToolbar() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState('');
  const [visible, setVisible] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    setVisible(false);
    // Let the fade-out animation finish before unmounting
    hideTimerRef.current = setTimeout(() => {
      setPos(null);
      setText('');
    }, 150);
  }, []);

  const handleSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      if (pos) dismiss();
      return;
    }

    const selected = sel.toString().trim();
    if (selected.length < 3 || selected.length > 2000) {
      if (pos) dismiss();
      return;
    }

    // Only trigger inside chat messages area
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const el = container instanceof Element ? container : container.parentElement;
    if (!el?.closest('[data-chat-messages]')) {
      if (pos) dismiss();
      return;
    }

    const rect = range.getBoundingClientRect();

    // Clear any pending hide timer
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    setPos({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    });
    setText(selected);
    // Small delay to trigger enter animation
    requestAnimationFrame(() => setVisible(true));
  }, [pos, dismiss]);

  useEffect(() => {
    document.addEventListener('selectionchange', handleSelection);
    return () => document.removeEventListener('selectionchange', handleSelection);
  }, [handleSelection]);

  // Hide on scroll or click outside
  useEffect(() => {
    if (!pos) return;
    const hide = (e: Event) => {
      if (toolbarRef.current?.contains(e.target as Node)) return;
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) dismiss();
      }, 100);
    };
    const scrollEls = document.querySelectorAll('[data-chat-messages]');
    const scrollParents = new Set<Element>();
    scrollEls.forEach((el) => {
      const p = el.closest('.overflow-y-auto');
      if (p) scrollParents.add(p);
    });

    document.addEventListener('mousedown', hide);
    scrollParents.forEach((el) => el.addEventListener('scroll', dismiss));
    return () => {
      document.removeEventListener('mousedown', hide);
      scrollParents.forEach((el) => el.removeEventListener('scroll', dismiss));
    };
  }, [pos, dismiss]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const handleQuote = useCallback(() => {
    if (!text) return;
    window.dispatchEvent(new CustomEvent('deepthink:quote-text', { detail: text }));
    window.getSelection()?.removeAllRanges();
    dismiss();
  }, [text, dismiss]);

  if (!pos || !text) return null;

  return (
    <div
      ref={toolbarRef}
      className={cn(
        'fixed z-50 transition-all duration-150 ease-out',
        visible
          ? 'opacity-100 translate-y-0 scale-100'
          : 'opacity-0 translate-y-1 scale-95',
      )}
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        transform: `translate(-50%, -100%) ${visible ? 'scale(1)' : 'scale(0.95)'}`,
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {/* Tooltip arrow */}
      <div className="relative">
        <button
          onClick={handleQuote}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-lg',
            'bg-foreground text-background',
            'hover:bg-foreground/90 active:scale-95',
            'transition-all duration-100',
          )}
        >
          <Quote className="h-3 w-3" />
          Цитировать
        </button>
        <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 rotate-45 bg-foreground" />
      </div>
    </div>
  );
}
