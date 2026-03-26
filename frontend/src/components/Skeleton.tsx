import { cn } from '@/lib/utils';

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-muted/60',
        className,
      )}
      style={style}
    />
  );
}

export function ChatListSkeleton() {
  return (
    <div className="space-y-1.5 px-2 py-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
          <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
          <Skeleton className="h-3 flex-1" style={{ maxWidth: `${60 + Math.random() * 40}%` }} />
        </div>
      ))}
    </div>
  );
}

export function CalendarSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
      </div>
      {/* Day headers */}
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
      {/* Time grid */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-2">
            <Skeleton className="h-4 w-10 shrink-0" />
            <Skeleton className="h-12 flex-1 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
