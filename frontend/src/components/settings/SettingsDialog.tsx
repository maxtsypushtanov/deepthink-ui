import { useState, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { api } from '@/lib/api';
import type { ProviderSettings, ModelInfo } from '@/types';
import { cn } from '@/lib/utils';
import { X, Key, Globe, Check, Loader2, Search } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PROVIDER_META: Record<string, { label: string; description: string; defaultUrl: string }> = {
  openrouter: {
    label: 'OpenRouter',
    description: 'Доступ к 200+ моделям (GPT-4o, Claude, Llama, Gemini и др.)',
    defaultUrl: 'https://openrouter.ai/api/v1',
  },
  custom: {
    label: 'API эндпоинт',
    description: 'OpenAI-совместимый API (Cloud.ru Foundation Models)',
    defaultUrl: 'https://foundation-models.api.cloud.ru/v1',
  },
};

type Tab = 'providers' | 'model' | 'reasoning';

export function SettingsDialog({ open, onOpenChange }: Props) {
  const settings = useChatStore((s) => s.settings);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const [tab, setTab] = useState<Tab>('providers');
  const [providers, setProviders] = useState<ProviderSettings[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelFilter, setModelFilter] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.getProviders().then((p) => { if (!cancelled) setProviders(p); }).catch(() => {});
    api.listModels(settings.provider).then((m) => { if (!cancelled) setModels(m); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, settings.provider]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onOpenChange]);

  const saveProvider = async (provider: string) => {
    setSaving(provider);
    try {
      await api.saveProvider({
        provider,
        api_key: keys[provider] || '',
        base_url: urls[provider] || PROVIDER_META[provider]?.defaultUrl || '',
        enabled: true,
      });
      const updated = await api.getProviders();
      setProviders(updated);
      setKeys((k) => ({ ...k, [provider]: '' }));
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Настройки"
        className="relative z-10 w-full max-w-lg mx-4 rounded-xl border border-border bg-card shadow-2xl animate-fade-in-scale"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Настройки</h2>
          <button
            onClick={() => onOpenChange(false)}
            aria-label="Закрыть настройки"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border px-4">
          {(['providers', 'model', 'reasoning'] as Tab[]).map((t) => {
            const labels: Record<Tab, string> = { providers: 'Провайдеры', model: 'Модель', reasoning: 'Рассуждение' };
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'relative px-4 py-2.5 text-sm font-medium transition-colors rounded-t-md',
                  tab === t
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {labels[t]}
                {tab === t && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto scroll-shadow px-5 py-4">
          {tab === 'providers' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border p-3">
                <label className="text-sm font-medium">Активный провайдер</label>
                <select
                  value={settings.provider}
                  onChange={(e) => updateSettings({ provider: e.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                >
                  {Object.entries(PROVIDER_META).map(([key, meta]) => (
                    <option key={key} value={key}>{meta.label}</option>
                  ))}
                </select>
              </div>
              {Object.entries(PROVIDER_META).map(([key, meta]) => {
                const existing = providers.find((p) => p.provider === key);
                return (
                  <div key={key} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold">{meta.label}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{meta.description}</p>
                      </div>
                      {existing && (
                        <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
                          <Check className="h-3 w-3" /> Подключён
                        </span>
                      )}
                    </div>

                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <input
                          type="password"
                          placeholder={existing?.api_key_preview || 'API Key'}
                          value={keys[key] || ''}
                          onChange={(e) => setKeys((k) => ({ ...k, [key]: e.target.value }))}
                          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                        />
                      </div>
                      {key === 'custom' && (
                        <div className="flex items-center gap-2">
                          <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <input
                            type="text"
                            placeholder={meta.defaultUrl}
                            value={urls[key] || ''}
                            onChange={(e) => setUrls((u) => ({ ...u, [key]: e.target.value }))}
                            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                          />
                        </div>
                      )}
                      <button
                        onClick={() => saveProvider(key)}
                        disabled={!keys[key] || saving === key}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-all',
                          keys[key]
                            ? 'bg-foreground text-background hover:bg-foreground/90 shadow-sm'
                            : 'bg-muted text-muted-foreground/50 cursor-not-allowed',
                        )}
                      >
                        {saving === key ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        Сохранить
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'model' && (
            <div className="space-y-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                <input
                  type="text"
                  placeholder="Поиск модели..."
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                />
              </div>

              {/* Model list */}
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="max-h-[40vh] overflow-y-auto scroll-shadow divide-y divide-border">
                  {models
                    .filter((m) => {
                      if (!modelFilter) return true;
                      const q = modelFilter.toLowerCase();
                      return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
                    })
                    .map((model) => (
                      <button
                        key={model.id}
                        onClick={() => updateSettings({ model: model.id })}
                        className={cn(
                          'flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent',
                          settings.model === model.id && 'bg-accent',
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {settings.model === model.id && (
                            <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                          )}
                          <span className={cn('truncate', settings.model === model.id && 'font-medium')}>
                            {model.name}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground/60 shrink-0 ml-2 tabular-nums">
                          {(model.context / 1000).toFixed(0)}k
                        </span>
                      </button>
                    ))}
                </div>
                {models.length === 0 && (
                  <div className="px-3 py-6 text-center">
                    <p className="text-xs text-muted-foreground">
                      Настройте API-ключ провайдера для загрузки моделей
                    </p>
                  </div>
                )}
              </div>

              <p className="text-[10px] text-muted-foreground/50 px-1">
                Текущая: {settings.model}
              </p>
            </div>
          )}

          {tab === 'reasoning' && (
            <div className="space-y-5">
              <RangeControl
                label="Температура"
                description="Управляет случайностью (0 = точный, 1 = творческий)"
                min={0} max={1} step={0.1}
                value={settings.temperature}
                onChange={(v) => updateSettings({ temperature: v })}
                format={(v) => v.toFixed(1)}
              />
              <RangeControl
                label="Раунды углублённого анализа"
                description="Сколько раз модель продолжит размышлять"
                min={1} max={10} step={1}
                value={settings.budgetRounds}
                onChange={(v) => updateSettings({ budgetRounds: v })}
              />
              <RangeControl
                label="Кандидатов Best-of-N"
                description="Количество параллельных ответов"
                min={2} max={7} step={1}
                value={settings.bestOfN}
                onChange={(v) => updateSettings({ bestOfN: v })}
              />
              <RangeControl
                label="Ширина дерева"
                description="Ветвей на уровень в Дереве мыслей"
                min={2} max={5} step={1}
                value={settings.treeBreadth}
                onChange={(v) => updateSettings({ treeBreadth: v })}
              />
              <RangeControl
                label="Глубина дерева"
                description="Уровней глубины в Дереве мыслей"
                min={1} max={4} step={1}
                value={settings.treeDepth}
                onChange={(v) => updateSettings({ treeDepth: v })}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RangeControl({
  label,
  description,
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-sm font-mono text-foreground tabular-nums">
          {format ? format(value) : value}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-2.5">{description}</p>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-foreground h-1.5 cursor-pointer"
      />
    </div>
  );
}
