import { useState } from 'react';
import { usePipelineStore } from '@/stores/pipelineStore';
import { cn } from '@/lib/utils';
import { Play, Square, RotateCcw, AlertCircle } from 'lucide-react';
import { GroundedTree } from './GroundedTree';
import { PRBadge } from './PRBadge';

export function PipelineView() {
  const status = usePipelineStore((s) => s.status);
  const context = usePipelineStore((s) => s.context);
  const events = usePipelineStore((s) => s.events);
  const error = usePipelineStore((s) => s.error);
  const startPipeline = usePipelineStore((s) => s.startPipeline);
  const stopPipeline = usePipelineStore((s) => s.stopPipeline);
  const reset = usePipelineStore((s) => s.reset);

  if (status === 'idle') {
    return <IdleForm onStart={startPipeline} />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Пайплайн</h2>
        {context && (
          <span className="text-xs text-muted-foreground truncate max-w-md">
            {context.task}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {status === 'running' && (
            <button
              onClick={stopPipeline}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
            >
              <Square className="h-3 w-3" />
              Стоп
            </button>
          )}
          {(status === 'done' || status === 'error') && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
            >
              <RotateCcw className="h-3 w-3" />
              Новый запуск
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* PR badge */}
      {context?.pull_request_url && (
        <div className="px-4 pt-3">
          <PRBadge url={context.pull_request_url} />
        </div>
      )}

      {/* Grounded Tree visualization */}
      <GroundedTree
        events={events}
        context={context}
        pipelineDone={status === 'done' || status === 'error'}
        task={context?.task || ''}
      />
    </div>
  );
}

function IdleForm({ onStart }: { onStart: (task: string, repo: string, max?: number) => Promise<void> }) {
  const [task, setTask] = useState('');
  const [repo, setRepo] = useState('');
  const [maxIterations, setMaxIterations] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = task.trim().length > 0 && repo.trim().includes('/') && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onStart(task.trim(), repo.trim(), maxIterations);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg space-y-5 rounded-xl border border-border bg-card p-6"
      >
        <div>
          <h2 className="text-lg font-semibold">Запустить пайплайн</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Мульти-агентный цикл: Архитектор, Разработчик, Тестировщик, Оркестратор
          </p>
        </div>

        {/* Task */}
        <div className="space-y-1.5">
          <label htmlFor="pipeline-task" className="text-xs font-medium text-muted-foreground">
            Описание задачи
          </label>
          <textarea
            id="pipeline-task"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Добавь OAuth2 авторизацию через GitHub..."
            rows={3}
            className={cn(
              'w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm',
              'placeholder:text-muted-foreground/50',
              'focus:outline-none focus:ring-2 focus:ring-ring/30',
            )}
          />
        </div>

        {/* Repo */}
        <div className="space-y-1.5">
          <label htmlFor="pipeline-repo" className="text-xs font-medium text-muted-foreground">
            GitHub Репозиторий
          </label>
          <input
            id="pipeline-repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo"
            className={cn(
              'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono',
              'placeholder:text-muted-foreground/50',
              'focus:outline-none focus:ring-2 focus:ring-ring/30',
            )}
          />
        </div>

        {/* Max iterations */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="pipeline-iters" className="text-xs font-medium text-muted-foreground">
              Макс. итераций
            </label>
            <span className="text-xs font-mono text-muted-foreground">{maxIterations}</span>
          </div>
          <input
            id="pipeline-iters"
            type="range"
            min={1}
            max={10}
            value={maxIterations}
            onChange={(e) => setMaxIterations(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
            canSubmit
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          <Play className="h-4 w-4" />
          {submitting ? 'Запуск...' : 'Запустить'}
        </button>
      </form>
    </div>
  );
}
