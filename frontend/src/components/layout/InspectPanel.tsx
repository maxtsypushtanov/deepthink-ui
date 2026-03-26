import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CompactCalendarList } from '@/components/Calendar/CompactCalendarList';

export type InspectMode = 'reasoning' | 'calendar' | 'metadata';

interface Props {
  open: boolean;
  mode: InspectMode;
  onClose: () => void;
  children?: React.ReactNode;
}

const MODE_LABELS: Record<InspectMode, string> = {
  reasoning: 'Рассуждения',
  calendar: 'Календарь',
  metadata: 'Информация',
};

const ANIM_MS = 250;

export function InspectPanel({ open, mode, onClose, children }: Props) {
  // Track mounted vs visible for exit animation
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Trigger enter animation on next frame
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      // Trigger exit animation
      setVisible(false);
      const timer = setTimeout(() => setMounted(false), ANIM_MS);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mounted, onClose]);

  if (!mounted) return null;

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-30 bg-black/20 backdrop-blur-[1px] xl:hidden transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />

      <aside
        className={cn(
          'flex flex-col border-l border-border bg-card overflow-hidden shrink-0 z-40',
          'fixed right-0 top-0 bottom-0 w-[400px] xl:relative xl:w-[400px]',
          'transition-transform ease-out',
          visible ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ transitionDuration: `${ANIM_MS}ms` }}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-[13px] font-medium text-muted-foreground">
            {MODE_LABELS[mode]}
          </span>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {mode === 'calendar' && <CompactCalendarList />}
          {mode === 'reasoning' && (
            children || (
              <div className="flex h-full items-center justify-center p-6">
                <p className="text-sm text-muted-foreground/30 text-center">
                  Нажмите на полоску уверенности для просмотра рассуждений
                </p>
              </div>
            )
          )}
          {mode === 'metadata' && (
            children || (
              <div className="flex h-full items-center justify-center p-6">
                <p className="text-sm text-muted-foreground/30 text-center">
                  Метаданные диалога
                </p>
              </div>
            )
          )}
        </div>
      </aside>
    </>
  );
}
