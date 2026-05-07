import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { BatchInfo } from '../../../engine/bridge';
import type { NodeInstance, ParamValue } from '../../types';
import { MEDIA_NAV_PREVIEW_SCALE, getEngine, markGraphMutation } from '../kernel';
import { assetUriFromHash } from '../assetReferences';

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const bytesToHex = (bytes: Uint8Array): string => (
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
);

const hashBytes = async (bytes: Uint8Array): Promise<string> => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return bytesToHex(new Uint8Array(digest));
};

const pathBasename = (path: string): string => (
  path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path
);

const fileStem = (name: string): string => {
  const base = pathBasename(name);
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(0, index) : base;
};

const batchFilesValue = (paths: string[]): string => (
  `images([${paths.map(path => JSON.stringify(path)).join(', ')}])`
);

const setBatchSourceParams = (
  get: () => GraphState,
  nodeId: string,
  params: Record<string, ParamValue | undefined>,
): Map<string, NodeInstance> => {
  const newNodes = new Map(get().nodes);
  const node = newNodes.get(nodeId);
  if (!node) return newNodes;
  const nextParams = { ...node.params };
  if (params.directory) {
    nextParams.directory = params.directory;
    delete nextParams.files;
  } else if (params.files) {
    nextParams.files = params.files;
    delete nextParams.directory;
  }
  newNodes.set(nodeId, { ...node, params: nextParams });
  return newNodes;
};

export type AssetsSliceState = object;

export interface AssetsSliceActions {
  loadImageFile: (nodeId: string, file: File) => void;
  loadImagePath: (nodeId: string, path: string) => Promise<void>;
  getImageData: (nodeId: string) => Promise<Uint8Array | null>;
  loadPaletteFile: (nodeId: string, file: File) => void;
  loadBatchFiles: (nodeId: string, files: File[]) => Promise<void>;
  loadBatchPaths: (nodeId: string, paths: string[]) => Promise<void>;
  loadBatchDirectory: (nodeId: string, directory: string) => Promise<BatchInfo>;
  getBatchImageData: (nodeId: string, index: number) => Promise<Uint8Array | null>;
  getBatchThumbnail: (nodeId: string, index: number, maxEdge: number) => Promise<Uint8Array | null>;
}

export type AssetsSlice = AssetsSliceState & AssetsSliceActions;

