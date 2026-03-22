import { useState, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { api } from '@/lib/api';
import type { ModelInfo } from '@/types';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';

export function ModelSelector() {
  const settings = useChatStore((s) => s.settings);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [showModels, setShowModels] = useState(false);

  useEffect(() => {
    api.listModels(settings.provider).then(setModels).catch(() => {});
  }, [settings.provider]);

  const currentModel = models.find((m) => m.id === settings.model);

  return (
    <div className="relative">
      <button
        onClick={() => setShowModels(!showModels)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-foreground hover:bg-accent"
      >
        <span className="font-medium">
          {currentModel?.name || settings.model.split('/').pop() || 'Select model'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {showModels && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowModels(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
            {models.map((model) => (
              <button
                key={model.id}
                onClick={() => {
                  updateSettings({ model: model.id });
                  setShowModels(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent',
                  settings.model === model.id && 'bg-accent',
                )}
              >
                <span>{model.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {(model.context / 1000).toFixed(0)}k ctx
                </span>
              </button>
            ))}
            {models.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                Сначала настройте API-ключ в Настройках
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
