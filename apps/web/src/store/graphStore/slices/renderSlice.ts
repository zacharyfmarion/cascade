import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type {
  ViewerResult,
  TransactionOptions,
  TransactionResult,
  TransactionOrigin,
  TransactionDiagnostics,
} from '../../types';
import type { EditValidationError } from '../../../engine/bridge';
import type { EngineError } from '../../../engine/engineError';
import { parseEngineError } from '../../../engine/engineError';
import { sequenceFrameManager } from '../../../engine/sequenceFrameManager';
import { useSettingsStore } from '../../settingsStore';
import {
  kernel,
  annotateEnginePreviewResult,
  getEffectivePreviewScaleForResult,
  getEngine,
  nextRenderGeneration,
} from '../kernel';

const VIEWER_NODE_TYPES = new Set(['viewer', 'compare_viewer', 'export_image', 'export_image_sequence', 'export_video']);
const PANEL_VIEWER_NODE_TYPES = new Set(['viewer', 'compare_viewer']);

// ---------------------------------------------------------------------------
// Slice interface
// ---------------------------------------------------------------------------

export interface RenderSliceState {
  renderResults: Map<string, ViewerResult>;
  nodeTimings: Map<string, number>;
  nodeErrors: Map<string, EngineError>;
  graphRevision: number;
  lastTransactionOrigin: TransactionOrigin | null;
}

export interface RenderSliceActions {
  triggerRender: (viewerNodeId: string, previewScaleOverride?: number) => void;
  triggerAllViewers: (previewScaleOverride?: number) => void;
  triggerAffectedViewers: (changedNodeIds: string[], previewScaleOverride?: number) => void | Promise<void>;
  renderAllViewersAsync: () => Promise<void>;
  renderViewerFrame: (viewerNodeId: string, frame: number, previewScale?: number) => Promise<ViewerResult | null>;
  pushSequenceFrames: (frame: number) => Promise<void>;
  prefetchSequenceFrames: (startFrame: number, count: number) => void;
  flushRender: () => Promise<Map<string, EngineError>>;
  editTransaction: (
    options: TransactionOptions,
    mutate: () => Promise<void> | void,
  ) => Promise<TransactionResult>;
  validateEdits: (editsJson: string) => EditValidationError[] | Promise<EditValidationError[]>;
  typesCompatible: (fromType: string, toType: string) => boolean;
}

export type RenderSlice = RenderSliceState & RenderSliceActions;

// ---------------------------------------------------------------------------
// Slice creator
// ---------------------------------------------------------------------------