export const createAssetsSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  AssetsSlice
> = (set, get) => ({
  loadImagePath: async (nodeId, path) => {
    const eng = getEngine();
    if (!eng.loadImagePath) {
      throw new Error('Current engine does not support loading images by path');
    }
    try {
      const change = await eng.loadImagePath(nodeId, path);
      get().applyNodeInterfaceChange(nodeId, change);
      const newNodes = new Map(get().nodes);
      const node = newNodes.get(nodeId);
      if (node) {
        const source = path.startsWith('file://') ? path : `file://${path}`;
        newNodes.set(nodeId, {
          ...node,
          params: { ...node.params, path: { String: source } as ParamValue },
        });
      }
      markGraphMutation(set, 'ui');
      set({ nodes: newNodes, dirty: true });
      get().refreshDslShadowFromGraph();
      get().triggerAllViewers();
    } catch (e) {
      console.error('loadImagePath failed:', e);
      throw e;
    }
  },

  loadImageFile: (nodeId, file) => {
    file.arrayBuffer().then(async buffer => {
      const assetBytes = new Uint8Array(buffer);
      const engineBytes = new Uint8Array(assetBytes);
      const hash = await hashBytes(assetBytes);
      const uri = assetUriFromHash(hash);
      const change = await getEngine().loadImageData(nodeId, engineBytes);
      get().applyNodeInterfaceChange(nodeId, change);
      const newNodes = new Map(get().nodes);
      const node = newNodes.get(nodeId);
      if (node) {
        newNodes.set(nodeId, {
          ...node,
          params: { ...node.params, path: { String: uri } as ParamValue },
        });
      }
      const projectAssets = {
        ...get().projectAssets,
        [nodeId]: {
          type: 'image',
          source: 'embedded',
          uri,
          hash,
          data: bytesToBase64(assetBytes),
          original_filename: file.name,
        },
      };
      markGraphMutation(set, 'ui');
      set({
        nodes: newNodes,
        projectAssets,
        currentProjectAssetStorage: get().currentProjectAssetStorage,
        dirty: true,
      });
      get().refreshDslShadowFromGraph();
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
        markGraphMutation(set, 'ui');
        set({ nodes: newNodes, dirty: true });
        get().refreshDslShadowFromGraph();
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
    const projectAssets = Object.fromEntries(
      Object.entries(get().projectAssets).filter(([key, asset]) => (
        !(key === nodeId && (asset.type ?? asset.asset_type) === 'image_batch')
        && !(key.startsWith(`${nodeId}:`) && (asset.type ?? asset.asset_type) === 'image_batch_frame')
      )),
    );
    const manifestFrames: Array<{ key: string; filename: string; hash: string; uri: string }> = [];
    for (const [index, file] of sorted.entries()) {
      const buffer = await file.arrayBuffer();
      const assetBytes = new Uint8Array(buffer);
      const engineBytes = new Uint8Array(assetBytes);
      await eng.batchAddImage(nodeId, file.name, engineBytes);
      const hash = await hashBytes(assetBytes);
      const uri = assetUriFromHash(hash);
      const key = `${nodeId}:batch:${String(index).padStart(6, '0')}`;
      projectAssets[key] = {
        type: 'image_batch_frame',
        source: 'embedded',
        uri,
        hash,
        data: bytesToBase64(assetBytes),
        original_filename: file.name,
      };
      manifestFrames.push({ key, filename: file.name, hash, uri });
    }
    if (manifestFrames.length > 0) {
      const manifestBytes = new TextEncoder().encode(JSON.stringify({ frames: manifestFrames }));
      const hash = await hashBytes(manifestBytes);
      projectAssets[nodeId] = {
        type: 'image_batch',
        source: 'embedded',
        uri: assetUriFromHash(hash),
        hash,
        data: bytesToBase64(manifestBytes),
        original_filename: '',
      };
    }
    const nodes = manifestFrames.length > 0
      ? setBatchSourceParams(get, nodeId, {
          files: { String: batchFilesValue(manifestFrames.map(frame => frame.uri)) } as ParamValue,
        })
      : new Map(get().nodes);
    markGraphMutation(set, 'ui');
    set({ nodes, projectAssets, dirty: true });
    get().setBatchInfo(nodeId, {
      count: sorted.length,
      filenames: sorted.map(file => fileStem(file.name)),
    });
    get().refreshDslShadowFromGraph();
    void get().triggerAffectedViewers([nodeId], MEDIA_NAV_PREVIEW_SCALE);
  },

  loadBatchPaths: async (nodeId, paths) => {
    const eng = getEngine();
    if (!eng.batchLoadPaths) {
      throw new Error('Current engine does not support loading batch image paths');
    }
    const info = await eng.batchLoadPaths(nodeId, paths);
    const sorted = [...paths].sort((a, b) => pathBasename(a).localeCompare(pathBasename(b)));
    const nodes = setBatchSourceParams(get, nodeId, {
      files: { String: batchFilesValue(sorted) } as ParamValue,
    });
    markGraphMutation(set, 'ui');
    set({ nodes, dirty: true });
    get().setBatchInfo(nodeId, info);
    get().refreshDslShadowFromGraph();
    void get().triggerAffectedViewers([nodeId], MEDIA_NAV_PREVIEW_SCALE);
  },

  loadBatchDirectory: async (nodeId, directory) => {
    const eng = getEngine();
    if (!eng.batchLoadDirectory) {
      throw new Error('Current engine does not support batch folder loading');
    }
    const info = await eng.batchLoadDirectory(nodeId, directory);
    const nodes = setBatchSourceParams(get, nodeId, {
      directory: { String: directory } as ParamValue,
    });
    markGraphMutation(set, 'ui');
    set({ nodes, dirty: true });
    get().setBatchInfo(nodeId, info);
    get().refreshDslShadowFromGraph();
    void get().triggerAffectedViewers([nodeId], MEDIA_NAV_PREVIEW_SCALE);
    return info;
  },

  getBatchImageData: async (nodeId, index) => {
    const eng = getEngine();
    if (!eng.getBatchImageData) return null;
    return Promise.resolve(eng.getBatchImageData(nodeId, index)) ?? null;
  },

  getBatchThumbnail: async (nodeId, index, maxEdge) => {
    const eng = getEngine();
    if (eng.getBatchThumbnail) {
      return Promise.resolve(eng.getBatchThumbnail(nodeId, index, maxEdge)) ?? null;
    }
    if (!eng.getBatchImageData) return null;
    return Promise.resolve(eng.getBatchImageData(nodeId, index)) ?? null;
  },
});
