import { create } from 'zustand';
import type { ThemeMode } from '@/types';

interface ThemeStore {
  mode: ThemeMode;
  accentHue: number;
  toggle: () => void;
  setMode: (mode: ThemeMode) => void;
  setAccentHue: (hue: number) => void;
}

function getSavedTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage may be unavailable (e.g. in private browsing)
  }
  return 'dark';
}

function getSavedAccentHue(): number {
  try {
    const stored = localStorage.getItem('accent-hue');
    if (stored !== null) {
      const parsed = Number(stored);
      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 360) return parsed;
    }
  } catch {
    // ignore
  }
  return 0;
}

function applyThemeClass(mode: ThemeMode) {
  document.documentElement.classList.toggle('dark', mode === 'dark');
}

function applyAccentHue(hue: number) {
  if (hue > 0) {
    document.documentElement.style.setProperty('--accent-hue', String(hue));
  } else {
    document.documentElement.style.removeProperty('--accent-hue');
  }
}

const initialMode = getSavedTheme();
const initialAccentHue = getSavedAccentHue();
applyThemeClass(initialMode);
applyAccentHue(initialAccentHue);

export const useThemeStore = create<ThemeStore>((set) => ({
  mode: initialMode,
  accentHue: initialAccentHue,

  toggle: () =>
    set((s) => {
      const next = s.mode === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('theme', next); } catch { /* ignore */ }
      applyThemeClass(next);
      return { mode: next };
    }),

  setMode: (mode) => {
    try { localStorage.setItem('theme', mode); } catch { /* ignore */ }
    applyThemeClass(mode);
    set({ mode });
  },

  setAccentHue: (hue) => {
    const clamped = Math.max(0, Math.min(360, Math.round(hue)));
    try { localStorage.setItem('accent-hue', String(clamped)); } catch { /* ignore */ }
    applyAccentHue(clamped);
    set({ accentHue: clamped });
  },
}));