export const createRenderSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  RenderSlice
> = (set, get) => {
  // -- internal helpers -----------------------------------------------------

  const updateNodeTimings = async () => {
    const timings = await Promise.resolve(getEngine().getLastRenderTimings?.());
    if (timings) {
      const prev = get().nodeTimings;
      const merged = new Map(prev);
      for (const [nodeId, value] of Object.entries(timings)) {
        // Only update if the new value is non-zero (i.e. not a cached/skipped result),
        // so the badge keeps showing the last real execution time.
        if (value > 0) {
          merged.set(nodeId, value);
        }
      }
      set({ nodeTimings: merged });
    }
  };

  const renderViewerForCurrentContext = async (
    viewerNodeId: string,
    frame: number,
    previewScale: number,
  ): Promise<ViewerResult | null> => {
    const editingStack = get().editingStack;
    if (editingStack.length > 1) {
      const ctx = editingStack[editingStack.length - 1];
      const eng = getEngine();
      if (!ctx.groupNodeId || !eng.renderInternalViewer) {
        throw new Error('Internal viewer rendering not supported by this engine');
      }
      return Promise.resolve(
        eng.renderInternalViewer(ctx.groupNodeId, viewerNodeId, frame, previewScale),
      );
    }
    return Promise.resolve(getEngine().renderViewer(viewerNodeId, frame, previewScale));
  };

  // -- public slice ---------------------------------------------------------

  const triggerAllViewers = (previewScaleOverride?: number) => {
    if (kernel.renderSuspendCount > 0) {
      kernel.renderNeededWhileSuspended = true;
      return;
    }
    const { nodes } = get();
    for (const [viewerId, node] of nodes) {
      if (VIEWER_NODE_TYPES.has(node.typeId)) {
        get().triggerRender(viewerId, previewScaleOverride);
      }
    }
  };

  const triggerAffectedViewers = async (changedNodeIds: string[], previewScaleOverride?: number) => {
    if (kernel.renderSuspendCount > 0) {
      kernel.renderNeededWhileSuspended = true;
      return;
    }
    if (get().editingStack.length > 1) {
      triggerAllViewers(previewScaleOverride);
      return;
    }
    const eng = getEngine();
    if (!eng.getAffectedViewers) {
      triggerAllViewers(previewScaleOverride);
      return;
    }
    try {
      const affectedSet = new Set<string>();
      for (const nodeId of changedNodeIds) {
        const viewersOrPromise = eng.getAffectedViewers(nodeId);
        const viewers = Array.isArray(viewersOrPromise)
          ? viewersOrPromise
          : await viewersOrPromise;
        for (const v of viewers) affectedSet.add(v);
      }
      for (const viewerId of affectedSet) {
        get().triggerRender(viewerId, previewScaleOverride);
      }
    } catch (e) {
      console.warn('Selective viewer invalidation failed, falling back to all viewers:', e);
      triggerAllViewers(previewScaleOverride);
    }
  };

  const pushSequenceFrames = async (frame: number) => {
    const eng = getEngine();
    if (!eng.prepareSequenceFrame && !eng.loadSequenceFrameData) return;
    const { nodes } = get();
    for (const [nodeId, node] of nodes) {
      if (node.typeId !== 'load_image_sequence') continue;
      if (eng.prepareSequenceFrame) {
        const change = await eng.prepareSequenceFrame(nodeId, frame);
        if (change) {
          get().applyNodeInterfaceChange(nodeId, change);
        }
        continue;
      }
      if (sequenceFrameManager.hasSequence(nodeId) && eng.loadSequenceFrameData) {
        const data = await sequenceFrameManager.getFrameData(nodeId, frame);
        if (!data) continue;
        const change = await eng.loadSequenceFrameData(nodeId, frame, data);
        get().applyNodeInterfaceChange(nodeId, change);
      }
    }
  };

  const prefetchSequenceFrames = (startFrame: number, count: number) => {
    const eng = getEngine();
    const { nodes } = get();
    for (const [nodeId, node] of nodes) {
      if (node.typeId !== 'load_image_sequence') continue;
      if (eng.prefetchSequenceFrames) {
        void eng.prefetchSequenceFrames(nodeId, startFrame, count);
      } else if (sequenceFrameManager.hasSequence(nodeId)) {
        void sequenceFrameManager.prefetchFrames(nodeId, startFrame, count);
      }
    }
  };

  const renderAllViewersAsync = async (): Promise<void> => {
    kernel.renderLock = kernel.renderLock.then(async () => {
      const { nodes } = get();
      const frame = get().currentFrame;
      const scale = get().previewScale;

      await pushSequenceFrames(frame);

      const newResults = new Map(get().renderResults);
      let changed = false;
      for (const [viewerId, node] of nodes) {
        if (!PANEL_VIEWER_NODE_TYPES.has(node.typeId)) continue;
        try {
          const previous = get().renderResults.get(viewerId);
          const renderScale = getEffectivePreviewScaleForResult(scale, previous);
          const result = await renderViewerForCurrentContext(viewerId, frame, renderScale);
          if (result) {
            newResults.set(viewerId, annotateEnginePreviewResult(result, renderScale, previous));
            changed = true;
          }
        } catch (e) { const error = parseEngineError(e); if (error.nodeId) { const errs = new Map(get().nodeErrors); errs.set(error.nodeId, error); set({ nodeErrors: errs, lastError: error }); } else { set({ lastError: error }); } }
      }
      if (changed) {
        set({ renderResults: newResults, lastError: null, nodeErrors: new Map() });
        updateNodeTimings();
      }
      get().refreshAiNodeStale();
    });
    await kernel.renderLock;
  };

  return {
    renderResults: new Map(),
    nodeTimings: new Map(),
    nodeErrors: new Map(),
    graphRevision: 0,
    lastTransactionOrigin: null,

    triggerRender: (viewerNodeId, previewScaleOverride) => {
      const frame = get().currentFrame;
      const scale = previewScaleOverride ?? get().previewScale;
      const generation = nextRenderGeneration(viewerNodeId);
      kernel.renderLock = kernel.renderLock.then(async () => {
        if (kernel.renderGenerations.get(viewerNodeId) !== generation) return;
        try {
          await pushSequenceFrames(frame);
          if (kernel.renderGenerations.get(viewerNodeId) !== generation) return;
          const previous = get().renderResults.get(viewerNodeId);
          const renderScale = getEffectivePreviewScaleForResult(
            scale,
            previous,
            previewScaleOverride !== undefined,
          );
          const result = await renderViewerForCurrentContext(viewerNodeId, frame, renderScale);
          const scaled = result ? annotateEnginePreviewResult(result, renderScale, previous) : null;
          if (scaled && kernel.renderGenerations.get(viewerNodeId) === generation) {
            const newResults = new Map(get().renderResults);
            newResults.set(viewerNodeId, scaled);
            set({ renderResults: newResults, lastError: null, nodeErrors: new Map() });
            updateNodeTimings();
          }
        } catch (e) {
          const error = parseEngineError(e);
          if (error.code !== 'MISSING_INPUT') {
            if (error.nodeId) {
              const errs = new Map(get().nodeErrors);
              errs.set(error.nodeId, error);
              set({ nodeErrors: errs, lastError: error });
            } else {
              set({ lastError: error });
            }
          }
        }
      });
    },

    triggerAllViewers,
    triggerAffectedViewers,
    pushSequenceFrames,
    prefetchSequenceFrames,
    renderAllViewersAsync,

    renderViewerFrame: async (viewerNodeId, frame, previewScale = 1) => {
      let rendered: ViewerResult | null = null;
      const renderJob = kernel.renderLock.then(async () => {
        await pushSequenceFrames(frame);
        rendered = await renderViewerForCurrentContext(viewerNodeId, frame, previewScale);
      });
      kernel.renderLock = renderJob.catch(() => undefined);
      await renderJob;
      return rendered;
    },

    flushRender: async () => {
      if (kernel.renderNeededWhileSuspended) {
        kernel.renderNeededWhileSuspended = false;
        triggerAllViewers();
      }
      await kernel.renderLock;
      const { nodeErrors } = get();
      return new Map(nodeErrors);
    },

    validateEdits: (editsJson: string): EditValidationError[] | Promise<EditValidationError[]> => {
      const eng = getEngine();
      if (!eng.validateEdits) return [];
      return eng.validateEdits(editsJson);
    },

    typesCompatible: (fromType: string, toType: string): boolean => {
      const eng = getEngine();
      if (eng.typesCompatible) {
        const result = eng.typesCompatible(fromType, toType);
        if (result instanceof Promise) {
          throw new Error('typesCompatible must be synchronous');
        }
        return result;
      }
      // Fallback if engine doesn't support typesCompatible
      return fromType === toType
        || toType === 'Any'
        || fromType === 'Any'
        || (fromType === 'Field' && (toType === 'Image' || toType === 'Mask'))
        || ((fromType === 'Image' || fromType === 'Mask') && (toType === 'Image' || toType === 'Mask'))
        || (fromType === 'Int' && toType === 'Float')
        || (fromType === 'Float' && toType === 'Int');
    },

    editTransaction: async (options, mutate) => {
      const diagnostics: TransactionDiagnostics = {
        parseErrors: [],
        validationErrors: [],
        mutationErrors: [],
        evalErrors: [],
      };

      let snapshot = null;
      if (!options.suppressUndo) {
        snapshot = await get().captureSnapshot();
      }

      kernel.renderSuspendCount++;
      kernel.graphRevision++;
      set({
        lastTransactionOrigin: options.origin,
        graphRevision: kernel.graphRevision,
      });

      let success = true;
      try {
        await mutate();
      } catch (err) {
        success = false;
        diagnostics.mutationErrors.push({
          message: err instanceof Error ? err.message : String(err),
          severity: 'error',
        });
      }

      kernel.renderSuspendCount--;

      if (options.awaitRender && kernel.renderSuspendCount <= 0) {
        kernel.renderSuspendCount = 0;
        if (kernel.renderNeededWhileSuspended) {
          kernel.renderNeededWhileSuspended = false;
          triggerAllViewers();
        }
        await kernel.renderLock;
        const { nodeErrors, lastError } = get();
        for (const [nodeId, error] of nodeErrors) {
          diagnostics.evalErrors.push({
            message: error.message,
            severity: 'error',
            nodeId,
            nodeType: error.nodeType,
          });
        }
        if (lastError && !lastError.nodeId) {
          diagnostics.evalErrors.push({
            message: lastError.message,
            severity: 'error',
          });
        }
        if (diagnostics.evalErrors.length > 0) {
          success = false;
        }
      } else if (kernel.renderSuspendCount <= 0) {
        kernel.renderSuspendCount = 0;
        if (kernel.renderNeededWhileSuspended) {
          kernel.renderNeededWhileSuspended = false;
          triggerAllViewers();
        }
      }

      if (snapshot && !options.suppressUndo) {
        kernel.undoStack.push(snapshot);
        if (kernel.undoStack.length > useSettingsStore.getState().maxUndoSteps) kernel.undoStack.shift();
        kernel.redoStack.length = 0;
        set({ canUndo: kernel.undoStack.length > 0, canRedo: false, dirty: true });
      }

      return {
        success,
        diagnostics,
        graphRevision: kernel.graphRevision,
      };
    },
  };
};
