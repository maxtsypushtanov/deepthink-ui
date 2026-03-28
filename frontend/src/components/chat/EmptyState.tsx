/**
 * EmptyState — product name, onboarding, and floating strategy cloud.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { Settings, Key, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getStrategy } from '@/lib/strategies';
import type { ReasoningStrategy } from '@/types';

interface StrategySuggestion {
  text: string;
  strategy: ReasoningStrategy;
  label: string;
}

const SUGGESTIONS: StrategySuggestion[] = [
  { text: 'Объясни квантовую запутанность просто', strategy: 'rubber_duck', label: 'Метод утёнка' },
  { text: 'Сравни REST и GraphQL для моего проекта', strategy: 'best_of_n', label: 'Сравнение вариантов' },
  { text: 'Как мыслить о сложных проблемах системно?', strategy: 'cot', label: 'Цепочка мыслей' },
  { text: 'Разбери мою идею с разных точек зрения', strategy: 'persona_council', label: 'Совет экспертов' },
  { text: 'Найди слабые места в моём бизнес-плане', strategy: 'tree_of_thoughts', label: 'Дерево мыслей' },
  { text: 'Проверь мой код на скрытые баги', strategy: 'rubber_duck', label: 'Объясни и исправь' },
  { text: 'Докажи или опровергни эту гипотезу', strategy: 'socratic', label: 'Метод Сократа' },
  { text: 'Глубоко проанализируй эту проблему', strategy: 'budget_forcing', label: 'Углублённый анализ' },
  { text: 'Что будет если автоматизировать найм?', strategy: 'persona_council', label: 'Совет экспертов' },
  { text: 'Пошагово реши эту математическую задачу', strategy: 'cot', label: 'Цепочка мыслей' },
  { text: 'Какой фреймворк выбрать для стартапа?', strategy: 'best_of_n', label: 'Сравнение вариантов' },
  { text: 'Оцени риски этого решения', strategy: 'tree_of_thoughts', label: 'Дерево мыслей' },
];

// Visible count at a time
const VISIBLE = 5;

export function EmptyState() {
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);

  useEffect(() => {
    api.getProviders()
      .then((providers) => setHasProvider(providers.length > 0))
      .catch(() => setHasProvider(false));
  }, []);

  return (
    <>
      <h1
        className="mb-2 text-center text-muted-foreground/60 select-none"
        style={{ fontSize: '24px', fontWeight: 300, letterSpacing: '-0.02em', fontFamily: "'Geist', system-ui, sans-serif" }}
      >
        DeepThink
      </h1>
      <p className="text-center text-[13px] text-muted-foreground/30 mb-6">
        Думай глубже. Решай точнее.
      </p>

      {hasProvider === false && (
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card/50 p-5 mb-6 animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <Key className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Начни за 2 минуты</span>
          </div>
          <ol className="space-y-2 text-[13px] text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-medium">1</span>
              <span>
                Получи бесплатный API-ключ на{' '}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-foreground/70 underline underline-offset-2 hover:text-foreground">
                  openrouter.ai <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-medium">2</span>
              <span>Вставь ключ в настройках</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-medium">3</span>
              <span>Задай вопрос — Нейрон сам выберет стратегию</span>
            </li>
          </ol>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('deepthink:open-settings'))}
            className="mt-4 flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm text-background hover:bg-foreground/90 transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            Открыть настройки
          </button>
        </div>
      )}
    </>
  );
}

function Chip({ s, fading, entering, onClick }: { s: StrategySuggestion; fading: boolean; entering: boolean; onClick: (t: string) => void }) {
  const strat = getStrategy(s.strategy);
  const Icon = strat.icon;
  return (
    <button
      onClick={() => onClick(s.text)}
      className={cn(
        'group rounded-full border border-border/30 px-3 py-1.5',
        'hover:border-border/60 hover:bg-card/50',
        'transition-all duration-700 ease-in-out',
        fading && 'opacity-0 scale-90 blur-[6px]',
        entering && 'animate-[chip-in_0.7s_ease-out_both]',
        !fading && !entering && 'opacity-100 scale-100 blur-0',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-muted-foreground/20 shrink-0" strokeWidth={1.5} />
        <span className="text-[12px] text-muted-foreground/35 group-hover:text-muted-foreground/70 transition-colors whitespace-nowrap">
          {s.text.length > 28 ? s.text.slice(0, 28) + '…' : s.text}
        </span>
      </div>
    </button>
  );
}

/**
 * StrategyCloud — floating, drifting suggestion chips.
 * Each chip shows a sample query + which strategy it triggers.
 * Chips rotate every few seconds with crossfade animation.
 */
export function SuggestionChips() {
  const [visibleIndices, setVisibleIndices] = useState<number[]>(() => {
    // Pick initial random set
    const indices = Array.from({ length: SUGGESTIONS.length }, (_, i) => i);
    const shuffled = indices.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, VISIBLE);
  });
  const [fadingOut, setFadingOut] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const [fadingIn, setFadingIn] = useState<number | null>(null);

  // Rotate one chip every 4 seconds with smooth 3-phase transition
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const allIndices = Array.from({ length: SUGGESTIONS.length }, (_, i) => i);
      const current = visibleIndices;
      const available = allIndices.filter((i) => !current.includes(i));
      if (available.length === 0) return;

      const slotToReplace = Math.floor(Math.random() * current.length);
      const newIdx = available[Math.floor(Math.random() * available.length)];

      // Phase 1: fade out (600ms)
      setFadingOut(slotToReplace);

      // Phase 2: swap content (invisible moment)
      setTimeout(() => {
        setVisibleIndices((prev) => {
          const updated = [...prev];
          updated[slotToReplace] = newIdx;
          return updated;
        });
        setFadingOut(null);
        // Phase 3: fade in (600ms)
        setFadingIn(slotToReplace);
        setTimeout(() => setFadingIn(null), 600);
      }, 700);
    }, 4000);

    return () => clearInterval(intervalRef.current);
  }, [visibleIndices]);

  const handleClick = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent('deepthink:edit-message', { detail: text }));
  }, []);

  return (
    <div className="mt-5 space-y-2 mx-auto max-w-lg">
      {/* Row 1: 3 chips */}
      <div className="flex justify-center gap-2">
        {visibleIndices.slice(0, 3).map((suggIdx, slot) =>
          <Chip key={`${slot}-${suggIdx}`} s={SUGGESTIONS[suggIdx]} fading={fadingOut === slot} entering={fadingIn === slot} onClick={handleClick} />
        )}
      </div>
      {/* Row 2: 2 chips */}
      <div className="flex justify-center gap-2">
        {visibleIndices.slice(3, 5).map((suggIdx, slot) =>
          <Chip key={`${slot + 3}-${suggIdx}`} s={SUGGESTIONS[suggIdx]} fading={fadingOut === slot + 3} entering={fadingIn === slot + 3} onClick={handleClick} />
        )}
      </div>
    </div>
  );
}
