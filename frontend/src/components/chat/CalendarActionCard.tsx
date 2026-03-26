import { useState } from 'react';
import { Calendar, Check, Pencil, Loader2 } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { cn } from '@/lib/utils';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      weekday: 'short', day: 'numeric', month: 'long',
    });
  } catch { return iso; }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', {
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

/**
 * Inline calendar action card rendered in the chat stream.
 * Shows event details with Confirm/Edit buttons.
 * After confirm → "Added to calendar" with checkmark.
 */
export function CalendarActionCard() {
  const draft = useChatStore((s) => s.calendarDraft);
  const confirm = useChatStore((s) => s.confirmCalendarDraft);
  const dismiss = useChatStore((s) => s.dismissCalendarDraft);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  if (!draft) return null;

  const action: string = draft.calendar_action || 'create';
  const isDelete = action === 'delete';
  const isUpdate = action === 'update';
  const title = draft.title || draft._event_title || 'Event';
  const startTime = draft.start_time || draft._event_start || '';
  const endTime = draft.end_time || draft._event_end || '';

  const handleConfirm = async () => {
    setConfirming(true);
    await confirm();
    setConfirmed(true);
    setConfirming(false);
  };

  const handleEdit = () => {
    // Open inspect panel with calendar
    window.dispatchEvent(new CustomEvent('deepthink:open-inspect', { detail: 'calendar' }));
  };

  if (confirmed) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 max-w-sm my-2 animate-fade-in">
        <div className="flex items-center gap-2 text-sm text-foreground/60">
          <Check className="w-4 h-4" />
          <span>{isDelete ? 'Удалено из календаря' : isUpdate ? 'Обновлено в календаре' : 'Добавлено в календарь'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 max-w-sm my-2 animate-slide-up">
      <div className="flex items-center gap-2 mb-2">
        <Calendar className="w-4 h-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title}</span>
      </div>
      {(startTime || endTime) && (
        <div className="text-sm text-muted-foreground mb-4">
          {startTime && formatDate(startTime)} · {startTime && formatTime(startTime)}
          {endTime && ` – ${formatTime(endTime)}`}
        </div>
      )}
      {draft.description && (
        <p className="text-xs text-muted-foreground/60 italic mb-3">{draft.description}</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={handleConfirm}
          disabled={confirming}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            'bg-foreground text-background hover:bg-foreground/90',
            confirming && 'opacity-50 pointer-events-none',
          )}
        >
          {confirming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {isDelete ? 'Удалить' : 'Подтвердить'}
        </button>
        <button
          onClick={isDelete ? dismiss : handleEdit}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03] transition-colors"
        >
          {isDelete ? 'Отмена' : <><Pencil className="h-3 w-3" /> Изменить</>}
        </button>
      </div>
    </div>
  );
}
