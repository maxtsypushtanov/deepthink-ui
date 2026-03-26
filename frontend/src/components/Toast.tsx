import { useToastStore, type ToastType } from '@/hooks/useToast';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON: Record<ToastType, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const STYLE: Record<ToastType, string> = {
  success: 'border-foreground/10 bg-card text-foreground/70',
  error: 'border-foreground/10 bg-card text-foreground/70',
  info: 'border-foreground/10 bg-card text-foreground/70',
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((t) => {
        const Icon = ICON[t.type];
        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 shadow-lg backdrop-blur-sm animate-slide-up',
              STYLE[t.type],
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="text-xs font-medium">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="ml-1 shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
