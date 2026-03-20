import { useState, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { api } from '@/lib/api';
import type { ModelInfo, ReasoningStrategy } from '@/types';
import { cn } from '@/lib/utils';
import { ChevronDown, Brain, Sparkles, GitBranch, Target, TreePine, Zap } from 'lucide-react';

const STRATEGIES: { value: ReasoningStrategy; label: string; icon: React.ComponentType<any>; color: string }[] = [
  { value: 'auto', label: 'Auto', icon: Zap, color: 'text-yellow-400' },
  { value: 'none', label: 'None', icon: Target, color: 'text-muted-foreground' },
  { value: 'cot', label: 'CoT', icon: Brain, color: 'text-blue-400' },
  { value: 'budget_forcing', label: 'Budget', icon: Sparkles, color: 'text-purple-400' },
  { value: 'best_of_n', label: 'Best-of-N', icon: GitBranch, color: 'text-green-400' },
  { value: 'tree_of_thoughts', label: 'Tree', icon: TreePine, color: 'text-orange-400' },
];

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
    <div className="flex items-center gap-3">
      {/* Model dropdown */}
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
                  Configure API key in Settings first
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Strategy selector */}
      <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
        {STRATEGIES.map(({ value, label, icon: Icon, color }) => (
          <button
            key={value}
            onClick={() => updateSettings({ strategy: value })}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
              settings.strategy === value
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title={label}
          >
            <Icon className={cn('h-3 w-3', settings.strategy === value && color)} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
