import { useState } from 'react';
import { api } from '@/lib/api';
import {
  Key,
  ExternalLink,
  Loader2,
  Check,
  Sparkles,
  Brain,
  Search,
  Image,
  FileText,
  PanelRight,
  Network,
  ArrowRight,
  User,
} from 'lucide-react';

interface Props {
  onComplete: () => void;
}

const TOUR_ITEMS = [
  { icon: Brain, title: 'Стратегии мышления', desc: 'Cmd+K \u2192 выбери стратегию: цепочка мыслей, совет экспертов, ТРИЗ...' },
  { icon: Search, title: 'Веб-поиск', desc: 'Нейрон сам ищет актуальную информацию когда нужно' },
  { icon: Image, title: 'Генерация изображений', desc: '\u00ABНарисуй...\u00BB \u2014 и Нейрон создаст картинку' },
  { icon: FileText, title: 'Анализ файлов', desc: 'Перетащи файл в чат \u2014 PDF, DOCX, XLSX, код' },
  { icon: PanelRight, title: 'Артефакты', desc: 'Cmd+E \u2014 код и диаграммы в отдельной панели' },
  { icon: Network, title: 'Пространство мышления', desc: 'Cmd+Shift+K \u2014 визуальная карта идей и связей' },
];

export function OnboardingOverlay({ onComplete }: Props) {
  const [step, setStep] = useState(0); // 0=API key, 1=Tour, 2=Name
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [userName, setUserName] = useState('');

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
      setStep(1);
    } catch {
      setError('Не удалось сохранить ключ. Проверь соединение.');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && key.trim() && !saving) save();
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') finish();
  };

  const finish = () => {
    if (userName.trim()) {
      localStorage.setItem('deepthink-user-name', userName.trim());
    }
    setDone(true);
    setTimeout(onComplete, 500);
  };

  const skip = () => {
    setDone(true);
    setTimeout(onComplete, 500);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
      <div
        className={`w-full max-w-lg mx-4 transition-all duration-500 ${
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

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[0, 1, 2].map((s) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                s === step ? 'w-6 bg-foreground/60' : s < step ? 'w-3 bg-foreground/30' : 'w-3 bg-foreground/10'
              }`}
            />
          ))}
        </div>

        {/* Step 0: API Key */}
        {step === 0 && (
          <div className="rounded-xl border border-border bg-card/50 p-6 animate-fade-in">
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
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                Далее
              </button>
            </div>

            {error && (
              <p className="mt-2 text-xs text-red-400">{error}</p>
            )}

            <p className="text-center text-[11px] text-muted-foreground/30 mt-4">
              Ключ хранится локально и никуда не отправляется кроме OpenRouter API
            </p>
          </div>
        )}

        {/* Step 1: Quick Tour */}
        {step === 1 && (
          <div className="rounded-xl border border-border bg-card/50 p-6 animate-fade-in">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Что умеет Нейрон</span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              {TOUR_ITEMS.map((item) => (
                <div
                  key={item.title}
                  className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-background/50 p-3"
                >
                  <item.icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground/80 leading-tight">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5 leading-snug">
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setStep(2)}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-foreground text-background px-5 py-2.5 text-sm font-medium hover:bg-foreground/90 shadow-sm transition-all"
            >
              <ArrowRight className="h-4 w-4" />
              Далее
            </button>
          </div>
        )}

        {/* Step 2: Name */}
        {step === 2 && (
          <div className="rounded-xl border border-border bg-card/50 p-6 animate-fade-in">
            <div className="flex items-center gap-2 mb-4">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Знакомство</span>
            </div>

            <p className="text-[13px] text-muted-foreground/70 mb-4">
              Как тебя зовут? Так Нейрону будет удобнее общаться.
            </p>

            <input
              type="text"
              placeholder="Имя (необязательно)"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              onKeyDown={handleNameKeyDown}
              autoFocus
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground/30 mb-4"
            />

            <button
              onClick={finish}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-foreground text-background px-5 py-2.5 text-sm font-medium hover:bg-foreground/90 shadow-sm transition-all"
            >
              <Check className="h-4 w-4" />
              Начать
            </button>
          </div>
        )}

        {/* Skip button */}
        <button
          onClick={skip}
          className="block mx-auto mt-4 text-[12px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
        >
          Пропустить
        </button>
      </div>
    </div>
  );
}
