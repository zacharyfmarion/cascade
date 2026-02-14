import type { CompositorTheme } from './types';

import compositorDark from './presets/compositor-dark.json';
import solarizedDark from './presets/solarized-dark.json';
import solarizedLight from './presets/solarized-light.json';
import monokai from './presets/monokai.json';
import dracula from './presets/dracula.json';
import oneDark from './presets/one-dark.json';
import nord from './presets/nord.json';
import githubDark from './presets/github-dark.json';
import githubLight from './presets/github-light.json';
import catppuccinMocha from './presets/catppuccin-mocha.json';
import catppuccinLatte from './presets/catppuccin-latte.json';
import gruvboxDark from './presets/gruvbox-dark.json';
import tokyoNight from './presets/tokyo-night.json';
import rosePine from './presets/rose-pine.json';
import palenight from './presets/palenight.json';
import ayuDark from './presets/ayu-dark.json';

export const PRESET_THEMES: CompositorTheme[] = [
  compositorDark as CompositorTheme,
  dracula as CompositorTheme,
  monokai as CompositorTheme,
  oneDark as CompositorTheme,
  nord as CompositorTheme,
  tokyoNight as CompositorTheme,
  catppuccinMocha as CompositorTheme,
  catppuccinLatte as CompositorTheme,
  rosePine as CompositorTheme,
  gruvboxDark as CompositorTheme,
  palenight as CompositorTheme,
  ayuDark as CompositorTheme,
  solarizedDark as CompositorTheme,
  solarizedLight as CompositorTheme,
  githubDark as CompositorTheme,
  githubLight as CompositorTheme,
];

export const DEFAULT_THEME = compositorDark as CompositorTheme;

export { applyTheme } from './applyTheme';
export { importVSCodeTheme } from './importVSCodeTheme';
export type { CompositorTheme, ThemeTokens } from './types';
export { tokenToCssVar, THEME_TOKEN_KEYS } from './types';
