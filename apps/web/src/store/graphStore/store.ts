import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  NodeInstance,
  Connection,
  NodeSpec,
  PortSpec,
  ParamValue,
  ViewerResult,
  EditingContext,

  Frame,
  TransactionOptions,
  TransactionResult,
  TransactionOrigin,
  TransactionDiagnostics,
} from '../types';
import type { JobProgress, SequenceInfo, VideoInfo, ColorManagementInfo, EditValidationError } from '../../engine/bridge';
import { sequenceFrameManager } from '../../engine/sequenceFrameManager';
import { parseEngineError } from '../../engine/engineError';
import type { EngineError } from '../../engine/engineError';
import { useSettingsStore } from '../settingsStore';
import {
  kernel,
  cloneEditingStack,
  createEngine,
  downscaleRenderResult,
  getEngine,
  nextRenderGeneration,
} from './kernel';
import type { UndoSnapshot } from './kernel';
import type { FramesSlice } from './slices/framesSlice';
import { createFramesSlice } from './slices/framesSlice';
import type { SelectionSlice } from './slices/selectionSlice';
import { createSelectionSlice } from './slices/selectionSlice';
import type { BatchExportSlice } from './slices/batchExportSlice';
import { createBatchExportSlice } from './slices/batchExportSlice';
import type { SequenceVideoSlice } from './slices/sequenceVideoSlice';
import { createSequenceVideoSlice } from './slices/sequenceVideoSlice';
import type { ProjectSlice } from './slices/projectSlice';
import { createProjectSlice } from './slices/projectSlice';
import type { AssetsSlice } from './slices/assetsSlice';
import { createAssetsSlice } from './slices/assetsSlice';
import type { ColorSlice } from './slices/colorSlice';
import { createColorSlice } from './slices/colorSlice';
import type { AiSlice } from './slices/aiSlice';
import { createAiSlice } from './slices/aiSlice';
import type { GraphSlice } from './slices/graphSlice';
import { createGraphSlice } from './slices/graphSlice';

export { ADD_INPUT_PORT, ADD_OUTPUT_PORT, getEngine } from './kernel';

export interface GraphState {
  nodes: Map<string, NodeInstance>;
  connections: Connection[];
  selectedNodeIds: Set<string>;
  frames: Map<string, Frame>;
  selectedFrameId: string | null;
  nodeSpecs: NodeSpec[];
  engineReady: boolean;
  renderResults: Map<string, ViewerResult>;
  lastError: EngineError | null;
  canUndo: boolean;
  canRedo: boolean;
  currentFrame: number;
  renderProgress: JobProgress | null;
  isRendering: boolean;
  previewScale: number;
  dirty: boolean;
  fitViewRequestId: number;

  hasSequenceNodes: boolean;
  sequenceLength: number;
  sequenceStart: number;
  sequenceInfoMap: Map<string, SequenceInfo | VideoInfo>;

  isPlaying: boolean;
  fps: number;
  loopPlayback: boolean;
  playbackFps: number | null;

  nodeTimings: Map<string, number>;
  nodeErrors: Map<string, EngineError>;
  aiNodeStatuses: Record<string, string>;
  aiNodeStale: Record<string, boolean>;
  refreshAiNodeStale: () => void;

