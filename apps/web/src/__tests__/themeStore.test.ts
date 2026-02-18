import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, PRESET_THEMES } from '../themes';
import { useThemeStore } from '../store/themeStore';

const STORAGE_KEY = 'compositor-theme';

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState({
    currentTheme: DEFAULT_THEME,
    presetThemes: PRESET_THEMES,
    customThemes: [],
  });
  vi.restoreAllMocks();
});

describe('themeStore', () => {
  it('initial theme is the default', () => {
    const state = useThemeStore.getState();
    expect(state.currentTheme.name).toBe(DEFAULT_THEME.name);
  });

  it('presetThemes contains all preset themes', () => {
    const state = useThemeStore.getState();
    expect(state.presetThemes).toEqual(PRESET_THEMES);
  });

  it('customThemes starts empty', () => {
    const state = useThemeStore.getState();
    expect(state.customThemes).toHaveLength(0);
  });

  it('setTheme updates currentTheme', () => {
    const theme = PRESET_THEMES[1];
    useThemeStore.getState().setTheme(theme);
    expect(useThemeStore.getState().currentTheme.name).toBe(theme.name);
  });

  it('setTheme persists theme name to localStorage', () => {
    const theme = PRESET_THEMES[2];
    useThemeStore.getState().setTheme(theme);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(theme.name);
  });

  it('setTheme calls applyTheme via document style updates', () => {
    const setPropertySpy = vi.spyOn(document.documentElement.style, 'setProperty');
    useThemeStore.getState().setTheme(PRESET_THEMES[0]);
    expect(setPropertySpy).toHaveBeenCalled();
  });

  it('setThemeByName finds and applies preset theme', () => {
    const theme = PRESET_THEMES[3];
    useThemeStore.getState().setThemeByName(theme.name);
    expect(useThemeStore.getState().currentTheme.name).toBe(theme.name);
  });

  it('setThemeByName with unknown name is a no-op', () => {
    const before = useThemeStore.getState().currentTheme.name;
    useThemeStore.getState().setThemeByName('unknown-theme');
    expect(useThemeStore.getState().currentTheme.name).toBe(before);
  });

  it('importVSCodeThemeJson adds to customThemes', () => {
    const json = JSON.stringify({
      name: 'Imported Theme',
      type: 'dark',
      colors: {
        'editor.background': '#111111',
        'editor.foreground': '#eeeeee',
        'button.background': '#ff0000',
      },
    });
    useThemeStore.getState().importVSCodeThemeJson(json);
    const state = useThemeStore.getState();
    expect(state.customThemes).toHaveLength(1);
    expect(state.customThemes[0].name).toBe('Imported Theme');
  });

  it('importVSCodeThemeJson sets it as current theme', () => {
    const json = JSON.stringify({
      name: 'Custom Active',
      type: 'dark',
      colors: {
        'editor.background': '#222222',
      },
    });
    useThemeStore.getState().importVSCodeThemeJson(json);
    expect(useThemeStore.getState().currentTheme.name).toBe('Custom Active');
  });

  it('importVSCodeThemeJson replaces existing custom theme with same name', () => {
    const first = JSON.stringify({
      name: 'Replace Me',
      type: 'dark',
      colors: { 'editor.background': '#111111' },
    });
    const second = JSON.stringify({
      name: 'Replace Me',
      type: 'light',
      colors: { 'editor.background': '#ffffff' },
    });
    useThemeStore.getState().importVSCodeThemeJson(first);
    useThemeStore.getState().importVSCodeThemeJson(second);
    const state = useThemeStore.getState();
    expect(state.customThemes).toHaveLength(1);
    expect(state.customThemes[0].type).toBe('light');
  });

  it('loads theme from localStorage on init', async () => {
    const theme = PRESET_THEMES[4];
    localStorage.setItem(STORAGE_KEY, theme.name);
    await vi.resetModules();
    const { useThemeStore: freshStore } = await import('../store/themeStore');
    expect(freshStore.getState().currentTheme.name).toBe(theme.name);
  });
});
