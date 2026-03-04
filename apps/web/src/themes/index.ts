import type { CascadeTheme } from './types';

import cascadeDark from './presets/cascade-dark.json';
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
import gruvboxLight from './presets/gruvbox-light.json';
import nightOwl from './presets/night-owl.json';
import synthwave84 from './presets/synthwave-84.json';
import everforestDark from './presets/everforest-dark.json';
import atomOneLight from './presets/atom-one-light.json';
import shadesOfPurple from './presets/shades-of-purple.json';
import cobalt2 from './presets/cobalt2.json';
import horizon from './presets/horizon.json';

export const PRESET_THEMES: CascadeTheme[] = [
  cascadeDark as CascadeTheme,
  dracula as CascadeTheme,
  monokai as CascadeTheme,
  oneDark as CascadeTheme,
  nord as CascadeTheme,
  tokyoNight as CascadeTheme,
  catppuccinMocha as CascadeTheme,
  catppuccinLatte as CascadeTheme,
  rosePine as CascadeTheme,
  gruvboxDark as CascadeTheme,
  gruvboxLight as CascadeTheme,
  palenight as CascadeTheme,
  ayuDark as CascadeTheme,
  nightOwl as CascadeTheme,
  synthwave84 as CascadeTheme,
  everforestDark as CascadeTheme,
  cobalt2 as CascadeTheme,
  horizon as CascadeTheme,
  shadesOfPurple as CascadeTheme,
  solarizedDark as CascadeTheme,
  solarizedLight as CascadeTheme,
  githubDark as CascadeTheme,
  githubLight as CascadeTheme,
  atomOneLight as CascadeTheme,
];

export const DEFAULT_THEME = cascadeDark as CascadeTheme;

export { applyTheme } from './applyTheme';
export { importVSCodeTheme } from './importVSCodeTheme';
export type { CascadeTheme, ThemeTokens, SyntaxColors } from './types';
export { tokenToCssVar, THEME_TOKEN_KEYS } from './types';
