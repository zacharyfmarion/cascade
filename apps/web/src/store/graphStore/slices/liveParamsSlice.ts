import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { ParamValue } from '../../types';
import { parseEngineError } from '../../../engine/engineError';
import { useSettingsStore } from '../../settingsStore';
import {
  kernel,
  cloneEditingStack,
  downscaleRenderResult,
  getEngine,
} from '../kernel';

// ---------------------------------------------------------------------------
// Slice interface
// ---------------------------------------------------------------------------

export interface LiveParamsSliceActions {
  setParamLive: (nodeId: string, key: string, value: ParamValue) => Promise<void>;
  setParamCommit: (nodeId: string, key: string, value: ParamValue) => Promise<void>;
  setInputDefaultLive: (nodeId: string, portName: string, value: ParamValue) => Promise<void>;
  setInputDefaultCommit: (nodeId: string, portName: string, value: ParamValue) => Promise<void>;
}

export type LiveParamsSlice = LiveParamsSliceActions;

// ---------------------------------------------------------------------------
// Slice creator
// ---------------------------------------------------------------------------

export const createLiveParamsSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  LiveParamsSlice
> = (set, get) => {
  // -- internal helpers -----------------------------------------------------

  const updateNodeTimings = () => {
    const timings = getEngine().getLastRenderTimings?.();
    if (timings) {
      const prev = get().nodeTimings;
      const merged = new Map(prev);
      for (const [nodeId, value] of Object.entries(timings)) {
        if (value > 0) {
          merged.set(nodeId, value);
        }
      }
      set({ nodeTimings: merged });
    }
  };

  // -- public slice ---------------------------------------------------------

  return {
    setParamLive: async (nodeId, key, value) => {
      if (!kernel.preCommitSnapshot) {
        kernel.preCommitSnapshot = {
          engineState: null,
          nodes: new Map(get().nodes),
          connections: [...get().connections],
          frames: new Map(get().frames),
          editingStack: cloneEditingStack(get().editingStack),
          imageData: new Map(),
          sequenceInfoMap: new Map(get().sequenceInfoMap),
        };
        Promise.resolve(getEngine().exportGraph()).then(state => {
          if (kernel.preCommitSnapshot) kernel.preCommitSnapshot.engineState = state;
        });
        get().collectImageData().then(data => {
          if (kernel.preCommitSnapshot) kernel.preCommitSnapshot.imageData = data;
        });
      }

      const newNodes = new Map(get().nodes);
      const node = newNodes.get(nodeId);
      const liveScale = useSettingsStore.getState().livePreviewScale;
      const shouldSetPreviewScale = get().previewScale !== liveScale;
      if (node) {
        node.params = { ...node.params, [key]: value };
        newNodes.set(nodeId, { ...node });
        if (shouldSetPreviewScale) {
          set({ nodes: newNodes, previewScale: liveScale });
        } else {
          set({ nodes: newNodes });
        }
      } else if (shouldSetPreviewScale) {
        set({ previewScale: liveScale });
      }

      const eng = getEngine();
      if (eng.setParamAndRender) {
        const renderGeneration = ++kernel.liveRenderGeneration;
        kernel.pendingLiveRender = () => {
          eng.setParamAndRender!(nodeId, key, value, get().currentFrame).then(async results => {
            if (renderGeneration !== kernel.liveRenderGeneration) return;
            if (results.size > 0) {
              const newResults = new Map(get().renderResults);
              for (const [vid, r] of results) {
                const scaled = await downscaleRenderResult(r, liveScale);
                newResults.set(vid, scaled);
              }
              if (renderGeneration !== kernel.liveRenderGeneration) return;
              set({ renderResults: newResults, lastError: null });
              updateNodeTimings();
            }
          }).catch((e: unknown) => { const error = parseEngineError(e); if (error.code !== 'MISSING_INPUT') { set({ lastError: error }); } });
        };
      } else {
        kernel.pendingLiveRender = () => {
          getEngine().setParam(nodeId, key, value);
          get().triggerAffectedViewers([nodeId]);
        };
      }

      if (kernel.liveRenderRaf === null) {
        kernel.liveRenderRaf = requestAnimationFrame(() => {
          kernel.liveRenderRaf = null;
          kernel.pendingLiveRender?.();
          kernel.pendingLiveRender = null;
        });
      }

      if (kernel.idlePreviewTimer) clearTimeout(kernel.idlePreviewTimer);
      kernel.idlePreviewTimer = setTimeout(() => {
        kernel.idlePreviewTimer = null;
        set({ previewScale: 1 });
        get().triggerAffectedViewers([nodeId]);
      }, useSettingsStore.getState().previewIdleDelay);
    },

    setParamCommit: async (nodeId, key, value) => {
      if (kernel.preCommitSnapshot) {
        if (!kernel.preCommitSnapshot.engineState) {
          kernel.preCommitSnapshot.engineState = await getEngine().exportGraph();
        }
        kernel.undoStack.push(kernel.preCommitSnapshot);
        if (kernel.undoStack.length > useSettingsStore.getState().maxUndoSteps) kernel.undoStack.shift();
        kernel.redoStack.length = 0;
        kernel.preCommitSnapshot = null;
      }

      const newNodes = new Map(get().nodes);
      const node = newNodes.get(nodeId);
      if (node) {
        node.params = { ...node.params, [key]: value };
        newNodes.set(nodeId, { ...node });
        set({ nodes: newNodes, canUndo: kernel.undoStack.length > 0, canRedo: false, previewScale: 1, dirty: true });
      } else {
        set({ previewScale: 1 });
      }

      if (kernel.liveRenderRaf !== null) {
        cancelAnimationFrame(kernel.liveRenderRaf);
        kernel.liveRenderRaf = null;
        kernel.pendingLiveRender = null;
      }

      if (kernel.idlePreviewTimer) {
        clearTimeout(kernel.idlePreviewTimer);
        kernel.idlePreviewTimer = null;
      }

      const eng = getEngine();
      if (eng.setParamAndRender) {
        const renderGeneration = ++kernel.liveRenderGeneration;
        eng.setParamAndRender(nodeId, key, value, get().currentFrame).then(async results => {
          if (renderGeneration !== kernel.liveRenderGeneration) return;
          if (results.size > 0) {
            const newResults = new Map(get().renderResults);
            for (const [vid, r] of results) {
              const scaled = await downscaleRenderResult(r, 1);
              newResults.set(vid, scaled);
            }
            if (renderGeneration !== kernel.liveRenderGeneration) return;
            set({ renderResults: newResults, lastError: null });
            updateNodeTimings();
          }
        }).catch((e: unknown) => { const error = parseEngineError(e); if (error.code !== 'MISSING_INPUT') { set({ lastError: error }); } });
      } else {
        await getEngine().setParam(nodeId, key, value);
        get().triggerAffectedViewers([nodeId]);
      }
    },

    setInputDefaultLive: async (nodeId, portName, value) => {
      if (!kernel.preCommitSnapshot) {
        kernel.preCommitSnapshot = {
          engineState: null,
          nodes: new Map(get().nodes),
          connections: [...get().connections],
          frames: new Map(get().frames),
          editingStack: cloneEditingStack(get().editingStack),
          imageData: new Map(),
          sequenceInfoMap: new Map(get().sequenceInfoMap),
        };
        Promise.resolve(getEngine().exportGraph()).then(state => {
          if (kernel.preCommitSnapshot) kernel.preCommitSnapshot.engineState = state;
        });
        get().collectImageData().then(data => {
          if (kernel.preCommitSnapshot) kernel.preCommitSnapshot.imageData = data;
        });
      }

      const newNodes = new Map(get().nodes);
      const node = newNodes.get(nodeId);
      const liveScale = useSettingsStore.getState().livePreviewScale;
      const shouldSetPreviewScale = get().previewScale !== liveScale;
      if (node) {
        node.inputDefaults = { ...node.inputDefaults, [portName]: value };
        newNodes.set(nodeId, { ...node });
        if (shouldSetPreviewScale) {
          set({ nodes: newNodes, previewScale: liveScale });
        } else {
          set({ nodes: newNodes });
        }
      } else if (shouldSetPreviewScale) {
        set({ previewScale: liveScale });
      }

      kernel.pendingLiveRender = () => {
        getEngine().setInputDefault(nodeId, portName, value);
        get().triggerAffectedViewers([nodeId]);
      };

      if (kernel.liveRenderRaf === null) {
        kernel.liveRenderRaf = requestAnimationFrame(() => {
          kernel.liveRenderRaf = null;
          kernel.pendingLiveRender?.();
          kernel.pendingLiveRender = null;
        });
      }

      if (kernel.idlePreviewTimer) clearTimeout(kernel.idlePreviewTimer);
      kernel.idlePreviewTimer = setTimeout(() => {
        kernel.idlePreviewTimer = null;
        set({ previewScale: 1 });
        get().triggerAffectedViewers([nodeId]);
      }, useSettingsStore.getState().previewIdleDelay);
    },

    setInputDefaultCommit: async (nodeId, portName, value) => {
      if (kernel.preCommitSnapshot) {
        if (!kernel.preCommitSnapshot.engineState) {
          kernel.preCommitSnapshot.engineState = await getEngine().exportGraph();
        }
        kernel.undoStack.push(kernel.preCommitSnapshot);
        if (kernel.undoStack.length > useSettingsStore.getState().maxUndoSteps) kernel.undoStack.shift();
        kernel.redoStack.length = 0;
        kernel.preCommitSnapshot = null;
      }

      const newNodes = new Map(get().nodes);
      const node = newNodes.get(nodeId);
      if (node) {
        node.inputDefaults = { ...node.inputDefaults, [portName]: value };
        newNodes.set(nodeId, { ...node });
        set({ nodes: newNodes, canUndo: kernel.undoStack.length > 0, canRedo: false, previewScale: 1, dirty: true });
      } else {
        set({ previewScale: 1 });
      }

      if (kernel.liveRenderRaf !== null) {
        cancelAnimationFrame(kernel.liveRenderRaf);
        kernel.liveRenderRaf = null;
        kernel.pendingLiveRender = null;
      }

      if (kernel.idlePreviewTimer) {
        clearTimeout(kernel.idlePreviewTimer);
        kernel.idlePreviewTimer = null;
      }

      await getEngine().setInputDefault(nodeId, portName, value);
      get().triggerAffectedViewers([nodeId]);
    },
  };
};
