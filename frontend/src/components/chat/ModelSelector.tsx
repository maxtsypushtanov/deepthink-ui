import { useState, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { api } from '@/lib/api';
import type { ModelInfo } from '@/types';
import { cn } from '@/lib/utils';
import { ChevronDown, Settings } from 'lucide-react';

export function ModelSelector() {
  const settings = useChatStore((s) => s.settings);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [showModels, setShowModels] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.listModels(settings.provider).then((m) => { if (!cancelled) setModels(m); }).catch(() => {});
    return () => { cancelled = true; };
  }, [settings.provider]);

  const currentModel = models.find((m) => m.id === settings.model);

  return (
    <div className="relative">
      <button
        onClick={() => setShowModels(!showModels)}
        aria-expanded={showModels}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-foreground hover:bg-accent transition-colors"
      >
        <span className="font-medium truncate max-w-[180px]">
          {currentModel?.name || settings.model.split('/').pop() || 'Выбор модели'}
        </span>
        {models.length === 0 && (
          <span className="relative flex h-2 w-2" title="API-ключ не настроен">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
          </span>
        )}
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', showModels && 'rotate-180')} />
      </button>

      {showModels && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowModels(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-border bg-card shadow-xl animate-fade-in-scale overflow-hidden">
            <div className="max-h-64 overflow-y-auto scroll-shadow" role="listbox">
              {models.map((model) => (
                <button
                  key={model.id}
                  role="option"
                  aria-selected={settings.model === model.id}
                  onClick={() => {
                    updateSettings({ model: model.id });
                    setShowModels(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent',
                    settings.model === model.id && 'bg-accent font-medium',
                  )}
                >
                  <span className="truncate">{model.name}</span>
                  <span className="text-[10px] text-muted-foreground/60 shrink-0 ml-2 tabular-nums">
                    {(model.context / 1000).toFixed(0)}k
                  </span>
                </button>
              ))}
            </div>
            {models.length === 0 && (
              <div className="px-3 py-4 text-center">
                <Settings className="h-4 w-4 mx-auto mb-1.5 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">
                  Настройте API-ключ
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
