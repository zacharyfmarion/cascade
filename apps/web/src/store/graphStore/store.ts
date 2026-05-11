import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  Connection, DslShadowDocument, EditingContext, Frame, NodeInstance, NodeSpec, ParamValue, PortSpec,
  SerializableGroupDefinition, TransactionOptions, TransactionOrigin, TransactionResult, ViewerResult,
} from '../types';
import type { JobProgress, SequenceInfo, BatchInfo, VideoInfo, ColorManagementInfo, EditValidationError } from '../../engine/bridge';
import type { NodeInterfaceChange } from '../../engine/bridge';
import type { EngineError } from '../../engine/engineError';
import { useSettingsStore } from '../settingsStore';
import { isDesktopRuntime } from '../../platform/runtime';
import { createEngine, kernel } from './kernel';
import type { UndoSnapshot } from './kernel';
import { createFramesSlice, type FramesSlice } from './slices/framesSlice';
import { createSelectionSlice, type SelectionSlice } from './slices/selectionSlice';
import { createBatchExportSlice, type BatchExportSlice } from './slices/batchExportSlice';
import { createSequenceVideoSlice, type SequenceVideoSlice } from './slices/sequenceVideoSlice';
import { createMediaIteratorSlice, type MediaIteratorInfo, type MediaIteratorSlice } from './slices/mediaIteratorSlice';
import { createProjectSlice, type AssetStoragePromptAction, type PendingProjectAction, type ProjectSlice, type UnsavedChangesChoice } from './slices/projectSlice';
import type { ProjectAssetRecord, ProjectAssetStorage } from './assetReferences';
import { createAssetsSlice, type AssetsSlice } from './slices/assetsSlice';
import { createColorSlice, type ColorSlice } from './slices/colorSlice';
import { createAiSlice, type AiSlice } from './slices/aiSlice';
import { createDslSlice, type DslSlice } from './slices/dslSlice';
import { createGraphSlice, type GraphSlice } from './slices/graphSlice';
import { createUndoSlice, type UndoSlice } from './slices/undoSlice';
import { createRenderSlice, type RenderSlice } from './slices/renderSlice';
import { createLiveParamsSlice, type LiveParamsSlice } from './slices/liveParamsSlice';
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
  currentProjectPath: string | null;
  currentProjectName: string;
  projectSessionRevision: number;
  unsavedChangesPrompt: PendingProjectAction | null;
  currentProjectAssetStorage: ProjectAssetStorage | null;
  assetStoragePrompt: AssetStoragePromptAction | null;
  projectAssets: Record<string, ProjectAssetRecord>;
  fitViewRequestId: number;
  hasSequenceNodes: boolean;
  sequenceLength: number;
  sequenceStart: number;
  sequenceInfoMap: Map<string, SequenceInfo | VideoInfo>;
  batchInfoMap: Map<string, BatchInfo>;
  mediaIteratorInfoMap: Map<string, MediaIteratorInfo>;
  activeTransportSourceId: string | null;
  isPlaying: boolean;
  fps: number;
  loopPlayback: boolean;
  playbackFps: number | null;
  nodeTimings: Map<string, number>;
  nodeErrors: Map<string, EngineError>;
  dslShadow: DslShadowDocument | null;
  customGroupDefinitions: SerializableGroupDefinition[];
  aiNodeStatuses: Record<string, string>;
  aiNodeStale: Record<string, boolean>;
  refreshAiNodeStale: () => void;

  initEngine: () => Promise<void>;
  addNode: (typeId: string, position: { x: number; y: number }, initialFile?: File) => Promise<string>;
  removeNode: (id: string) => Promise<void>;
  connect: (fromNode: string, fromPort: string, toNode: string, toPort: string) => Promise<void>;
  disconnect: (connectionId: string) => Promise<void>;
  setParam: (nodeId: string, key: string, value: ParamValue) => Promise<void> | void;
  setDslHandle: (nodeId: string, handle: string) => void;
  getDslShadow: () => DslShadowDocument | null;
  setDslShadowFromEditor: DslSlice['setDslShadowFromEditor'];
  refreshDslShadowFromGraph: (reason?: string) => void;
  clearDslShadow: () => void;
  setParamLive: (nodeId: string, key: string, value: ParamValue) => Promise<void>;
  setParamCommit: (nodeId: string, key: string, value: ParamValue) => Promise<void>;
  setInputDefault: (nodeId: string, portName: string, value: ParamValue) => Promise<void>;
  setInputDefaultLive: (nodeId: string, portName: string, value: ParamValue) => Promise<void>;
  setInputDefaultCommit: (nodeId: string, portName: string, value: ParamValue) => Promise<void>;
  setPosition: (nodeId: string, position: { x: number; y: number }) => Promise<void> | void;
  selectNode: (id: string | null) => void;
  setSelectedNodes: (ids: string[]) => void;
  toggleMuteSelected: () => Promise<void>;
  addFrame: (position: { x: number; y: number }, size?: { width: number; height: number }, label?: string) => string;
  removeFrame: (id: string) => void;
  updateFrame: (id: string, updates: Partial<Omit<Frame, 'id'>>) => void;
  frameSelectedNodes: (nodeSizes?: Map<string, { width: number; height: number }>) => string | null;
  selectFrame: (id: string | null) => void;
  loadImageFile: (nodeId: string, file: File) => void;
  loadImagePath: (nodeId: string, path: string) => Promise<void>;
  loadVideoFile: (nodeId: string, path: string) => Promise<VideoInfo | null>;
  getImageData: (nodeId: string) => Promise<Uint8Array | null>;
  loadPaletteFile: (nodeId: string, file: File) => void;
  triggerRender: (viewerNodeId: string, previewScaleOverride?: number) => void;
  newProject: () => Promise<void>;
  saveProject: () => Promise<boolean>;
  saveProjectAs: () => Promise<boolean>;
  saveBundledProject: () => Promise<boolean>;
  loadProject: (file: File) => void;
  loadProjectFromPath?: () => Promise<boolean>;
  requestNewProject: () => Promise<void>;
  requestOpenProject: (file?: File) => Promise<void>;
  requestOpenExample: (exampleId: string) => Promise<void>;
  requestSaveProject: () => Promise<boolean>;
  requestSaveProjectAs: () => Promise<boolean>;
  requestSaveBundledProject: () => Promise<boolean>;
  requestCloseProject: () => Promise<void>;
  resolveUnsavedChanges: (choice: UnsavedChangesChoice) => Promise<void>;
  dismissUnsavedChangesPrompt: () => void;
  setProjectAssetStorage: (mode: ProjectAssetStorage) => void;
  resolveAssetStoragePrompt: (mode: ProjectAssetStorage) => Promise<boolean>;
  dismissAssetStoragePrompt: () => void;
  hydrateProjectFromEngine: () => Promise<boolean>;
  exportImage: (nodeId: string) => void;
  exportExr: (nodeId: string) => void;
  setCurrentFrame: (frame: number) => void;
  setSequenceDirectory: (nodeId: string, directory: string) => Promise<void>;
  setSequenceFiles: (nodeId: string, files: File[]) => Promise<void>;
  prefetchSequenceFrames: (startFrame: number, count: number) => void;
  loadBatchFiles: (nodeId: string, files: File[]) => Promise<void>;
  loadBatchPaths: (nodeId: string, paths: string[]) => Promise<void>;
  loadBatchDirectory: (nodeId: string, directory: string) => Promise<BatchInfo>;
  getBatchImageData: (nodeId: string, index: number) => Promise<Uint8Array | null>;
  getBatchThumbnail: (nodeId: string, index: number, maxEdge: number) => Promise<Uint8Array | null>;
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
  setBatchInfo: (nodeId: string, info: BatchInfo | null) => void;
  setActiveTransportSource: (nodeId: string | null) => void;
  suggestActiveTransportSourceForViewer: (viewerNodeId: string | null) => void;
  recomputeMediaIteratorState: () => void;
  pushSequenceFrames: (frame: number) => Promise<void>;
  renderAllViewersAsync: () => Promise<void>;
  renderViewerFrame: (viewerNodeId: string, frame: number, previewScale?: number) => Promise<ViewerResult | null>;
  triggerAllViewers: (previewScaleOverride?: number) => void;
  triggerAffectedViewers: (changedNodeIds: string[], previewScaleOverride?: number) => void;

  editingStack: EditingContext[];
  enterGroup: (groupNodeId: string) => Promise<void>;
  exitGroup: () => void;
  navigateToBreadcrumb: (index: number) => Promise<void>;
  createGroup: (nodeIds: string[], name?: string) => Promise<void>;
  ungroupNode: (groupNodeId: string) => Promise<void>;
  renameGroup: (groupNodeId: string, newName: string) => Promise<void>;
  renameGpuScriptNode: (nodeId: string, newName: string) => Promise<void>;
  isInsideGroup: () => boolean;
  updateGroupInterface: (inputs: PortSpec[] | null, outputs: PortSpec[] | null) => Promise<void>;
  registerGpuKernel: (manifestJson: string) => Promise<NodeSpec | null>;
  registerGroupDefinition: (json: string) => Promise<NodeSpec | null>;
  importCustomNodes: (json: string) => Promise<string[]>;
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
  loadOcioConfig: (path: string) => Promise<void>;
  loadOcioFromEnv: () => Promise<void>;
  resetColorManagement: () => Promise<void>;
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
  validateEdits: (editsJson: string) => EditValidationError[] | Promise<EditValidationError[]>;
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
  | keyof MediaIteratorSlice
  | keyof ProjectSlice
  | keyof AssetsSlice
  | keyof ColorSlice
  | keyof AiSlice
  | keyof DslSlice
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

        if (isDesktopRuntime()) {
          await get().hydrateProjectFromEngine();
        }

        const settings = useSettingsStore.getState();

        if (settings.aiApiKey && kernel.engine.setAiApiKey) {
          await kernel.engine.setAiApiKey('replicate', settings.aiApiKey);
        }

        if (kernel.engine.setProjectFormat) {
          await kernel.engine.setProjectFormat(settings.projectWidth, settings.projectHeight);
        }

        if (isDesktopRuntime() && settings.ocioEnabled) {
          try {
            if (settings.ocioConfigSource === 'file' && settings.ocioConfigPath) {
              await get().loadOcioConfig(settings.ocioConfigPath);
            } else {
              await get().loadOcioFromEnv();
            }
            if (settings.ocioActiveDisplay && settings.ocioActiveView && kernel.engine.setDisplayView) {
              await kernel.engine.setDisplayView(settings.ocioActiveDisplay, settings.ocioActiveView);
            }
          } catch (e) {
            console.warn('Failed to restore OCIO config:', e);
          }
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
    ...createMediaIteratorSlice(...args),
    ...createAssetsSlice(...args),
    ...createColorSlice(...args),
    ...createAiSlice(...args),
    ...createDslSlice(...args),
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
