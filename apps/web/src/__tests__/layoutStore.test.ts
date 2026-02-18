import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockviewApi } from 'dockview';
import { useLayoutStore } from '../store/layoutStore';

const STORAGE_KEY = 'compositor-layout';

const createDockviewApiMock = () => {
  const addPanel = vi.fn();
  const clear = vi.fn();
  const toJSON = vi.fn(() => ({ version: 1, panels: [] }));
  const groups = [{ id: 'group-1' }];
  return {
    addPanel,
    clear,
    toJSON,
    groups,
  } as unknown as DockviewApi;
};

beforeEach(() => {
  localStorage.clear();
  useLayoutStore.setState({ dockviewApi: null });
  vi.restoreAllMocks();
});

describe('layoutStore', () => {
  it('dockviewApi starts as null', () => {
    expect(useLayoutStore.getState().dockviewApi).toBeNull();
  });

  it('setDockviewApi sets the API', () => {
    const api = createDockviewApiMock();
    useLayoutStore.getState().setDockviewApi(api);
    expect(useLayoutStore.getState().dockviewApi).toBe(api);
  });

  it('saveLayout serializes to localStorage', () => {
    const api = createDockviewApiMock();
    useLayoutStore.getState().setDockviewApi(api);
    useLayoutStore.getState().saveLayout();
    const saved = localStorage.getItem(STORAGE_KEY);
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved ?? '{}')).toEqual({ version: 1, panels: [] });
  });

  it('saveLayout with no API is a no-op', () => {
    useLayoutStore.getState().saveLayout();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('loadLayout returns parsed data from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ok: true }));
    expect(useLayoutStore.getState().loadLayout()).toEqual({ ok: true });
  });

  it('loadLayout returns null when no saved layout', () => {
    expect(useLayoutStore.getState().loadLayout()).toBeNull();
  });

  it('loadLayout returns null on invalid JSON', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, '{bad-json');
    expect(useLayoutStore.getState().loadLayout()).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('resetLayout removes from localStorage and re-applies default', () => {
    const api = createDockviewApiMock();
    useLayoutStore.getState().setDockviewApi(api);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ stale: true }));
    useLayoutStore.getState().resetLayout();
    expect(api.addPanel).toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('applyWorkspacePreset clears and adds panels', () => {
    const api = createDockviewApiMock();
    useLayoutStore.getState().setDockviewApi(api);
    useLayoutStore.getState().applyWorkspacePreset('minimal');
    expect(api.clear).toHaveBeenCalled();
    expect(api.addPanel).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});
