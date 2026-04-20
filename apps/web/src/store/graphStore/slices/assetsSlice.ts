import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { ParamValue } from '../../types';
import { getEngine } from '../kernel';

export type AssetsSliceState = object;

export interface AssetsSliceActions {
  loadImageFile: (nodeId: string, file: File) => void;
  getImageData: (nodeId: string) => Promise<Uint8Array | null>;
  loadPaletteFile: (nodeId: string, file: File) => void;
  loadBatchFiles: (nodeId: string, files: File[]) => Promise<void>;
}

export type AssetsSlice = AssetsSliceState & AssetsSliceActions;

export const createAssetsSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  AssetsSlice
> = (set, get) => ({
  loadImageFile: (nodeId, file) => {
    file.arrayBuffer().then(async buffer => {
      const data = new Uint8Array(buffer);
      const change = await getEngine().loadImageData(nodeId, data);
      get().applyNodeInterfaceChange(nodeId, change);
      set({ dirty: true });
      get().triggerAllViewers();
    }).catch(e => {
      console.error('loadImageFile failed:', e);
    });
  },

  getImageData: async (nodeId) => {
    const eng = getEngine();
    if (eng.getImageData) {
      return Promise.resolve(eng.getImageData(nodeId)) ?? null;
    }
    return null;
  },

  loadPaletteFile: (nodeId, file) => {
    file.arrayBuffer().then(async buffer => {
      const data = new Uint8Array(buffer);
      const eng = getEngine();
      if (!eng.loadPaletteData) {
        throw new Error('Current engine does not support palette imports');
      }
      const colors = await eng.loadPaletteData(nodeId, data);
      const newNodes = new Map(get().nodes);
      const node = newNodes.get(nodeId);
      if (node) {
        node.params = { ...node.params, colors: { ColorPalette: colors } as ParamValue };
        newNodes.set(nodeId, { ...node });
        set({ nodes: newNodes, dirty: true });
      }
      get().triggerAllViewers();
    }).catch(e => {
      console.error('loadPaletteFile failed:', e);
    });
  },

  loadBatchFiles: async (nodeId, files) => {
    const eng = getEngine();
    if (!eng.batchClear || !eng.batchAddImage) return;
    await eng.batchClear(nodeId);
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
    for (const file of sorted) {
      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);
      await eng.batchAddImage(nodeId, file.name, data);
    }
    set({ dirty: true });
    get().triggerAllViewers();
  },
});
