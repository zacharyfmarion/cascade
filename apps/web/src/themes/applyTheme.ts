import type { CompositorTheme } from './types';
import { tokenToCssVar, THEME_TOKEN_KEYS } from './types';

export function applyTheme(theme: CompositorTheme): void {
  const root = document.documentElement;

  for (const token of THEME_TOKEN_KEYS) {
    const value = theme.colors[token];
    if (value !== undefined) {
      root.style.setProperty(tokenToCssVar(token), value);
    }
  }

  root.setAttribute('data-theme-type', theme.type);
}
