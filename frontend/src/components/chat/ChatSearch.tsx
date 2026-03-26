import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { cn } from '@/lib/utils';

export function ChatSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<number[]>([]);
  const [current, setCurrent] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const messages = useChatStore((s) => s.messages);

  // Cmd+Shift+F to open
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery('');
      setMatches([]);
      clearHighlights();
    }
  }, [open]);

  // Search logic
  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      clearHighlights();
      return;
    }

    const q = query.toLowerCase();
    const found: number[] = [];
    messages.forEach((msg, i) => {
      if (msg.content.toLowerCase().includes(q)) {
        found.push(i);
      }
    });
    setMatches(found);
    setCurrent(0);

    // Highlight matches in DOM
    highlightInDom(q);

    if (found.length > 0) {
      scrollToMatch(found[0]);
    }
  }, [query, messages]);

  const clearHighlights = () => {
    document.querySelectorAll('[data-chat-messages] mark.search-hl').forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        parent.normalize();
      }
    });
  };

  const highlightInDom = (q: string) => {
    clearHighlights();
    if (!q) return;
    const container = document.querySelector('[data-chat-messages]');
    if (!container) return;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node.textContent && node.textContent.toLowerCase().includes(q)) {
        textNodes.push(node);
      }
    }

    for (const tn of textNodes) {
      const text = tn.textContent || '';
      const lower = text.toLowerCase();
      const idx = lower.indexOf(q);
      if (idx === -1) continue;

      const before = text.slice(0, idx);
      const match = text.slice(idx, idx + q.length);
      const after = text.slice(idx + q.length);

      const mark = document.createElement('mark');
      mark.className = 'search-hl bg-foreground/15 text-foreground rounded-sm px-0.5';
      mark.textContent = match;

      const frag = document.createDocumentFragment();
      if (before) frag.appendChild(document.createTextNode(before));
      frag.appendChild(mark);
      if (after) frag.appendChild(document.createTextNode(after));

      tn.parentNode?.replaceChild(frag, tn);
    }
  };

  const scrollToMatch = (idx: number) => {
    const container = document.querySelector('[data-chat-messages]');
    if (!container) return;
    const children = container.children;
    if (idx < children.length) {
      children[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const goNext = useCallback(() => {
    if (matches.length === 0) return;
    const next = (current + 1) % matches.length;
    setCurrent(next);
    scrollToMatch(matches[next]);
  }, [current, matches]);

  const goPrev = useCallback(() => {
    if (matches.length === 0) return;
    const prev = (current - 1 + matches.length) % matches.length;
    setCurrent(prev);
    scrollToMatch(matches[prev]);
  }, [current, matches]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Enter' && e.shiftKey) {
      goPrev();
    } else if (e.key === 'Enter') {
      goNext();
    }
  };

  if (!open) return null;

  return (
    <div className="absolute top-12 right-4 z-20 animate-fade-in-scale">
      <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 shadow-lg">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Поиск в чате..."
          className="w-48 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
        />
        {matches.length > 0 && (
          <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
            {current + 1}/{matches.length}
          </span>
        )}
        <div className="flex items-center gap-0.5">
          <button onClick={goPrev} className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Предыдущий">
            <ChevronUp className="h-3 w-3" />
          </button>
          <button onClick={goNext} className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Следующий">
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
        <button onClick={() => setOpen(false)} className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Закрыть поиск">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
