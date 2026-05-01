import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockviewApi } from 'dockview';
import { useLayoutStore } from '../store/layoutStore';

const STORAGE_KEY = 'cascade-layout';
const VERSION_KEY = 'cascade-layout-version';
/** Must match LAYOUT_VERSION in layoutStore.ts */
const CURRENT_VERSION = '7';

const createDockviewApiMock = () => {
  const addPanel = vi.fn();
  const clear = vi.fn();
  const toJSON = vi.fn(() => ({ version: 1, panels: [] }));
  const groups = [{ id: 'group-1' }];
  const panels = new Map<string, { api: { setActive: ReturnType<typeof vi.fn> } }>();
  panels.set('node-library', { api: { setActive: vi.fn() } });
  panels.set('inspector', { api: { setActive: vi.fn() } });
  const getPanel = vi.fn((id: string) => panels.get(id) ?? null);
  return {
    addPanel,
    clear,
    toJSON,
    groups,
    getPanel,
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

  it('saveLayout stores the layout version', () => {
    const api = createDockviewApiMock();
    useLayoutStore.getState().setDockviewApi(api);
    useLayoutStore.getState().saveLayout();
    expect(localStorage.getItem(VERSION_KEY)).toBe(CURRENT_VERSION);
  });

  it('saveLayout with no API is a no-op', () => {
    useLayoutStore.getState().saveLayout();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(VERSION_KEY)).toBeNull();
  });

  it('loadLayout returns parsed data when version matches', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ok: true }));
    localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
    expect(useLayoutStore.getState().loadLayout()).toEqual({ ok: true });
  });

  it('loadLayout returns null when no saved layout', () => {
    expect(useLayoutStore.getState().loadLayout()).toBeNull();
  });

  it('loadLayout returns null on invalid JSON', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, '{bad-json');
    localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
    expect(useLayoutStore.getState().loadLayout()).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('loadLayout discards stale layout when version is missing', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ stale: true }));
    // No version key set
    expect(useLayoutStore.getState().loadLayout()).toBeNull();
    // Should also clean up the stale data
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('loadLayout discards stale layout when version is outdated', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ old: true }));
    localStorage.setItem(VERSION_KEY, '1');
    expect(useLayoutStore.getState().loadLayout()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(VERSION_KEY)).toBeNull();
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

  it('compositing preset includes dsl-editor panel', () => {
    const api = createDockviewApiMock();
    useLayoutStore.getState().setDockviewApi(api);
    useLayoutStore.getState().applyWorkspacePreset('compositing');
    const calls = (api.addPanel as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => (c[0] as { id: string }).id);
    expect(calls).toContain('dsl-editor');
  });

  it('compositing preset includes examples beside node library', () => {
    const api = createDockviewApiMock();
    useLayoutStore.getState().setDockviewApi(api);
    useLayoutStore.getState().applyWorkspacePreset('compositing');

    expect(api.addPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: 'examples',
      component: 'examples',
      title: 'Examples',
      position: { referencePanel: 'node-library' },
    }));
  });

  it('focusExamplesPanel activates an existing examples panel', () => {
    const api = createDockviewApiMock();
    const examplesPanel = { api: { setActive: vi.fn() } };
    (api.getPanel as ReturnType<typeof vi.fn>).mockImplementation((id: string) => (
      id === 'examples' ? examplesPanel : null
    ));
    useLayoutStore.getState().setDockviewApi(api);

    useLayoutStore.getState().focusExamplesPanel();

    expect(examplesPanel.api.setActive).toHaveBeenCalled();
    expect(api.addPanel).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'examples' }));
  });

  it('focusExamplesPanel creates examples beside node library when missing', () => {
    const api = createDockviewApiMock();
    const nodeLibraryPanel = { api: { setActive: vi.fn() } };
    (api.getPanel as ReturnType<typeof vi.fn>).mockImplementation((id: string) => (
      id === 'node-library' ? nodeLibraryPanel : null
    ));
    useLayoutStore.getState().setDockviewApi(api);

    useLayoutStore.getState().focusExamplesPanel();

    expect(api.addPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: 'examples',
      component: 'examples',
      position: { referencePanel: 'node-library' },
    }));
  });
});
