import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../store/settingsStore';

const DEFAULT_SETTINGS = {
  snapToGrid: true,
  gridSize: 15,
  showMinimap: false,
  showTimings: false,
  analyticsEnabled: true,
  livePreviewScale: 0.5,
  previewIdleDelay: 300,
  defaultFps: 24,
  loopPlayback: true,
};

const STORAGE_KEY = 'cascade-settings';

const getSavedSettings = () => {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) as typeof DEFAULT_SETTINGS : null;
};

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({
    isSettingsOpen: false,
    isAboutOpen: false,
    ...DEFAULT_SETTINGS,
  });
  vi.restoreAllMocks();
});

describe('settingsStore', () => {
  it('uses DEFAULT_SETTINGS values by default', () => {
    const state = useSettingsStore.getState();
    expect(state.snapToGrid).toBe(DEFAULT_SETTINGS.snapToGrid);
    expect(state.gridSize).toBe(DEFAULT_SETTINGS.gridSize);
    expect(state.showMinimap).toBe(DEFAULT_SETTINGS.showMinimap);
    expect(state.showTimings).toBe(DEFAULT_SETTINGS.showTimings);
    expect(state.analyticsEnabled).toBe(DEFAULT_SETTINGS.analyticsEnabled);
    expect(state.livePreviewScale).toBe(DEFAULT_SETTINGS.livePreviewScale);
    expect(state.previewIdleDelay).toBe(DEFAULT_SETTINGS.previewIdleDelay);
    expect(state.defaultFps).toBe(DEFAULT_SETTINGS.defaultFps);
    expect(state.loopPlayback).toBe(DEFAULT_SETTINGS.loopPlayback);
  });

  it('setSnapToGrid updates state and persists', () => {
    useSettingsStore.getState().setSnapToGrid(false);
    expect(useSettingsStore.getState().snapToGrid).toBe(false);
    expect(getSavedSettings()?.snapToGrid).toBe(false);
  });

  it('setGridSize updates state and persists', () => {
    useSettingsStore.getState().setGridSize(20);
    expect(useSettingsStore.getState().gridSize).toBe(20);
    expect(getSavedSettings()?.gridSize).toBe(20);
  });

  it('setShowMinimap updates state and persists', () => {
    useSettingsStore.getState().setShowMinimap(true);
    expect(useSettingsStore.getState().showMinimap).toBe(true);
    expect(getSavedSettings()?.showMinimap).toBe(true);
  });

  it('setShowTimings updates state and persists', () => {
    useSettingsStore.getState().setShowTimings(true);
    expect(useSettingsStore.getState().showTimings).toBe(true);
    expect(getSavedSettings()?.showTimings).toBe(true);
  });

  it('setAnalyticsEnabled updates state and persists', () => {
    useSettingsStore.getState().setAnalyticsEnabled(false);
    expect(useSettingsStore.getState().analyticsEnabled).toBe(false);
    expect(getSavedSettings()?.analyticsEnabled).toBe(false);
  });

  it('setLivePreviewScale updates state and persists', () => {
    useSettingsStore.getState().setLivePreviewScale(0.75);
    expect(useSettingsStore.getState().livePreviewScale).toBe(0.75);
    expect(getSavedSettings()?.livePreviewScale).toBe(0.75);
  });

  it('setPreviewIdleDelay updates state and persists', () => {
    useSettingsStore.getState().setPreviewIdleDelay(500);
    expect(useSettingsStore.getState().previewIdleDelay).toBe(500);
    expect(getSavedSettings()?.previewIdleDelay).toBe(500);
  });

  it('setDefaultFps updates state and persists', () => {
    useSettingsStore.getState().setDefaultFps(30);
    expect(useSettingsStore.getState().defaultFps).toBe(30);
    expect(getSavedSettings()?.defaultFps).toBe(30);
  });

  it('setLoopPlayback updates state and persists', () => {
    useSettingsStore.getState().setLoopPlayback(false);
    expect(useSettingsStore.getState().loopPlayback).toBe(false);
    expect(getSavedSettings()?.loopPlayback).toBe(false);
  });

  it('openSettings and closeSettings toggle isSettingsOpen', () => {
    useSettingsStore.getState().openSettings();
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    useSettingsStore.getState().closeSettings();
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });

  it('openAbout and closeAbout toggle isAboutOpen', () => {
    useSettingsStore.getState().openAbout();
    expect(useSettingsStore.getState().isAboutOpen).toBe(true);
    useSettingsStore.getState().closeAbout();
    expect(useSettingsStore.getState().isAboutOpen).toBe(false);
  });

  it('loads saved settings from localStorage on init', async () => {
    const saved = { ...DEFAULT_SETTINGS, gridSize: 42, showMinimap: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    await vi.resetModules();
    const { useSettingsStore: freshStore } = await import('../store/settingsStore');
    const state = freshStore.getState();
    expect(state.gridSize).toBe(42);
    expect(state.showMinimap).toBe(true);
  });

  it('falls back to defaults when localStorage is empty', async () => {
    localStorage.removeItem(STORAGE_KEY);
    await vi.resetModules();
    const { useSettingsStore: freshStore } = await import('../store/settingsStore');
    const state = freshStore.getState();
    expect(state.gridSize).toBe(DEFAULT_SETTINGS.gridSize);
    expect(state.snapToGrid).toBe(DEFAULT_SETTINGS.snapToGrid);
  });

  it('falls back to defaults when localStorage has invalid JSON', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, '{invalid-json');
    await vi.resetModules();
    const { useSettingsStore: freshStore } = await import('../store/settingsStore');
    const state = freshStore.getState();
    expect(state.defaultFps).toBe(DEFAULT_SETTINGS.defaultFps);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('merges partial saved settings with defaults', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ gridSize: 24 }));
    await vi.resetModules();
    const { useSettingsStore: freshStore } = await import('../store/settingsStore');
    const state = freshStore.getState();
    expect(state.gridSize).toBe(24);
    expect(state.snapToGrid).toBe(DEFAULT_SETTINGS.snapToGrid);
    expect(state.previewIdleDelay).toBe(DEFAULT_SETTINGS.previewIdleDelay);
  });
});
