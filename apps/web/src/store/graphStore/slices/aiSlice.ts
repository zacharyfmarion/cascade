import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { NodeSpec } from '../../types';
import { getEngine } from '../kernel';
import { formatGpuScriptCompileError } from '../../../engine/gpuScriptErrors';

export interface AiSliceState {
  aiNodeStatuses: Record<string, string>;
  aiNodeStale: Record<string, boolean>;
  aiActionInProgress: boolean;
}

export interface AiSliceActions {
  setAiApiKey: (provider: string, key: string) => Promise<void>;
  isAiConfigured: () => Promise<boolean>;
  refreshAiNodeStale: () => void;
  runAiNode: (nodeId: string) => Promise<void>;
  beginAiAction: () => Promise<void>;
  endAiAction: () => void;
  compileScriptNode: (nodeId: string, manifestJson: string) => Promise<NodeSpec>;
  setDslHandle: (nodeId: string, handle: string) => void;
}

export type AiSlice = AiSliceState & AiSliceActions;

export const createAiSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  AiSlice
> = (set, get) => ({
  aiNodeStatuses: {},
  aiNodeStale: {},
  aiActionInProgress: false,

  setAiApiKey: async (provider, key) => {
    const eng = getEngine();
    if (eng.setAiApiKey) {
      await eng.setAiApiKey(provider, key);
    }
  },

  isAiConfigured: async () => {
    const eng = getEngine();
    if (eng.isAiConfigured) {
      return eng.isAiConfigured();
    }
    return false;
  },

  refreshAiNodeStale: async () => {
    const eng = getEngine();
    if (!eng.getNodeExecutionState) return;
    const state = get();
    const newStale: Record<string, boolean> = {};
    for (const nodeId of Object.keys(state.aiNodeStatuses)) {
      const execState = await Promise.resolve(eng.getNodeExecutionState(nodeId));
      newStale[nodeId] = execState.isStale;
    }
    set({ aiNodeStale: newStale });
  },

  runAiNode: async (nodeId) => {
    const eng = getEngine();
    if (!eng.runAiNode) return;
    set(state => ({
      aiNodeStatuses: { ...state.aiNodeStatuses, [nodeId]: 'running' },
    }));
    try {
      await eng.runAiNode(nodeId);
      set(state => ({
        aiNodeStatuses: { ...state.aiNodeStatuses, [nodeId]: 'complete' },
        aiNodeStale: { ...state.aiNodeStale, [nodeId]: false },
      }));
      get().renderAllViewersAsync();
    } catch (e) {
      const execState = await Promise.resolve(eng.getNodeExecutionState?.(nodeId));
      set(state => ({
        aiNodeStatuses: { ...state.aiNodeStatuses, [nodeId]: `error:${execState?.error ?? e}` },
      }));
    }
  },

  beginAiAction: async () => {
    set({ aiActionInProgress: true });
  },

  endAiAction: () => {
    set({ aiActionInProgress: false });
  },

  compileScriptNode: async (nodeId, manifestJson) => {
    const eng = getEngine();
    if (!eng.compileScriptNode) throw new Error("Engine doesn't support script compilation");
    try {
      const spec = await eng.compileScriptNode(nodeId, manifestJson);
      const specs = await eng.listNodeTypes();
      const existingIdx = specs.findIndex(s => s.id === spec.id);
      if (existingIdx >= 0) {
        specs[existingIdx] = spec;
      } else {
        specs.push(spec);
      }

      const newNodes = new Map(get().nodes);
      const currentNode = newNodes.get(nodeId);
      if (currentNode) {
        newNodes.set(nodeId, {
          ...currentNode,
          params: {
            ...currentNode.params,
            __script_manifest: { String: manifestJson },
          },
        });
      }

      set({ nodeSpecs: specs, nodes: newNodes, dirty: true });
      get().triggerAffectedViewers([nodeId]);
      return spec;
    } catch (error) {
      throw new Error(formatGpuScriptCompileError(error, manifestJson));
    }
  },

  setDslHandle: (nodeId, handle) => {
    const newNodes = new Map(get().nodes);
    const node = newNodes.get(nodeId);
    if (!node) return;
    if (node.dslHandle === handle) return;
    node.dslHandle = handle;
    newNodes.set(nodeId, { ...node });
    set({ nodes: newNodes });
  },
});
