import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { NodeSpec, ParamDefault, ParamValue, PortSpec } from '../../types';
import { getEngine, markGraphMutation, withGroupIOSpecs } from '../kernel';
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

const scalarPortDefaultToValue = (port: PortSpec): ParamValue | null => {
  const value: ParamDefault | undefined = port.default;
  if (!value) return null;
  if (port.ty === 'Float' && 'Float' in value) return { Float: value.Float };
  if (port.ty === 'Int' && 'Int' in value) return { Int: value.Int };
  if (port.ty === 'Bool' && 'Bool' in value) return { Bool: value.Bool };
  return null;
};

const inputDefaultsForSpec = (
  spec: NodeSpec,
  existing: Record<string, ParamValue>,
): Record<string, ParamValue> => {
  const validInputs = new Set(spec.inputs.map(input => input.name));
  const defaults: Record<string, ParamValue> = {};
  for (const input of spec.inputs) {
    const defaultValue = scalarPortDefaultToValue(input);
    if (defaultValue) defaults[input.name] = defaultValue;
  }
  for (const [name, value] of Object.entries(existing)) {
    if (validInputs.has(name)) defaults[name] = value;
  }
  return defaults;
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

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
    if (!eng.runAiNode) {
      const message = 'AI node execution is not supported in this build.';
      set(state => ({
        aiNodeStatuses: { ...state.aiNodeStatuses, [nodeId]: `error:${message}` },
      }));
      get().pushToast('error', 'AI node failed', message);
      return;
    }
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
      const message = execState?.error || errorMessage(e);
      set(state => ({
        aiNodeStatuses: { ...state.aiNodeStatuses, [nodeId]: `error:${message}` },
      }));
      get().pushToast('error', 'AI node failed', message);
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
    const editingStack = get().editingStack;
    const groupContext = editingStack.length > 1 ? editingStack[editingStack.length - 1] : null;
    if (groupContext) {
      if (!groupContext.groupDefId || !groupContext.groupNodeId || !eng.compileInternalScriptNode || !eng.getGroupInternalGraph) {
        throw new Error("Engine doesn't support internal script compilation");
      }
    } else if (!eng.compileScriptNode) {
      throw new Error("Engine doesn't support script compilation");
    }
    try {
      const spec = groupContext
        ? await eng.compileInternalScriptNode!(groupContext.groupDefId!, nodeId, manifestJson)
        : await eng.compileScriptNode!(nodeId, manifestJson);
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
          inputDefaults: inputDefaultsForSpec(spec, currentNode.inputDefaults),
        });
      }

      const nextSpecs = groupContext && eng.getGroupInternalGraph
        ? withGroupIOSpecs(specs, await eng.getGroupInternalGraph(groupContext.groupNodeId!))
        : specs;
      // Also store in nodeSpecsById so the spec survives any subsequent listNodeTypes() resets
      const newSpecsById = new Map(get().nodeSpecsById);
      newSpecsById.set(nodeId, spec);
      markGraphMutation(set, 'ui');
      set({ nodeSpecs: nextSpecs, nodes: newNodes, nodeSpecsById: newSpecsById, dirty: true });
      get().refreshDslShadowFromGraph();
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
