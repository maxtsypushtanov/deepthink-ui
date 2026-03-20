import { useState, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { api } from '@/lib/api';
import type { ProviderSettings } from '@/types';
import { cn } from '@/lib/utils';
import { X, Key, Globe, Check, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PROVIDER_META: Record<string, { label: string; description: string; defaultUrl: string }> = {
  openrouter: {
    label: 'OpenRouter',
    description: 'Access to 200+ models via single API key',
    defaultUrl: 'https://openrouter.ai/api/v1',
  },
  deepseek: {
    label: 'DeepSeek',
    description: 'DeepSeek V3 and R1 with native reasoning',
    defaultUrl: 'https://api.deepseek.com',
  },
  cloudru: {
    label: 'Cloud.ru',
    description: 'Foundation Models on Russian servers',
    defaultUrl: 'https://api.cloud.ru/v1',
  },
  custom: {
    label: 'Custom Endpoint',
    description: 'Any OpenAI-compatible API',
    defaultUrl: 'http://localhost:11434/v1',
  },
};

type Tab = 'providers' | 'reasoning';

export function SettingsDialog({ open, onOpenChange }: Props) {
  const settings = useChatStore((s) => s.settings);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const [tab, setTab] = useState<Tab>('providers');
  const [providers, setProviders] = useState<ProviderSettings[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      api.getProviders().then(setProviders).catch(() => {});
    }
  }, [open]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Settings</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {(['providers', 'reasoning'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-5 py-2.5 text-sm font-medium transition-colors',
                tab === t
                  ? 'border-b-2 border-foreground text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t === 'providers' ? 'Providers' : 'Reasoning'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {tab === 'providers' && (
            <div className="space-y-4">
              {Object.entries(PROVIDER_META).map(([key, meta]) => {
                const existing = providers.find((p) => p.provider === key);
                return (
                  <div key={key} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold">{meta.label}</h3>
                        <p className="text-xs text-muted-foreground">{meta.description}</p>
                      </div>
                      {existing && (
                        <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
                          <Check className="h-3 w-3" /> Connected
                        </span>
                      )}
                    </div>

                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Key className="h-3.5 w-3.5 text-muted-foreground" />
                        <input
                          type="password"
                          placeholder={existing?.api_key_preview || 'API Key'}
                          value={keys[key] || ''}
                          onChange={(e) => setKeys((k) => ({ ...k, [key]: e.target.value }))}
                          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                      {key === 'custom' && (
                        <div className="flex items-center gap-2">
                          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                          <input
                            type="text"
                            placeholder={meta.defaultUrl}
                            value={urls[key] || ''}
                            onChange={(e) => setUrls((u) => ({ ...u, [key]: e.target.value }))}
                            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>
                      )}
                      <button
                        onClick={() => saveProvider(key)}
                        disabled={!keys[key] || saving === key}
                        className={cn(
                          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                          keys[key]
                            ? 'bg-foreground text-background hover:bg-foreground/90'
                            : 'bg-muted text-muted-foreground cursor-not-allowed',
                        )}
                      >
                        {saving === key ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        Save
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'reasoning' && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Temperature</label>
                <p className="text-xs text-muted-foreground mb-2">Controls randomness (0 = deterministic, 1 = creative)</p>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={settings.temperature}
                  onChange={(e) => updateSettings({ temperature: parseFloat(e.target.value) })}
                  className="w-full accent-foreground"
                />
                <span className="text-xs text-muted-foreground">{settings.temperature}</span>
              </div>

              <div>
                <label className="text-sm font-medium">Budget Forcing Rounds</label>
                <p className="text-xs text-muted-foreground mb-2">How many times to force the model to continue thinking</p>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={settings.budgetRounds}
                  onChange={(e) => updateSettings({ budgetRounds: parseInt(e.target.value) })}
                  className="w-full accent-foreground"
                />
                <span className="text-xs text-muted-foreground">{settings.budgetRounds}</span>
              </div>

              <div>
                <label className="text-sm font-medium">Best-of-N Candidates</label>
                <p className="text-xs text-muted-foreground mb-2">Number of parallel answers to generate</p>
                <input
                  type="range"
                  min="2"
                  max="7"
                  value={settings.bestOfN}
                  onChange={(e) => updateSettings({ bestOfN: parseInt(e.target.value) })}
                  className="w-full accent-foreground"
                />
                <span className="text-xs text-muted-foreground">{settings.bestOfN}</span>
              </div>

              <div>
                <label className="text-sm font-medium">Tree Breadth</label>
                <p className="text-xs text-muted-foreground mb-2">Branches per level in Tree of Thoughts</p>
                <input
                  type="range"
                  min="2"
                  max="5"
                  value={settings.treeBreadth}
                  onChange={(e) => updateSettings({ treeBreadth: parseInt(e.target.value) })}
                  className="w-full accent-foreground"
                />
                <span className="text-xs text-muted-foreground">{settings.treeBreadth}</span>
              </div>

              <div>
                <label className="text-sm font-medium">Tree Depth</label>
                <p className="text-xs text-muted-foreground mb-2">Depth levels in Tree of Thoughts</p>
                <input
                  type="range"
                  min="1"
                  max="4"
                  value={settings.treeDepth}
                  onChange={(e) => updateSettings({ treeDepth: parseInt(e.target.value) })}
                  className="w-full accent-foreground"
                />
                <span className="text-xs text-muted-foreground">{settings.treeDepth}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
