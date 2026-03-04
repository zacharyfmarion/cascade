// ---------------------------------------------------------------------------
// store.ts — Composition shell only. Do NOT add logic here.
//
// All store actions and state belong in slice files under ./slices/.
// This file should only contain:
//   1. The GraphState interface
//   2. The CoreSlice (initEngine only)
//   3. The useGraphStore composition (slice spreads)
//
// To add a new store action: create or extend a slice in ./slices/.
// An ESLint max-lines rule enforces this — CI will fail if this file grows.
// ---------------------------------------------------------------------------

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
} from '../types';
import type { JobProgress, SequenceInfo, VideoInfo, ColorManagementInfo, EditValidationError } from '../../engine/bridge';
import type { NodeInterfaceChange } from '../../engine/bridge';
import type { EngineError } from '../../engine/engineError';
import { useSettingsStore } from '../settingsStore';
import {
  kernel,
  createEngine,
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
import type { UndoSlice } from './slices/undoSlice';
import { createUndoSlice } from './slices/undoSlice';
import type { RenderSlice } from './slices/renderSlice';
import { createRenderSlice } from './slices/renderSlice';
import type { LiveParamsSlice } from './slices/liveParamsSlice';
import { createLiveParamsSlice } from './slices/liveParamsSlice';
import type { ToastSlice, Toast, ToastKind } from './slices/toastSlice';

import { createToastSlice } from './slices/toastSlice';



export { ADD_INPUT_PORT, ADD_OUTPUT_PORT, getEngine } from './kernel';

export interface GraphState {
  nodes: Map<string, NodeInstance>;
  connections: Connection[];
  selectedNodeIds: Set<string>;
  frames: Map<string, Frame>;
  selectedFrameId: string | null;
  nodeSpecs: NodeSpec[];
  nodeSpecsById: Map<string, NodeSpec>;
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
  addNode: (typeId: string, position: { x: number; y: number }, initialFile?: File) => Promise<string>;
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
  exportExr: (nodeId: string) => void;
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
  captureSnapshot: () => Promise<UndoSnapshot>;
  collectImageData: () => Promise<Map<string, Uint8Array>>;

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
  applyNodeInterfaceChange: (nodeId: string, change: NodeInterfaceChange) => void;
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

  toasts: Toast[];
  pushToast: (kind: ToastKind, title: string, message?: string) => void;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
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
  | keyof UndoSlice
  | keyof RenderSlice
  | keyof LiveParamsSlice
  | keyof ToastSlice
>;


const createCoreSlice: StateCreator<GraphState, [['zustand/devtools', never]], [], CoreSlice> = (set, get) => {
    return {
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
    ...createUndoSlice(...args),
    ...createRenderSlice(...args),
    ...createLiveParamsSlice(...args),
    ...createGraphSlice(...args),
    ...createToastSlice(...args),
  }))
);


if (import.meta.env.DEV && typeof window !== 'undefined') {
  const debugWindow = window as Window & { __cascadeStore?: typeof useGraphStore };
  debugWindow.__cascadeStore = useGraphStore;
}
