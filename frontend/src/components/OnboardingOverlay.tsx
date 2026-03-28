import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Key, ExternalLink, Loader2, Check, Sparkles } from 'lucide-react';

interface Props {
  onComplete: () => void;
}

export function OnboardingOverlay({ onComplete }: Props) {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const save = async () => {
    if (!key.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.saveProvider({
        provider: 'openrouter',
        api_key: key.trim(),
        base_url: '',
        enabled: true,
      });
      setDone(true);
      setTimeout(onComplete, 600);
    } catch {
      setError('Не удалось сохранить ключ. Проверь соединение.');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && key.trim() && !saving) save();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
      <div
        className={`w-full max-w-md mx-4 transition-all duration-500 ${
          done ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
        }`}
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-foreground/5 border border-border mb-4">
            <Sparkles className="h-7 w-7 text-foreground/60" />
          </div>
          <h1
            className="text-2xl text-foreground/80 mb-1"
            style={{ fontWeight: 300, letterSpacing: '-0.02em' }}
          >
            DeepThink
          </h1>
          <p className="text-sm text-muted-foreground/50">
            Думай глубже. Решай точнее.
          </p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border bg-card/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Key className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Подключи OpenRouter</span>
          </div>

          <p className="text-[13px] text-muted-foreground/70 mb-4">
            Нейрон использует{' '}
            <a
              href="https://openrouter.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground/70 underline underline-offset-2 hover:text-foreground"
            >
              OpenRouter
            </a>{' '}
            для доступа к 200+ моделям. Зарегистрируйся и получи бесплатный API-ключ.
          </p>

          {/* Steps */}
          <ol className="space-y-2 text-[13px] text-muted-foreground/60 mb-5">
            <li className="flex items-start gap-2">
              <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                1
              </span>
              <span>
                Перейди на{' '}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-foreground/70 underline underline-offset-2 hover:text-foreground"
                >
                  openrouter.ai/keys <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                2
              </span>
              <span>Создай ключ и вставь его ниже</span>
            </li>
          </ol>

          {/* Input */}
          <div className="flex gap-2">
            <input
              type="password"
              placeholder="sk-or-v1-..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground/30"
            />
            <button
              onClick={save}
              disabled={!key.trim() || saving}
              className={`flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-medium transition-all ${
                key.trim()
                  ? 'bg-foreground text-background hover:bg-foreground/90 shadow-sm'
                  : 'bg-muted text-muted-foreground/50 cursor-not-allowed'
              }`}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : done ? (
                <Check className="h-4 w-4" />
              ) : null}
              {done ? 'Готово' : 'Начать'}
            </button>
          </div>

          {error && (
            <p className="mt-2 text-xs text-red-400">{error}</p>
          )}
        </div>

        <p className="text-center text-[11px] text-muted-foreground/30 mt-4">
          Ключ хранится локально и никуда не отправляется кроме OpenRouter API
        </p>
      </div>
    </div>
  );
}
