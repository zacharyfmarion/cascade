import { describe, expect, it, vi } from 'vitest';
import { getMenuBarDef, handleMenuAction } from '../menuDefinition';
import { useGraphStore } from '../../store/graphStore';

vi.mock('../../engine/wasmEngine', () => ({
  initWasmEngine: vi.fn(),
  wasmEngine: null,
}));

const setTauriMode = (enabled: boolean) => {
  const host = globalThis as unknown as Record<string, unknown>;
  if (enabled) {
    host.__TAURI_INTERNALS__ = {};
    host.isTauri = true;
  } else {
    delete host.__TAURI_INTERNALS__;
    delete host.isTauri;
  }
};

describe('menuDefinition', () => {
  it('hides Save Bundled Copy on web', () => {
    setTauriMode(false);
    const fileMenu = getMenuBarDef().find(menu => menu.label === 'File');
    const actions = fileMenu?.items.flatMap(item => item.type === 'action' ? [item] : []);

    expect(actions?.map(action => action.id)).not.toContain('file.saveBundled');
  });

  it('shows Save Bundled Copy on desktop', () => {
    setTauriMode(true);
    const fileMenu = getMenuBarDef().find(menu => menu.label === 'File');
    const actions = fileMenu?.items.flatMap(item => item.type === 'action' ? [item] : []);

    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'file.saveBundled', label: 'Save Bundled Copy...' }),
    ]));
    setTauriMode(false);
  });

  it('exposes project lifecycle file actions', () => {
    setTauriMode(false);
    const fileMenu = getMenuBarDef().find(menu => menu.label === 'File');
    const actions = fileMenu?.items.flatMap(item => item.type === 'action' ? [item] : []);

    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'file.new', label: 'New Project' }),
      expect.objectContaining({ id: 'file.open', label: 'Open Project' }),
      expect.objectContaining({ id: 'file.save', label: 'Save' }),
      expect.objectContaining({ id: 'file.saveAs', label: 'Save As...' }),
      expect.objectContaining({ id: 'file.exportAllImages', label: 'Export All Images...' }),
    ]));
  });

  it('routes file actions through guarded project requests', () => {
    const requestNewProject = vi.fn();
    const requestOpenProject = vi.fn();
    const requestSaveProject = vi.fn();
    const requestSaveProjectAs = vi.fn();
    const requestCloseProject = vi.fn();
    const exportAllImages = vi.fn();
    useGraphStore.setState({
      requestNewProject,
      requestOpenProject,
      requestSaveProject,
      requestSaveProjectAs,
      requestCloseProject,
      exportAllImages,
    });

    handleMenuAction('app.quit');
    handleMenuAction('file.new');
    handleMenuAction('file.open');
    handleMenuAction('file.save');
    handleMenuAction('file.saveAs');
    handleMenuAction('file.exportAllImages');

    expect(requestCloseProject).toHaveBeenCalledTimes(1);
    expect(requestNewProject).toHaveBeenCalledTimes(1);
    expect(requestOpenProject).toHaveBeenCalledTimes(1);
    expect(requestSaveProject).toHaveBeenCalledTimes(1);
    expect(requestSaveProjectAs).toHaveBeenCalledTimes(1);
    expect(exportAllImages).toHaveBeenCalledTimes(1);
  });
});