  initEngine: () => Promise<void>;
  addNode: (typeId: string, position: { x: number; y: number }) => Promise<string>;
  removeNode: (id: string) => Promise<void>;
  connect: (fromNode: string, fromPort: string, toNode: string, toPort: string) => Promise<void>;
  disconnect: (connectionId: string) => Promise<void>;
  setParam: (nodeId: string, key: string, value: ParamValue) => Promise<void>;
  setDslHandle: (nodeId: string, handle: string) => void;
  setParamLive: (nodeId: string, key: string, value: ParamValue) => Promise<void>;
  setParamCommit: (nodeId: string, key: string, value: ParamValue) => Promise<void>;
  setInputDefault: (nodeId: string, portName: string, value: ParamValue) => Promise<void>;
  setInputDefaultLive: (nodeId: string, portName: string, value: ParamValue) => Promise<void>;
  setInputDefaultCommit: (nodeId: string, portName: string, value: ParamValue) => Promise<void>;
  setPosition: (nodeId: string, position: { x: number; y: number }) => void;
  selectNode: (id: string | null) => void;
  setSelectedNodes: (ids: string[]) => void;
  toggleMuteSelected: () => Promise<void>;
  addFrame: (position: { x: number; y: number }, size?: { width: number; height: number }, label?: string) => string;
  removeFrame: (id: string) => void;
  updateFrame: (id: string, updates: Partial<Omit<Frame, 'id'>>) => void;
  frameSelectedNodes: (nodeSizes?: Map<string, { width: number; height: number }>) => string | null;
  selectFrame: (id: string | null) => void;
  loadImageFile: (nodeId: string, file: File) => void;
  loadVideoFile: (nodeId: string, path: string) => Promise<VideoInfo | null>;
  getImageData: (nodeId: string) => Promise<Uint8Array | null>;
  loadPaletteFile: (nodeId: string, file: File) => void;
  triggerRender: (viewerNodeId: string) => void;
  newProject: () => Promise<void>;
  saveProject: () => void;
  loadProject: (file: File) => void;
  loadProjectFromPath?: () => void;
  exportImage: (nodeId: string) => void;
  setCurrentFrame: (frame: number) => void;
  setSequenceDirectory: (nodeId: string, directory: string) => Promise<void>;
  setSequenceFiles: (nodeId: string, files: File[]) => Promise<void>;
  loadBatchFiles: (nodeId: string, files: File[]) => Promise<void>;
  renderSequence: (nodeId: string) => Promise<void>;
  renderBatch: (nodeId: string) => Promise<void>;
  renderVideo: (nodeId: string) => Promise<void>;
  cancelRender: () => Promise<void>;
  compileScriptNode: (nodeId: string, manifestJson: string) => Promise<NodeSpec>;
  undo: () => void;
  redo: () => void;
  pushUndo: () => Promise<void>;

  play: () => void;
  pause: () => void;
  togglePlayback: () => void;
  stepForward: () => void;
  stepBackward: () => void;
  goToStart: () => void;
  goToEnd: () => void;
  setFps: (fps: number) => void;
  setLoopPlayback: (loop: boolean) => void;
  recomputeSequenceState: () => void;
  pushSequenceFrames: (frame: number) => Promise<void>;
  renderAllViewersAsync: () => Promise<void>;
  triggerAllViewers: () => void;
  triggerAffectedViewers: (changedNodeIds: string[]) => void;

  editingStack: EditingContext[];
  enterGroup: (groupNodeId: string) => Promise<void>;
  exitGroup: () => void;
  navigateToBreadcrumb: (index: number) => Promise<void>;
  createGroup: (nodeIds: string[], name?: string) => Promise<void>;
  ungroupNode: (groupNodeId: string) => Promise<void>;
  renameGroup: (groupNodeId: string, newName: string) => Promise<void>;
  isInsideGroup: () => boolean;
  updateGroupInterface: (inputs: PortSpec[] | null, outputs: PortSpec[] | null) => Promise<void>;
  importCustomNodes: (json: string) => Promise<void>;
  exportGroupAsPackage: (groupDefId: string) => Promise<void>;
  setAiApiKey: (provider: string, key: string) => Promise<void>;
  isAiConfigured: () => Promise<boolean>;
  runAiNode: (nodeId: string) => Promise<void>;

  colorManagement: ColorManagementInfo | null;
  setDisplayView: (display: string, view: string) => Promise<void>;
  getViewsForDisplay: (display: string) => Promise<string[]>;
  loadColorManagementInfo: () => Promise<void>;
  setProjectFormat: (width: number, height: number) => Promise<void>;
  linkToViewer: (nodeId: string, outputIndex?: number) => Promise<void>;

  aiActionInProgress: boolean;
  beginAiAction: () => Promise<void>;
  endAiAction: () => void;
  graphRevision: number;
  lastTransactionOrigin: TransactionOrigin | null;
  editTransaction: (
    options: TransactionOptions,
    mutate: () => Promise<void> | void,
  ) => Promise<TransactionResult>;
  flushRender: () => Promise<Map<string, EngineError>>;
  validateEdits: (editsJson: string) => EditValidationError[];
  typesCompatible: (fromType: string, toType: string) => boolean;
}

type CoreSlice = Omit<
  GraphState,
  keyof FramesSlice
  | keyof SelectionSlice
  | keyof BatchExportSlice
  | keyof SequenceVideoSlice
  | keyof ProjectSlice
  | keyof AssetsSlice
  | keyof ColorSlice
  | keyof AiSlice
  | keyof GraphSlice
>;

