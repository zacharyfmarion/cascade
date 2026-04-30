import { describe, expect, it, vi } from 'vitest';
import { getMenuBarDef, handleMenuAction } from '../menuDefinition';
import { useGraphStore } from '../../store/graphStore';

vi.mock('../../engine/wasmEngine', () => ({
  initWasmEngine: vi.fn(),
  wasmEngine: null,
}));

describe('menuDefinition', () => {
  it('exposes project lifecycle file actions', () => {
    const fileMenu = getMenuBarDef().find(menu => menu.label === 'File');
    const actions = fileMenu?.items.flatMap(item => item.type === 'action' ? [item] : []);

    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'file.new', label: 'New Project' }),
      expect.objectContaining({ id: 'file.open', label: 'Open Project' }),
      expect.objectContaining({ id: 'file.save', label: 'Save' }),
      expect.objectContaining({ id: 'file.saveAs', label: 'Save As...' }),
    ]));
  });

  it('routes file actions through guarded project requests', () => {
    const requestNewProject = vi.fn();
    const requestOpenProject = vi.fn();
    const requestSaveProject = vi.fn();
    const requestSaveProjectAs = vi.fn();
    useGraphStore.setState({
      requestNewProject,
      requestOpenProject,
      requestSaveProject,
      requestSaveProjectAs,
    });

    handleMenuAction('file.new');
    handleMenuAction('file.open');
    handleMenuAction('file.save');
    handleMenuAction('file.saveAs');

    expect(requestNewProject).toHaveBeenCalledTimes(1);
    expect(requestOpenProject).toHaveBeenCalledTimes(1);
    expect(requestSaveProject).toHaveBeenCalledTimes(1);
    expect(requestSaveProjectAs).toHaveBeenCalledTimes(1);
  });
});
