import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { CascadeTheme } from '../themes/types';
import { PRESET_THEMES, DEFAULT_THEME, applyTheme, importVSCodeTheme } from '../themes/index';

const STORAGE_KEY = 'cascade-theme';

function loadSavedThemeName(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveThemeName(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // noop
  }
}

function resolveInitialTheme(): CascadeTheme {
  const savedName = loadSavedThemeName();
  if (savedName) {
    const match = PRESET_THEMES.find(t => t.name === savedName);
    if (match) return match;
  }
  return DEFAULT_THEME;
}

interface ThemeState {
  currentTheme: CascadeTheme;
  presetThemes: CascadeTheme[];
  customThemes: CascadeTheme[];

  setTheme: (theme: CascadeTheme) => void;
  setThemeByName: (name: string) => void;
  importVSCodeThemeJson: (json: string) => CascadeTheme;
}

export const useThemeStore = create<ThemeState>()(
  devtools(
    (set, get) => {
      const initial = resolveInitialTheme();
      applyTheme(initial);

      return {
        currentTheme: initial,
        presetThemes: PRESET_THEMES,
        customThemes: [],

        setTheme: (theme: CascadeTheme) => {
          applyTheme(theme);
          saveThemeName(theme.name);
          set({ currentTheme: theme });
        },

        setThemeByName: (name: string) => {
          const { presetThemes, customThemes } = get();
          const all = [...presetThemes, ...customThemes];
          const match = all.find(t => t.name === name);
          if (match) {
            get().setTheme(match);
          }
        },

        importVSCodeThemeJson: (json: string): CascadeTheme => {
          const parsed = JSON.parse(json);
          const theme = importVSCodeTheme(parsed);

          const existing = get().customThemes;
          const filtered = existing.filter(t => t.name !== theme.name);
          set({ customThemes: [...filtered, theme] });

          get().setTheme(theme);
          return theme;
        },
      };
    },
    { name: 'ThemeStore' }
  )
);