const createCoreSlice: StateCreator<GraphState, [['zustand/devtools', never]], [], CoreSlice> = (set, get) => {
    const triggerAllViewers = () => {
      if (kernel.renderSuspendCount > 0) {
        kernel.renderNeededWhileSuspended = true;
        return;
      }
      const { nodes } = get();
      for (const [viewerId, node] of nodes) {
        if (node.typeId === 'viewer' || node.typeId === 'export_image' || node.typeId === 'export_image_sequence' || node.typeId === 'export_video') {
          get().triggerRender(viewerId);
        }
      }
    };

    /**
     * Trigger re-render only for viewers affected by changes to the given node(s).
     * Falls back to triggerAllViewers() if the engine doesn't support selective
     * invalidation or if an error occurs.
     */
    const triggerAffectedViewers = (changedNodeIds: string[]) => {
      if (kernel.renderSuspendCount > 0) {
        kernel.renderNeededWhileSuspended = true;
        return;
      }
      const eng = getEngine();
      if (!eng.getAffectedViewers) {
        triggerAllViewers();
        return;
      }
      try {
        const affectedSet = new Set<string>();
        for (const nodeId of changedNodeIds) {
          const viewers = eng.getAffectedViewers(nodeId);
          // Handle both sync (string[]) and async (Promise<string[]>) returns
          if (Array.isArray(viewers)) {
            for (const v of viewers) affectedSet.add(v);
          } else {
            // Async path — fall back to all viewers for now
            triggerAllViewers();
            return;
          }
        }
        for (const viewerId of affectedSet) {
          get().triggerRender(viewerId);
        }
      } catch (e) {
        console.warn('Selective viewer invalidation failed, falling back to all viewers:', e);
        triggerAllViewers();
      }
    };

    const updateNodeTimings = () => {
      const timings = getEngine().getLastRenderTimings?.();
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

    const pushSequenceFrames = async (frame: number) => {
      const eng = getEngine();
      if (!eng.loadSequenceFrameData) return;
      const { nodes } = get();
      for (const [nodeId, node] of nodes) {
        if (node.typeId !== 'load_image_sequence') continue;
        if (!sequenceFrameManager.hasSequence(nodeId)) continue;
        const data = await sequenceFrameManager.getFrameData(nodeId, frame);
        if (data) {
          await eng.loadSequenceFrameData(nodeId, frame, data);
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
          if (node.typeId !== 'viewer') continue;
          try {
            const result = await Promise.resolve(getEngine().renderViewer(viewerId, frame));
            if (result) {
              const scaled = await downscaleRenderResult(result, scale);
              newResults.set(viewerId, scaled);
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
    const collectImageData = async (): Promise<Map<string, Uint8Array>> => {
      const imgData = new Map<string, Uint8Array>();
      for (const [nodeId, node] of get().nodes) {
        if (node.typeId !== 'load_image') continue;
        try {
          const bytes = await get().getImageData(nodeId);
          if (bytes) imgData.set(nodeId, bytes);
        } catch {
          // Node may not have image loaded yet
        }
      }
      return imgData;
    };

    const captureSnapshot = async (): Promise<UndoSnapshot> => ({
      engineState: await getEngine().exportGraph(),
      nodes: new Map(get().nodes),
      connections: [...get().connections],
      frames: new Map(get().frames),
      editingStack: cloneEditingStack(get().editingStack),
      imageData: await collectImageData(),
      sequenceInfoMap: new Map(get().sequenceInfoMap),
    });

    const pushUndo = async () => {
      if (get().aiActionInProgress) return;
      const snapshot = await captureSnapshot();
      kernel.undoStack.push(snapshot);
      if (kernel.undoStack.length > useSettingsStore.getState().maxUndoSteps) kernel.undoStack.shift();
      kernel.redoStack.length = 0;
      set({ canUndo: kernel.undoStack.length > 0, canRedo: false, dirty: true });
    };

    const restoreSnapshot = async (snapshot: UndoSnapshot) => {
      await getEngine().importGraph(snapshot.engineState);

      const eng = getEngine();
      for (const [nodeId, bytes] of snapshot.imageData) {
        try {
          await Promise.resolve(eng.loadImageData(nodeId, bytes));
        } catch {
          // Node may not exist in this snapshot state
        }
      }

      set({
        nodes: new Map(snapshot.nodes),
        connections: [...snapshot.connections],
        frames: new Map(snapshot.frames),
        editingStack: cloneEditingStack(snapshot.editingStack),
        selectedNodeIds: new Set(),
        selectedFrameId: null,
        renderResults: new Map(),
        canUndo: kernel.undoStack.length > 0,
        canRedo: kernel.redoStack.length > 0,
        sequenceInfoMap: new Map(snapshot.sequenceInfoMap),
      });

      get().recomputeSequenceState();

      for (const [nodeId, node] of snapshot.nodes) {
        if (node.typeId !== 'load_image_sequence') continue;
        if (sequenceFrameManager.hasSequence(nodeId)) {
          const frame = get().currentFrame;
          const data = await sequenceFrameManager.getFrameData(nodeId, frame);
          if (data && eng.loadSequenceFrameData) {
            await eng.loadSequenceFrameData(nodeId, frame, data);
          }
        } else if (eng.setSequenceDirectory && snapshot.sequenceInfoMap.has(nodeId)) {
          const dirParam = node.params['directory'];
          if (dirParam && 'String' in dirParam && dirParam.String) {
            try {
              await eng.setSequenceDirectory(nodeId, dirParam.String);
            } catch {
              // Directory may no longer exist
            }
          }
        }
      }

      triggerAllViewers();
    };

    return {
      renderResults: new Map(),
      canUndo: false,
      canRedo: false,
      nodeTimings: new Map(),
      nodeErrors: new Map(),

      initEngine: async () => {
        kernel.engine = await createEngine();
        const specs = await kernel.engine.listNodeTypes();
        set({ engineReady: true, nodeSpecs: specs });

        const settings = useSettingsStore.getState();

        if (settings.aiApiKey && kernel.engine.setAiApiKey) {
          await kernel.engine.setAiApiKey('replicate', settings.aiApiKey);
        }

        if (kernel.engine.setProjectFormat) {
          await kernel.engine.setProjectFormat(settings.projectWidth, settings.projectHeight);
        }

        if (kernel.engine.getColorManagementInfo) {
          try {
            const info = await kernel.engine.getColorManagementInfo();
            set({ colorManagement: info });
          } catch (e) {
            console.warn('Failed to load color management info:', e);
          }
        }
        get().refreshAiNodeStale();
      },

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
          collectImageData().then(data => {
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
            triggerAffectedViewers([nodeId]);
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
          triggerAffectedViewers([nodeId]);
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
          triggerAffectedViewers([nodeId]);
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
          collectImageData().then(data => {
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
          triggerAffectedViewers([nodeId]);
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
          triggerAffectedViewers([nodeId]);
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
        triggerAffectedViewers([nodeId]);
      },

      triggerRender: (viewerNodeId) => {
        const frame = get().currentFrame;
        const scale = get().previewScale;
        const generation = nextRenderGeneration(viewerNodeId);
        kernel.renderLock = kernel.renderLock.then(async () => {
          if (kernel.renderGenerations.get(viewerNodeId) !== generation) return;
          try {
            const result = await Promise.resolve(getEngine().renderViewer(viewerNodeId, frame));
            const scaled = result ? await downscaleRenderResult(result, scale) : null;
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



      undo: () => {
        const snapshot = kernel.undoStack.pop();
        if (!snapshot) return;
        captureSnapshot().then(async current => {
          kernel.redoStack.push(current);
          await restoreSnapshot(snapshot);
        });
      },

      redo: () => {
        const snapshot = kernel.redoStack.pop();
        if (!snapshot) return;
        captureSnapshot().then(async current => {
          kernel.undoStack.push(current);
          await restoreSnapshot(snapshot);
        });
      },

      pushUndo,
      pushSequenceFrames,
      renderAllViewersAsync,
      triggerAllViewers,
      triggerAffectedViewers,


      graphRevision: 0,
      lastTransactionOrigin: null,
      flushRender: async () => {
        if (kernel.renderNeededWhileSuspended) {
          kernel.renderNeededWhileSuspended = false;
          triggerAllViewers();
        }
        await kernel.renderLock;
        const { nodeErrors } = get();
        return new Map(nodeErrors);
      },

      validateEdits: (editsJson: string): EditValidationError[] => {
        const eng = getEngine();
        if (!eng.validateEdits) return [];
        const result = eng.validateEdits(editsJson);
        // validateEdits is sync for WASM, but interface allows Promise
        if (result instanceof Promise) {
          throw new Error('validateEdits must be synchronous');
        }
        return result;
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
          || (fromType === 'Field' && (toType === 'Image' || toType === 'Mask'))
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

        let snapshot: UndoSnapshot | null = null;
        if (!options.suppressUndo) {
          snapshot = await captureSnapshot();
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

export const useGraphStore = create<GraphState>()(
  devtools((...args) => ({
    ...createCoreSlice(...args),
    ...createProjectSlice(...args),
    ...createFramesSlice(...args),
    ...createSelectionSlice(...args),
    ...createBatchExportSlice(...args),
    ...createSequenceVideoSlice(...args),
    ...createAssetsSlice(...args),
    ...createColorSlice(...args),
    ...createAiSlice(...args),
    ...createGraphSlice(...args),
  }))
);

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const debugWindow = window as Window & { __compositorStore?: typeof useGraphStore };
  debugWindow.__compositorStore = useGraphStore;
}
