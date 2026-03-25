import { create } from 'zustand';
import type { ThemeMode } from '@/types';

interface ThemeStore {
  mode: ThemeMode;
  toggle: () => void;
  setMode: (mode: ThemeMode) => void;
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

function applyThemeClass(mode: ThemeMode) {
  document.documentElement.classList.toggle('dark', mode === 'dark');
}

const initialMode = getSavedTheme();
applyThemeClass(initialMode);

export const useThemeStore = create<ThemeStore>((set) => ({
  mode: initialMode,

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
}));
