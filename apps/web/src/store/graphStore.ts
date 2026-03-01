import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  NodeInstance,
  Connection,
  NodeSpec,
  PortSpec,
  ParamValue,
  ViewerResult,
} from './types';
import { isPixelResult } from './types';
import type {
  EditingContext,
  GroupInternalGraph,
  Frame,
  TransactionOptions,
  TransactionResult,
  TransactionOrigin,
  TransactionDiagnostics,
} from './types';
import type { EngineBridge, JobProgress, SequenceInfo, VideoInfo, ColorManagementInfo, EditValidationError } from '../engine/bridge';
import { sequenceFrameManager } from '../engine/sequenceFrameManager';
import { parseEngineError, makeEngineError } from '../engine/engineError';
import type { EngineError } from '../engine/engineError';

const DEFAULT_FRAME_COLOR = 'purple'; // eslint-disable-line compositor-theme/no-hardcoded-colors
let engine: EngineBridge | null = null;

/** Sentinel port name appended to GroupInput outputs — drag from this to create a new group input. */
export const ADD_OUTPUT_PORT = '__add_output';
/** Sentinel port name appended to GroupOutput inputs — drag to this to create a new group output. */
export const ADD_INPUT_PORT = '__add_input';

function buildGroupIOSpecs(
  internalGraph: GroupInternalGraph,
): { groupInputSpec: NodeSpec; groupOutputSpec: NodeSpec } {
  const addOutputPort: PortSpec = { name: ADD_OUTPUT_PORT, label: '+', ty: 'Image' };
  const addInputPort: PortSpec = { name: ADD_INPUT_PORT, label: '+', ty: 'Image' };
  return {
    groupInputSpec: {
      id: 'group_input',
      display_name: 'Group Input',
      category: 'Group',
      description: 'Inputs to this group',
      inputs: [],
      outputs: [...internalGraph.inputs, addOutputPort],
      params: [],
    },
    groupOutputSpec: {
      id: 'group_output',
      display_name: 'Group Output',
      category: 'Group',
      description: 'Outputs from this group',
      inputs: [...internalGraph.outputs, addInputPort],
      outputs: [],
      params: [],
    },
  };
}

function withGroupIOSpecs(specs: NodeSpec[], internalGraph: GroupInternalGraph): NodeSpec[] {
  const { groupInputSpec, groupOutputSpec } = buildGroupIOSpecs(internalGraph);
  return [
    ...specs.filter(s => s.id !== 'group_input' && s.id !== 'group_output'),
    groupInputSpec,
    groupOutputSpec,
  ];
}

const cloneEditingStack = (stack: EditingContext[]): EditingContext[] =>
  stack.map(ctx => ({
    ...ctx,
    savedNodes: ctx.savedNodes ? new Map(ctx.savedNodes) : undefined,
    savedConnections: ctx.savedConnections ? [...ctx.savedConnections] : undefined,
    savedNodeSpecs: ctx.savedNodeSpecs ? [...ctx.savedNodeSpecs] : undefined,
  }));

import { useSettingsStore } from './settingsStore';
const renderGenerations = new Map<string, number>();
let idlePreviewTimer: ReturnType<typeof setTimeout> | null = null;
let liveRenderGeneration = 0;

const nextRenderGeneration = (viewerNodeId: string): number => {
  const next = (renderGenerations.get(viewerNodeId) ?? 0) + 1;
  renderGenerations.set(viewerNodeId, next);
  return next;
};

const createScalingCanvas = (width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null => {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const downscaleRenderResult = async (result: ViewerResult, scale: number): Promise<ViewerResult> => {
  // Only pixel-carrying results can be downscaled
  if (!isPixelResult(result)) return result;

  if (!Number.isFinite(scale) || scale >= 1) {
    return { ...result, previewScale: 1 };
  }

  const targetWidth = Math.max(1, Math.round(result.width * scale));
  const targetHeight = Math.max(1, Math.round(result.height * scale));

  const sourceCanvas = createScalingCanvas(result.width, result.height);
  const targetCanvas = createScalingCanvas(targetWidth, targetHeight);
  if (!sourceCanvas || !targetCanvas) {
    return { ...result, previewScale: 1 };
  }

  const sourceCtx = sourceCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  const targetCtx = targetCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!sourceCtx || !targetCtx) {
    return { ...result, previewScale: 1 };
  }

  const imageData = new ImageData(result.width, result.height);
  imageData.data.set(result.pixels);
  sourceCtx.putImageData(imageData, 0, 0);

  targetCtx.imageSmoothingEnabled = true;
  targetCtx.drawImage(sourceCanvas as any, 0, 0, targetWidth, targetHeight);

  const scaledImage = targetCtx.getImageData(0, 0, targetWidth, targetHeight);
  return {
    ...result,
    width: targetWidth,
    height: targetHeight,
    pixels: scaledImage.data,
    previewScale: scale,
  };
};

type GraphNodeData = {
  id: string;
  type_id: string;
  params?: Record<string, ParamValue>;
  input_defaults?: Record<string, ParamValue>;
  position: [number, number];
  muted?: boolean;
};

type GraphConnectionData = {
  from_node: string;
  from_port: string;
  to_node: string;
  to_port: string;
};

type SerializableGraphData = {
  nodes?: GraphNodeData[];
  connections?: GraphConnectionData[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isDocumentEnvelope = (value: unknown): value is { compositor: unknown; graph: unknown } => (
  isRecord(value) && 'compositor' in value && 'graph' in value
);

const extractGraphData = (value: unknown): SerializableGraphData => {
  if (isDocumentEnvelope(value)) {
    return isRecord(value.graph) ? value.graph as SerializableGraphData : {};
  }
  return isRecord(value) ? value as SerializableGraphData : {};
};

const createDocumentEnvelope = (graph: unknown) => ({
  compositor: {
    format_version: '1.1.0',
    app_version: '',
    created_at: '',
    modified_at: '',
  },
  project: {
    name: 'Untitled',
    author: '',
    description: '',
  },
  graph,
  assets: {},
  scripts: {},
});

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

async function createEngine(): Promise<EngineBridge> {
  if (isTauri()) {
    const { tauriEngine } = await import('../engine/tauriEngine');
    return tauriEngine;
  } else {
    const { initWasmEngine, wasmEngine } = await import('../engine/wasmEngine');
    await initWasmEngine();
    return wasmEngine;
  }
}

function getEngine(): EngineBridge {
  if (!engine) throw new Error('Engine not initialized');
  return engine;
}

interface UndoSnapshot {
  engineState: unknown;
  nodes: Map<string, NodeInstance>;
  connections: Connection[];
  frames: Map<string, Frame>;
  editingStack: EditingContext[];
  /** Compressed original image bytes per LoadImage node id */
  imageData: Map<string, Uint8Array>;
  /** Sequence metadata per LoadImageSequence node id */
  sequenceInfoMap: Map<string, SequenceInfo>;
}

interface GraphState {
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
  sequenceInfoMap: Map<string, SequenceInfo>;

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

  play: () => void;
  pause: () => void;
  togglePlayback: () => void;
  stepForward: () => void;
  stepBackward: () => void;
  goToStart: () => void;
  goToEnd: () => void;
  setFps: (fps: number) => void;
  setLoopPlayback: (loop: boolean) => void;

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

const undoStack: UndoSnapshot[] = [];
const redoStack: UndoSnapshot[] = [];

let liveRenderRaf: number | null = null;
let preCommitSnapshot: UndoSnapshot | null = null;
let pendingLiveRender: (() => void) | null = null;
let playbackTimeoutId: ReturnType<typeof setTimeout> | null = null;
let playbackAborted = false;
let webRenderCancelled = false;

let renderLock: Promise<void> = Promise.resolve();
let renderSuspendCount = 0;
let renderNeededWhileSuspended = false;
let graphRevision = 0;

export const useGraphStore = create<GraphState>()(
  devtools((set, get) => {
    const triggerAllViewers = () => {
      if (renderSuspendCount > 0) {
        renderNeededWhileSuspended = true;
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
     * Normalize complex param values after deserialization (load/import).
     * Clamps values to valid ranges and ensures structural integrity.
     */
    const normalizeParamValue = (value: ParamValue): ParamValue => {
      if ('CurvePoints' in value) {
        const pts = value.CurvePoints;
        if (!Array.isArray(pts) || pts.length < 2) {
          return { CurvePoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
        }
        return {
          CurvePoints: pts.map(p => ({
            x: Math.max(0, Math.min(1, Number(p.x) || 0)),
            y: Math.max(0, Math.min(1, Number(p.y) || 0)),
          })),
        };
      }
      if ('ColorRamp' in value) {
        const stops = value.ColorRamp;
        if (!Array.isArray(stops) || stops.length < 2) {
          return { ColorRamp: [
            { position: 0, color: [0, 0, 0, 1] },
            { position: 1, color: [1, 1, 1, 1] },
          ]};
        }
        return {
          ColorRamp: stops.map(s => ({
            position: Math.max(0, Math.min(1, Number(s.position) || 0)),
            color: (Array.isArray(s.color) && s.color.length === 4
              ? s.color.map(c => Math.max(0, Math.min(1, Number(c) || 0)))
              : [0, 0, 0, 1]
            ) as [number, number, number, number],
          })),
        };
      }
      return value;
    };

    const applyGraphData = (graphData: SerializableGraphData) => {
      const newNodes = new Map<string, NodeInstance>();
      const newConnections: Connection[] = [];

      if (Array.isArray(graphData.nodes)) {
        for (const node of graphData.nodes) {
          const spec = get().nodeSpecs.find(s => s.id === node.type_id);
          const params: Record<string, ParamValue> = {};
          if (spec) {
            spec.params.forEach(p => {
              const rawValue = node.params?.[p.key] ?? p.default;
              params[p.key] = normalizeParamValue(rawValue as ParamValue);
            });
          } else if (node.params) {
            Object.assign(params, node.params);
          }
          const [x, y] = node.position;
          newNodes.set(node.id, {
            id: node.id,
            typeId: node.type_id,
            params,
            inputDefaults: node.input_defaults ?? {},
            position: { x, y },
            muted: node.muted ?? false,
          });
        }
      }

      if (Array.isArray(graphData.connections)) {
        for (const conn of graphData.connections) {
          newConnections.push({
            id: crypto.randomUUID(),
            fromNode: conn.from_node,
            fromPort: conn.from_port,
            toNode: conn.to_node,
            toPort: conn.to_port,
          });
        }
      }

      set({
        nodes: newNodes,
        connections: newConnections,
        selectedNodeIds: new Set(),
        frames: new Map(),
        selectedFrameId: null,
        renderResults: new Map(),
        editingStack: [{ id: 'root', label: 'Root' }],
        dirty: false,
        fitViewRequestId: get().fitViewRequestId + 1,
      });

      triggerAllViewers();
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

    const renderAllViewersAsync = () => {
      renderLock = renderLock.then(async () => {
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
    };

    const recomputeSequenceState = () => {
      const { nodes, sequenceInfoMap } = get();
      let hasSeq = false;
      for (const [, node] of nodes) {
        if (node.typeId === 'load_image_sequence' || node.typeId === 'load_video') {
          hasSeq = true;
          break;
        }
      }

      let maxEnd = 0;
      let minStart = Infinity;
      for (const [, info] of sequenceInfoMap) {
        if (info.frame_count > 0) {
          minStart = Math.min(minStart, info.first_frame);
          maxEnd = Math.max(maxEnd, info.last_frame);
        }
      }

      if (minStart === Infinity) minStart = 0;

      set({
        hasSequenceNodes: hasSeq,
        sequenceLength: maxEnd,
        sequenceStart: minStart,
      });
    };

    const collectImageData = async (): Promise<Map<string, Uint8Array>> => {
      const eng = getEngine();
      const imgData = new Map<string, Uint8Array>();
      if (!eng.getImageData) return imgData;
      for (const [nodeId, node] of get().nodes) {
        if (node.typeId !== 'load_image') continue;
        try {
          const result = eng.getImageData(nodeId);
          const bytes = result instanceof Promise ? await result : result;
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
      undoStack.push(snapshot);
      if (undoStack.length > useSettingsStore.getState().maxUndoSteps) undoStack.shift();
      redoStack.length = 0;
      set({ canUndo: undoStack.length > 0, canRedo: false, dirty: true });
    };

    /**
     * Tag a mutation as UI-originated so the DSL editor can gate on origin.
     * Only tags when NOT inside an editTransaction (which sets origin itself).
     */
    const tagUiOrigin = () => {
      if (renderSuspendCount > 0) return; // Inside editTransaction — origin already set
      graphRevision++;
      set({ lastTransactionOrigin: 'ui', graphRevision });
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
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        sequenceInfoMap: new Map(snapshot.sequenceInfoMap),
      });

      recomputeSequenceState();

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
      nodes: new Map(),
      connections: [],
      selectedNodeIds: new Set(),
      frames: new Map(),
      selectedFrameId: null,
      nodeSpecs: [],
      engineReady: false,
      renderResults: new Map(),
      lastError: null,
      canUndo: false,
      canRedo: false,
      currentFrame: 0,
      renderProgress: null,
      isRendering: false,
      previewScale: 1,
      dirty: false,
      fitViewRequestId: 0,
      hasSequenceNodes: false,
      sequenceLength: 0,
      sequenceStart: 0,
      sequenceInfoMap: new Map(),

      isPlaying: false,
      fps: useSettingsStore.getState().defaultFps,
      loopPlayback: useSettingsStore.getState().loopPlayback,
      playbackFps: null,
      editingStack: [{ id: 'root', label: 'Root' }],

      nodeTimings: new Map(),
      nodeErrors: new Map(),
      aiNodeStatuses: {},
      aiNodeStale: {},
      colorManagement: null,

      initEngine: async () => {
        engine = await createEngine();
        const specs = await engine.listNodeTypes();
        set({ engineReady: true, nodeSpecs: specs });

        const settings = useSettingsStore.getState();

        if (settings.aiApiKey && engine.setAiApiKey) {
          await engine.setAiApiKey('replicate', settings.aiApiKey);
        }

        if (engine.setProjectFormat) {
          await engine.setProjectFormat(settings.projectWidth, settings.projectHeight);
        }

        if (engine.getColorManagementInfo) {
          try {
            const info = await engine.getColorManagementInfo();
            set({ colorManagement: info });
          } catch (e) {
            console.warn('Failed to load color management info:', e);
          }
        }
      },

      addNode: async (typeId, position) => {
        await pushUndo();
        tagUiOrigin();

        const result = await getEngine().addNode(typeId, position.x, position.y);
        const actualTypeId = result.typeId;

        let spec = get().nodeSpecs.find(s => s.id === actualTypeId);
        const params: Record<string, ParamValue> = {};

        if (!spec && actualTypeId.startsWith('gpu_script::')) {
          spec = {
            id: actualTypeId,
            display_name: 'GPU Script',
            category: 'GPU',
            description: 'Custom GPU shader node. Write GLSL and compile to run.',
            inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
            outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
            params: [],
          };
          set({ nodeSpecs: [...get().nodeSpecs, spec] });
        }

        if (spec) {
          spec.params.forEach(p => {
            params[p.key] = p.default;
          });
        }

        const inputDefaults: Record<string, ParamValue> = {};
        if (spec) {
          for (const input of spec.inputs) {
            if (input.default) {
              inputDefaults[input.name] = input.default as ParamValue;
            }
          }
        }

        const newNodes = new Map(get().nodes);
        newNodes.set(result.id, {
          id: result.id,
          typeId: actualTypeId,
          params,
          inputDefaults,
          position,
          muted: false,
        });

        set({ nodes: newNodes });
        if (actualTypeId === 'load_image_sequence') {
          recomputeSequenceState();
        }
        return result.id;
      },

      removeNode: async (id) => {
        await pushUndo();
        tagUiOrigin();
        const removedNode = get().nodes.get(id);
        await getEngine().removeNode(id);
        const newNodes = new Map(get().nodes);
        newNodes.delete(id);
        
        const newConnections = get().connections.filter(
          c => c.fromNode !== id && c.toNode !== id
        );

        const newInfoMap = new Map(get().sequenceInfoMap);
        newInfoMap.delete(id);

        set({ 
          nodes: newNodes, 
          connections: newConnections,
          selectedNodeIds: (() => {
            const prev = get().selectedNodeIds;
            if (prev.has(id)) {
              const next = new Set(prev);
              next.delete(id);
              return next;
            }
            return prev;
          })(),
          sequenceInfoMap: newInfoMap,
        });

        if (removedNode?.typeId === 'load_image_sequence') {
          sequenceFrameManager.clear(id);
          recomputeSequenceState();
        }
      },

      connect: async (fromNode, fromPort, toNode, toPort) => {
        await pushUndo();
        tagUiOrigin();
        const exists = get().connections.some(
          c => c.fromNode === fromNode && c.fromPort === fromPort && 
               c.toNode === toNode && c.toPort === toPort
        );
        if (exists) return;

        const eng = getEngine();
        const editingStack = get().editingStack;
        // Intercept connections to/from add-port sentinels inside groups
        if (editingStack.length > 1) {
          const ctx = editingStack[editingStack.length - 1];
          if (!eng.addInternalConnection || !eng.getGroupInternalGraph) {
            set({ lastError: makeEngineError('Group editing not supported by this engine') });
            return;
          }

          const isAddFrom = fromPort === ADD_OUTPUT_PORT;
          const isAddTo = toPort === ADD_INPUT_PORT;

          if (isAddFrom || isAddTo) {
            const internalGraph = await eng.getGroupInternalGraph(ctx.groupNodeId!);
            let resolvedFromPort = fromPort;
            let resolvedToPort = toPort;

            if (isAddFrom) {
              // Name the group input after the target node's input port, with dedup
              const existing = internalGraph.inputs;
              let name = toPort;
              if (existing.some(p => p.name === name)) {
                let idx = 2;
                while (existing.some(p => p.name === `${toPort}_${idx}`)) { idx++; }
                name = `${toPort}_${idx}`;
              }
              resolvedFromPort = name;
            }

            if (isAddTo) {
              // Name the group output after the source node's output port, with dedup
              const existing = internalGraph.outputs;
              let name = fromPort;
              if (existing.some(p => p.name === name)) {
                let idx = 2;
                while (existing.some(p => p.name === `${fromPort}_${idx}`)) { idx++; }
                name = `${fromPort}_${idx}`;
              }
              resolvedToPort = name;
            }

            await eng.addInternalConnection(ctx.groupDefId!, fromNode, resolvedFromPort, toNode, resolvedToPort);

            // Refresh internal graph state after the new port was created
            const updatedGraph = await eng.getGroupInternalGraph(ctx.groupNodeId!);
            const specs = await Promise.resolve(eng.listNodeTypes());
            const id = crypto.randomUUID();
            const newConnection: Connection = { id, fromNode, fromPort: resolvedFromPort, toNode, toPort: resolvedToPort };
            set(state => ({
              connections: [...state.connections, newConnection],
              nodeSpecs: withGroupIOSpecs(specs, updatedGraph),
            }));
            triggerAllViewers();
            return;
          }
          await eng.addInternalConnection(ctx.groupDefId!, fromNode, fromPort, toNode, toPort);
        } else {
          await eng.connect(fromNode, fromPort, toNode, toPort);
        }
        const id = crypto.randomUUID();
        const newConnection: Connection = { id, fromNode, fromPort, toNode, toPort };
        set(state => ({
          connections: [...state.connections, newConnection]
        }));

        if (editingStack.length > 1) {
          const ctx = editingStack[editingStack.length - 1];
          if (!eng.getGroupInternalGraph) {
            set({ lastError: makeEngineError('Group editing not supported by this engine') });
            return;
          }
          const internalGraph = await eng.getGroupInternalGraph(ctx.groupNodeId!);
          const specs = await Promise.resolve(eng.listNodeTypes());
          set({ nodeSpecs: withGroupIOSpecs(specs, internalGraph) });
        }
        triggerAllViewers();
      },

      disconnect: async (connectionId) => {
        await pushUndo();
        tagUiOrigin();
        const conn = get().connections.find(c => c.id === connectionId);
        if (conn) {
          const eng = getEngine();
          const editingStack = get().editingStack;
          if (editingStack.length > 1) {
            const ctx = editingStack[editingStack.length - 1];
            if (!eng.removeInternalConnection || !eng.getGroupInternalGraph) {
            set({ lastError: makeEngineError('Group editing not supported by this engine') });
              return;
            }
            await eng.removeInternalConnection(ctx.groupDefId!, conn.toNode, conn.toPort);
          } else {
            await eng.disconnect(conn.toNode, conn.toPort);
          }
          set(state => ({
            connections: state.connections.filter(c => c.id !== connectionId)
          }));

          if (editingStack.length > 1) {
            const ctx = editingStack[editingStack.length - 1];
            if (!eng.getGroupInternalGraph) {
            set({ lastError: makeEngineError('Group editing not supported by this engine') });
              return;
            }
            const internalGraph = await eng.getGroupInternalGraph(ctx.groupNodeId!);
            const specs = await Promise.resolve(eng.listNodeTypes());
            set({ nodeSpecs: withGroupIOSpecs(specs, internalGraph) });
          }
          triggerAllViewers();
        }
      },

      setParam: async (nodeId, key, value) => {
        await pushUndo();
        tagUiOrigin();
        getEngine().setParam(nodeId, key, value);
        const newNodes = new Map(get().nodes);
        const node = newNodes.get(nodeId);
        if (node) {
          node.params = { ...node.params, [key]: value };
          newNodes.set(nodeId, { ...node });
          set({ nodes: newNodes });
        }
        triggerAllViewers();
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

      setParamLive: async (nodeId, key, value) => {
        if (!preCommitSnapshot) {
          preCommitSnapshot = {
            engineState: null,
            nodes: new Map(get().nodes),
            connections: [...get().connections],
            frames: new Map(get().frames),
            editingStack: cloneEditingStack(get().editingStack),
            imageData: new Map(),
            sequenceInfoMap: new Map(get().sequenceInfoMap),
          };
          Promise.resolve(getEngine().exportGraph()).then(state => {
            if (preCommitSnapshot) preCommitSnapshot.engineState = state;
          });
          collectImageData().then(data => {
            if (preCommitSnapshot) preCommitSnapshot.imageData = data;
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
          const renderGeneration = ++liveRenderGeneration;
          pendingLiveRender = () => {
            eng.setParamAndRender!(nodeId, key, value, get().currentFrame).then(async results => {
              if (renderGeneration !== liveRenderGeneration) return;
              if (results.size > 0) {
                const newResults = new Map(get().renderResults);
                for (const [vid, r] of results) {
                  const scaled = await downscaleRenderResult(r, liveScale);
                  newResults.set(vid, scaled);
                }
                if (renderGeneration !== liveRenderGeneration) return;
                set({ renderResults: newResults, lastError: null });
                updateNodeTimings();
              }
            }).catch((e: unknown) => { const error = parseEngineError(e); if (error.code !== 'MISSING_INPUT') { set({ lastError: error }); } });
          };
        } else {
          pendingLiveRender = () => {
            getEngine().setParam(nodeId, key, value);
            triggerAllViewers();
          };
        }

        if (liveRenderRaf === null) {
          liveRenderRaf = requestAnimationFrame(() => {
            liveRenderRaf = null;
            pendingLiveRender?.();
            pendingLiveRender = null;
          });
        }

        if (idlePreviewTimer) clearTimeout(idlePreviewTimer);
        idlePreviewTimer = setTimeout(() => {
          idlePreviewTimer = null;
          set({ previewScale: 1 });
          triggerAllViewers();
        }, useSettingsStore.getState().previewIdleDelay);
      },

      setParamCommit: async (nodeId, key, value) => {
        if (preCommitSnapshot) {
          if (!preCommitSnapshot.engineState) {
            preCommitSnapshot.engineState = await getEngine().exportGraph();
          }
          undoStack.push(preCommitSnapshot);
          if (undoStack.length > useSettingsStore.getState().maxUndoSteps) undoStack.shift();
          redoStack.length = 0;
          preCommitSnapshot = null;
        }

        const newNodes = new Map(get().nodes);
        const node = newNodes.get(nodeId);
        if (node) {
          node.params = { ...node.params, [key]: value };
          newNodes.set(nodeId, { ...node });
          set({ nodes: newNodes, canUndo: undoStack.length > 0, canRedo: false, previewScale: 1, dirty: true });
        } else {
          set({ previewScale: 1 });
        }

        if (liveRenderRaf !== null) {
          cancelAnimationFrame(liveRenderRaf);
          liveRenderRaf = null;
          pendingLiveRender = null;
        }

        if (idlePreviewTimer) {
          clearTimeout(idlePreviewTimer);
          idlePreviewTimer = null;
        }

        const eng = getEngine();
        if (eng.setParamAndRender) {
          const renderGeneration = ++liveRenderGeneration;
          eng.setParamAndRender(nodeId, key, value, get().currentFrame).then(async results => {
            if (renderGeneration !== liveRenderGeneration) return;
            if (results.size > 0) {
              const newResults = new Map(get().renderResults);
              for (const [vid, r] of results) {
                const scaled = await downscaleRenderResult(r, 1);
                newResults.set(vid, scaled);
              }
              if (renderGeneration !== liveRenderGeneration) return;
              set({ renderResults: newResults, lastError: null });
              updateNodeTimings();
            }
          }).catch((e: unknown) => { const error = parseEngineError(e); if (error.code !== 'MISSING_INPUT') { set({ lastError: error }); } });
        } else {
          await getEngine().setParam(nodeId, key, value);
          triggerAllViewers();
        }
      },

      setInputDefault: async (nodeId, portName, value) => {
        await pushUndo();
        tagUiOrigin();
        await getEngine().setInputDefault(nodeId, portName, value);
        const newNodes = new Map(get().nodes);
        const node = newNodes.get(nodeId);
        if (node) {
          node.inputDefaults = { ...node.inputDefaults, [portName]: value };
          newNodes.set(nodeId, { ...node });
          set({ nodes: newNodes });
        }
        triggerAllViewers();
      },

      setInputDefaultLive: async (nodeId, portName, value) => {
        if (!preCommitSnapshot) {
          preCommitSnapshot = {
            engineState: null,
            nodes: new Map(get().nodes),
            connections: [...get().connections],
            frames: new Map(get().frames),
            editingStack: cloneEditingStack(get().editingStack),
            imageData: new Map(),
            sequenceInfoMap: new Map(get().sequenceInfoMap),
          };
          Promise.resolve(getEngine().exportGraph()).then(state => {
            if (preCommitSnapshot) preCommitSnapshot.engineState = state;
          });
          collectImageData().then(data => {
            if (preCommitSnapshot) preCommitSnapshot.imageData = data;
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

        pendingLiveRender = () => {
          getEngine().setInputDefault(nodeId, portName, value);
          triggerAllViewers();
        };

        if (liveRenderRaf === null) {
          liveRenderRaf = requestAnimationFrame(() => {
            liveRenderRaf = null;
            pendingLiveRender?.();
            pendingLiveRender = null;
          });
        }

        if (idlePreviewTimer) clearTimeout(idlePreviewTimer);
        idlePreviewTimer = setTimeout(() => {
          idlePreviewTimer = null;
          set({ previewScale: 1 });
          triggerAllViewers();
        }, useSettingsStore.getState().previewIdleDelay);
      },

      setInputDefaultCommit: async (nodeId, portName, value) => {
        if (preCommitSnapshot) {
          if (!preCommitSnapshot.engineState) {
            preCommitSnapshot.engineState = await getEngine().exportGraph();
          }
          undoStack.push(preCommitSnapshot);
          if (undoStack.length > useSettingsStore.getState().maxUndoSteps) undoStack.shift();
          redoStack.length = 0;
          preCommitSnapshot = null;
        }

        const newNodes = new Map(get().nodes);
        const node = newNodes.get(nodeId);
        if (node) {
          node.inputDefaults = { ...node.inputDefaults, [portName]: value };
          newNodes.set(nodeId, { ...node });
          set({ nodes: newNodes, canUndo: undoStack.length > 0, canRedo: false, previewScale: 1, dirty: true });
        } else {
          set({ previewScale: 1 });
        }

        if (liveRenderRaf !== null) {
          cancelAnimationFrame(liveRenderRaf);
          liveRenderRaf = null;
          pendingLiveRender = null;
        }

        if (idlePreviewTimer) {
          clearTimeout(idlePreviewTimer);
          idlePreviewTimer = null;
        }

        await getEngine().setInputDefault(nodeId, portName, value);
        triggerAllViewers();
      },

      setPosition: (nodeId, position) => {
        const newNodes = new Map(get().nodes);
        const node = newNodes.get(nodeId);
        if (node) {
          node.position = position;
          newNodes.set(nodeId, { ...node });
          set({ nodes: newNodes });
          getEngine().setPosition(nodeId, position.x, position.y);
        }
      },

      selectNode: (id) => {
        set({ selectedNodeIds: id ? new Set([id]) : new Set() });
      },

      setSelectedNodes: (ids) => {
        set({ selectedNodeIds: new Set(ids), selectedFrameId: null });
      },

      toggleMuteSelected: async () => {
        tagUiOrigin();
        const UNMUTABLE_TYPES = new Set([
          'load_image', 'load_image_sequence', 'load_video',
          'viewer', 'export_image', 'export_image_sequence', 'export_video',
          'group_input', 'group_output',
        ]);

        const nodes = get().nodes;
        const selectedIds = Array.from(get().selectedNodeIds).filter(id => {
          const node = nodes.get(id);
          return node && !UNMUTABLE_TYPES.has(node.typeId);
        });
        if (selectedIds.length === 0) return;

        await pushUndo();

        const anyUnmuted = selectedIds.some(id => !nodes.get(id)?.muted);
        const newMuted = anyUnmuted;

        const eng = getEngine();

        for (const id of selectedIds) {
          await Promise.resolve(eng.setMuted(id, newMuted));
        }

        const newNodes = new Map(nodes);
        for (const id of selectedIds) {
          const node = newNodes.get(id);
          if (node) {
            newNodes.set(id, { ...node, muted: newMuted });
          }
        }
        set({ nodes: newNodes });

        triggerAllViewers();
      },

      addFrame: (position, size, label) => {
        void pushUndo();
        const id = crypto.randomUUID();
        const frames = new Map(get().frames);
        const maxZ = frames.size > 0 ? Math.max(...Array.from(frames.values()).map(frame => frame.zIndex)) : 0;
        frames.set(id, {
          id,
          label: label ?? 'Frame',
      color: DEFAULT_FRAME_COLOR,
          position,
          size: size ?? { width: 400, height: 300 },
          zIndex: maxZ + 1,
        });
        set({ frames, dirty: true });
        return id;
      },

      removeFrame: (id) => {
        void pushUndo();
        const frames = new Map(get().frames);
        frames.delete(id);
        const selectedFrameId = get().selectedFrameId === id ? null : get().selectedFrameId;
        set({ frames, selectedFrameId, dirty: true });
      },

      updateFrame: (id, updates) => {
        const frames = new Map(get().frames);
        const existing = frames.get(id);
        if (!existing) return;
        frames.set(id, { ...existing, ...updates, id });
        set({ frames, dirty: true });
      },

      selectFrame: (id) => {
        set({ selectedFrameId: id, selectedNodeIds: id ? new Set() : get().selectedNodeIds });
      },

      frameSelectedNodes: (nodeSizes) => {
        const { selectedNodeIds, nodes } = get();
        if (selectedNodeIds.size === 0) return null;

        const selectedNodes = Array.from(selectedNodeIds)
          .map(nodeId => nodes.get(nodeId))
          .filter((node): node is NodeInstance => !!node);

        if (selectedNodes.length === 0) return null;

        const PADDING = 40;
        const HEADER_HEIGHT = 30;
        const DEFAULT_W = 200;
        const DEFAULT_H = 100;
        const minX = Math.min(...selectedNodes.map(node => node.position.x)) - PADDING;
        const minY = Math.min(...selectedNodes.map(node => node.position.y)) - PADDING - HEADER_HEIGHT;
        const maxX = Math.max(...selectedNodes.map(node => {
          const sz = nodeSizes?.get(node.id);
          return node.position.x + (sz?.width ?? DEFAULT_W);
        })) + PADDING;
        const maxY = Math.max(...selectedNodes.map(node => {
          const sz = nodeSizes?.get(node.id);
          return node.position.y + (sz?.height ?? DEFAULT_H);
        })) + PADDING;

        void pushUndo();
        const id = crypto.randomUUID();
        const frames = new Map(get().frames);
        const maxZ = frames.size > 0 ? Math.max(...Array.from(frames.values()).map(frame => frame.zIndex)) : 0;
        frames.set(id, {
          id,
          label: 'Frame',
      color: DEFAULT_FRAME_COLOR,
          position: { x: minX, y: minY },
          size: { width: maxX - minX, height: maxY - minY },
          zIndex: maxZ + 1,
        });
        set({ frames, dirty: true });
        return id;
      },

      loadImageFile: (nodeId, file) => {
        file.arrayBuffer().then(async buffer => {
          const data = new Uint8Array(buffer);
          await getEngine().loadImageData(nodeId, data);
          set({ dirty: true });
          triggerAllViewers();
        }).catch(e => {
          console.error('loadImageFile failed:', e);
        });
      },

      loadVideoFile: async (nodeId, path) => {
        const eng = getEngine();
        if (!eng.loadVideoFile) return null;
        try {
          const info = await eng.loadVideoFile(nodeId, path);

          const seqInfo: SequenceInfo = {
            frame_count: info.frame_count,
            first_frame: 0,
            last_frame: info.frame_count > 0 ? info.frame_count - 1 : 0,
          };
          const newInfoMap = new Map(get().sequenceInfoMap);
          newInfoMap.set(nodeId, seqInfo);
          set({ sequenceInfoMap: newInfoMap, dirty: true });
          recomputeSequenceState();

          const { currentFrame, sequenceStart, sequenceLength } = get();
          if (info.frame_count > 0 && (currentFrame < sequenceStart || currentFrame > sequenceLength)) {
            set({ currentFrame: sequenceStart });
          }

          triggerAllViewers();
          return info;
        } catch (e) {
          console.error('loadVideoFile failed:', e);
          return null;
        }
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
          if (!eng.loadPaletteData) return;
          const colors = await eng.loadPaletteData(nodeId, data);
          const newNodes = new Map(get().nodes);
          const node = newNodes.get(nodeId);
          if (node) {
            node.params = { ...node.params, colors: { ColorPalette: colors } as ParamValue };
            newNodes.set(nodeId, { ...node });
            set({ nodes: newNodes, dirty: true });
          }
          triggerAllViewers();
        }).catch(e => {
          console.error('loadPaletteFile failed:', e);
        });
      },

      exportImage: (nodeId) => {
        const node = get().nodes.get(nodeId);
        if (!node) return;
        const frame = get().currentFrame;

        const formatParam = node.params['format'];
        const formatIdx = formatParam && 'Int' in formatParam ? formatParam.Int : 0;
        const extension = formatIdx === 1 ? 'jpg' : 'png';
        const mimeType = formatIdx === 1 ? 'image/jpeg' : 'image/png';

        getEngine().exportImage(nodeId, frame).then(bytes => {
          const blob = new Blob([bytes as any], { type: mimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `export.${extension}`;
          a.click();
          URL.revokeObjectURL(url);
        }).catch(e => {
          console.error('exportImage failed:', e);
          set({ lastError: parseEngineError(e) });
        });
      },

      triggerRender: (viewerNodeId) => {
        const frame = get().currentFrame;
        const scale = get().previewScale;
        const generation = nextRenderGeneration(viewerNodeId);
        renderLock = renderLock.then(async () => {
          if (renderGenerations.get(viewerNodeId) !== generation) return;
          try {
            const result = await Promise.resolve(getEngine().renderViewer(viewerNodeId, frame));
            const scaled = result ? await downscaleRenderResult(result, scale) : null;
            if (scaled && renderGenerations.get(viewerNodeId) === generation) {
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

      setCurrentFrame: (frame) => {
        set({ currentFrame: frame });
        renderAllViewersAsync();
      },

      setSequenceDirectory: async (nodeId, directory) => {
        const eng = getEngine();
        if (!eng.setSequenceDirectory) {
          set({ lastError: makeEngineError('Image sequences are only available in the desktop app') });
          return;
        }
        const info = await eng.setSequenceDirectory(nodeId, directory);
        const newInfoMap = new Map(get().sequenceInfoMap);
        newInfoMap.set(nodeId, info);
        set({ sequenceInfoMap: newInfoMap });
        recomputeSequenceState();

        const { currentFrame, sequenceStart, sequenceLength } = get();
        if (info.frame_count > 0 && (currentFrame < sequenceStart || currentFrame > sequenceLength)) {
          set({ currentFrame: sequenceStart });
        }

        triggerAllViewers();
      },

      setSequenceFiles: async (nodeId, files) => {
        const eng = getEngine();
        const { info, pattern } = sequenceFrameManager.setFiles(nodeId, files);

        if (eng.setSequenceInfo) {
          await eng.setSequenceInfo(nodeId, info);
        }

        await get().setParam(nodeId, 'pattern', { String: pattern } as ParamValue);

        if (info.frame_count > 0) {
          const frameData = await sequenceFrameManager.getFrameData(nodeId, info.first_frame);
          if (frameData && eng.loadSequenceFrameData) {
            await eng.loadSequenceFrameData(nodeId, info.first_frame, frameData);
          }
        }

        const newInfoMap = new Map(get().sequenceInfoMap);
        newInfoMap.set(nodeId, info);
        set({ sequenceInfoMap: newInfoMap });
        recomputeSequenceState();

        const { currentFrame, sequenceStart, sequenceLength } = get();
        if (info.frame_count > 0 && (currentFrame < sequenceStart || currentFrame > sequenceLength)) {
          set({ currentFrame: sequenceStart });
        }

        triggerAllViewers();
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
        triggerAllViewers();
      },
      renderBatch: async (nodeId) => {
        const eng = getEngine();
        const node = get().nodes.get(nodeId);
        if (!node) return;
        const formatIdx = node.params['format'] && 'Int' in node.params['format']
          ? node.params['format'].Int : 0;
        const ext = formatIdx === 1 ? 'jpg' : 'png';
        if (!eng.getBatchInfo) {
          set({ lastError: makeEngineError('Batch info not supported') });
          return;
        }
        let totalFrames = 0;
        let filenames: string[] = [];
        try {
          const info = await eng.getBatchInfo(nodeId);
          totalFrames = info.count;
          filenames = info.filenames;
        } catch (e) {
          set({ lastError: parseEngineError(e) });
          return;
        }
        if (totalFrames <= 0) {
          set({ lastError: makeEngineError('No images in batch') });
          return;
        }

        const padding = Math.max(4, String(totalFrames).length);
        webRenderCancelled = false;
        set({
          isRendering: true,
          lastError: null,
          renderProgress: {
            job_id: 'web-batch',
            current_frame: 0,
            total_frames: totalFrames,
            completed: false,
            error: null,
          },
        });

        try {
          const JSZip = (await import('jszip')).default;
          const zip = new JSZip();
          let renderedCount = 0;
          const usedNames = new Map<string, number>();

          for (let frame = 0; frame < totalFrames; frame++) {
            if (webRenderCancelled) break;
            const bytes = await eng.exportImage(nodeId, frame);
            let baseName = filenames[frame]
              ?? String(frame).padStart(padding, '0');
            const originalName = baseName;
            const count = usedNames.get(originalName) ?? 0;
            if (count > 0) {
              baseName = `${originalName}_${count}`;
            }
            usedNames.set(originalName, count + 1);

            zip.file(`${baseName}.${ext}`, bytes);
            renderedCount++;
            set({
              renderProgress: {
                job_id: 'web-batch',
                current_frame: renderedCount,
                total_frames: totalFrames,
                completed: false,
                error: null,
              },
            });
          }
          if (!webRenderCancelled) {
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'batch.zip';
            a.click();
            URL.revokeObjectURL(url);
          }

          set({
            isRendering: false,
            renderProgress: {
              job_id: 'web-batch',
              current_frame: renderedCount,
              total_frames: totalFrames,
              completed: true,
              error: webRenderCancelled ? 'Cancelled' : null,
            },
          });
        } catch (e) {
          const error = parseEngineError(e);
          set({
            isRendering: false,
            lastError: error,
            renderProgress: {
              job_id: 'web-batch',
              current_frame: 0,
              total_frames: totalFrames,
              completed: true,
              error: error.message,
            },
          });
        }
      },
      renderSequence: async (nodeId) => {
        const eng = getEngine();

        if (eng.renderSequence) {
          set({ isRendering: true, renderProgress: null, lastError: null });
          try {
            await eng.renderSequence(nodeId);
          } catch (e) {
            const error = parseEngineError(e);
            console.error('[renderSequence] start failed:', error.message);
            set({
              isRendering: false,
              lastError: error,
              renderProgress: {
                job_id: '',
                current_frame: 0,
                total_frames: 0,
                completed: true,
                error: error.message,
              },
            });
            return;
          }

          if (!eng.getJobProgress) {
            set({ isRendering: false });
            return;
          }

          const pollInterval = setInterval(async () => {
            try {
              const progress = await eng.getJobProgress!();
              if (!progress) return;
              set({ renderProgress: progress });
              if (progress.completed) {
                clearInterval(pollInterval);
                set({
                  isRendering: false,
                  lastError: progress.error ? makeEngineError(progress.error) : null,
                });
              }
            } catch (e) { clearInterval(pollInterval); set({ isRendering: false, lastError: parseEngineError(e) }); }
          }, 250);
          return;
        }

        const node = get().nodes.get(nodeId);
        if (!node) return;

        const { hasSequenceNodes, sequenceStart, sequenceLength } = get();

        let startFrame = node.params['start_frame'] && 'Int' in node.params['start_frame']
          ? node.params['start_frame'].Int : 0;
        let endFrame = node.params['end_frame'] && 'Int' in node.params['end_frame']
          ? node.params['end_frame'].Int : 100;

        // Use detected sequence range when available — the node params may not
        // have been synced yet due to the async useEffect in the component.
        if (hasSequenceNodes && sequenceLength > 0) {
          startFrame = sequenceStart;
          endFrame = sequenceLength;
        }

        const step = node.params['step'] && 'Int' in node.params['step']
          ? node.params['step'].Int : 1;
        const formatIdx = node.params['format'] && 'Int' in node.params['format']
          ? node.params['format'].Int : 0;

        if (step <= 0 || startFrame > endFrame) {
          set({ lastError: makeEngineError('Invalid frame range') });
          return;
        }

        const totalFrames = Math.floor((endFrame - startFrame) / step) + 1;
        const ext = formatIdx === 1 ? 'jpg' : 'png';
        const padding = Math.max(4, String(endFrame).length);

        webRenderCancelled = false;
        set({
          isRendering: true,
          lastError: null,
          renderProgress: {
            job_id: 'web',
            current_frame: 0,
            total_frames: totalFrames,
            completed: false,
            error: null,
          },
        });

        try {
          const JSZip = (await import('jszip')).default;
          const zip = new JSZip();
          let renderedCount = 0;

          for (let frame = startFrame; frame <= endFrame; frame += step) {
            if (webRenderCancelled) break;

            await pushSequenceFrames(frame);
            const bytes = await eng.exportImage(nodeId, frame);

            const frameStr = String(frame).padStart(padding, '0');
            zip.file(`${frameStr}.${ext}`, bytes);

            renderedCount++;
            set({
              renderProgress: {
                job_id: 'web',
                current_frame: renderedCount,
                total_frames: totalFrames,
                completed: false,
                error: null,
              },
            });
          }

          if (!webRenderCancelled) {
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `sequence.zip`;
            a.click();
            URL.revokeObjectURL(url);
          }

          set({
            isRendering: false,
            renderProgress: {
              job_id: 'web',
              current_frame: renderedCount,
              total_frames: totalFrames,
              completed: true,
              error: webRenderCancelled ? 'Cancelled' : null,
            },
          });
        } catch (e) {
          const error = parseEngineError(e);
          set({
            isRendering: false,
            lastError: error,
            renderProgress: {
              job_id: 'web',
              current_frame: 0,
              total_frames: totalFrames,
              completed: true,
              error: error.message,
            },
          });
        }
      },

      renderVideo: async (nodeId) => {
        const eng = getEngine();
        if (!eng.renderVideo) {
          set({ lastError: makeEngineError('Video rendering is only available in the desktop app') });
          return;
        }
        set({ isRendering: true, renderProgress: null, lastError: null });
        try {
          await eng.renderVideo(nodeId);
        } catch (e) {
          const error = parseEngineError(e);
          set({
            isRendering: false,
            lastError: error,
            renderProgress: {
              job_id: '',
              current_frame: 0,
              total_frames: 0,
              completed: true,
              error: error.message,
            },
          });
          return;
        }

        if (!eng.getJobProgress) {
          set({ isRendering: false });
          return;
        }

        const pollInterval = setInterval(async () => {
          try {
            const progress = await eng.getJobProgress!();
            if (!progress) return;
            set({ renderProgress: progress });
            if (progress.completed) {
              clearInterval(pollInterval);
              set({
                isRendering: false,
                lastError: progress.error ? makeEngineError(progress.error) : null,
              });
            }
          } catch (e) { clearInterval(pollInterval); set({ isRendering: false, lastError: parseEngineError(e) }); }
        }, 250);
      },

      cancelRender: async () => {
        const eng = getEngine();
        if (eng.cancelJob) {
          await eng.cancelJob();
        }
        webRenderCancelled = true;
        set({ isRendering: false });
      },

      newProject: async () => {
        const eng = getEngine();
        const emptyGraph = { nodes: [], connections: [] };
        if (eng.importDocument) {
          await eng.importDocument(emptyGraph);
        } else {
          await eng.importGraph(emptyGraph);
        }
        set({
          nodes: new Map(),
          connections: [],
          selectedNodeIds: new Set(),
          frames: new Map(),
          selectedFrameId: null,
          renderResults: new Map(),
          editingStack: [{ id: 'root', label: 'Root' }],
          dirty: false,
          lastError: null,
          hasSequenceNodes: false,
          sequenceInfoMap: new Map(),

           nodeTimings: new Map(),
           aiNodeStatuses: {},
           aiNodeStale: {},
         });
       },

       saveProject: () => {
        const eng = getEngine();
        if (isTauri() && eng.saveProject) {
          import('@tauri-apps/plugin-dialog').then(({ save }) => {
            save({
              filters: [{ name: 'Compositor Project', extensions: ['compositor'] }],
              defaultPath: 'project.compositor',
            }).then(async path => {
              if (path) {
                await eng.saveProject?.(path);
                set({ dirty: false });
              }
            });
          });
          return;
        }

        const exportPromise = eng.exportDocument
          ? Promise.resolve(eng.exportDocument())
          : Promise.resolve(eng.exportGraph()).then(graphData => createDocumentEnvelope(graphData));

        exportPromise.then(projectDoc => {
          const framesArray = Array.from(get().frames.values());
          if (framesArray.length > 0) {
            (projectDoc as any).frames = framesArray;
          }
          const json = JSON.stringify(projectDoc, null, 2);
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'project.compositor';
          link.click();
          URL.revokeObjectURL(url);
          set({ dirty: false });
        });
      },

      compileScriptNode: async (nodeId, manifestJson) => {
        const eng = getEngine();
        if (!eng.compileScriptNode) throw new Error("Engine doesn't support script compilation");
        const spec = await eng.compileScriptNode(nodeId, manifestJson);
        const specs = await eng.listNodeTypes();
        
        // Manually merge the compiled spec because listNodeTypes filters out gpu_script nodes
        const existingIdx = specs.findIndex(s => s.id === spec.id);
        if (existingIdx >= 0) {
          specs[existingIdx] = spec;
        } else {
          specs.push(spec);
        }

        set({ nodeSpecs: specs, dirty: true });
        triggerAllViewers();
        return spec;
      },

      play: () => {
        if (get().isPlaying) return;
        const { currentFrame, sequenceLength, sequenceStart } = get();
        const end = sequenceLength || 999;
        const startFrame = currentFrame >= end ? sequenceStart : currentFrame;
        set({ isPlaying: true, currentFrame: startFrame, playbackFps: null });
        playbackAborted = false;

        const loop = async () => {
          let prevFrameStart: number | null = null;
          const fpsWindow: number[] = [];
          const FPS_WINDOW_SIZE = 20;

          while (!playbackAborted) {
            const frameStart = performance.now();
            const { fps, sequenceLength: seqLen, loopPlayback, sequenceStart: seqStart } = get();
            const endFrame = seqLen || 999;
            const interval = 1000 / fps;

            if (prevFrameStart !== null) {
              const frameDelta = frameStart - prevFrameStart;
              fpsWindow.push(1000 / frameDelta);
              if (fpsWindow.length > FPS_WINDOW_SIZE) fpsWindow.shift();
            }
            prevFrameStart = frameStart;

            renderAllViewersAsync();
            await renderLock;

            if (playbackAborted) break;

            if (fpsWindow.length > 0) {
              const avgFps = fpsWindow.reduce((a, b) => a + b, 0) / fpsWindow.length;
              set({ playbackFps: avgFps });
            }

            const { currentFrame: cur } = get();
            const next = cur + 1;

            if (next > endFrame) {
              if (loopPlayback) {
                set({ currentFrame: seqStart });
              } else {
                get().pause();
                return;
              }
            } else {
              set({ currentFrame: next });
            }

            const renderTime = performance.now() - frameStart;
            const remaining = interval - renderTime;
            if (remaining > 0) {
              await new Promise<void>(resolve => {
                playbackTimeoutId = setTimeout(resolve, remaining);
              });
            }
          }
        };

        loop();
      },

      pause: () => {
        playbackAborted = true;
        if (playbackTimeoutId !== null) {
          clearTimeout(playbackTimeoutId);
          playbackTimeoutId = null;
        }
        set({ isPlaying: false, playbackFps: null });
      },

      togglePlayback: () => {
        if (get().isPlaying) {
          get().pause();
        } else {
          get().play();
        }
      },

      stepForward: () => {
        if (get().isPlaying) get().pause();
        const { currentFrame, sequenceLength } = get();
        const end = sequenceLength || 999;
        if (currentFrame < end) {
          set({ currentFrame: currentFrame + 1 });
          triggerAllViewers();
        }
      },

      stepBackward: () => {
        if (get().isPlaying) get().pause();
        const { currentFrame, sequenceStart } = get();
        if (currentFrame > sequenceStart) {
          set({ currentFrame: currentFrame - 1 });
          triggerAllViewers();
        }
      },

      goToStart: () => {
        if (get().isPlaying) get().pause();
        set({ currentFrame: get().sequenceStart });
        triggerAllViewers();
      },

      goToEnd: () => {
        if (get().isPlaying) get().pause();
        const end = get().sequenceLength || 999;
        set({ currentFrame: end });
        triggerAllViewers();
      },

      setFps: (fps) => {
        set({ fps });
        if (get().isPlaying) {
          get().pause();
          get().play();
        }
      },

      setLoopPlayback: (loop_) => {
        set({ loopPlayback: loop_ });
      },

      undo: () => {
        const snapshot = undoStack.pop();
        if (!snapshot) return;
        captureSnapshot().then(async current => {
          redoStack.push(current);
          await restoreSnapshot(snapshot);
        });
      },

      redo: () => {
        const snapshot = redoStack.pop();
        if (!snapshot) return;
        captureSnapshot().then(async current => {
          undoStack.push(current);
          await restoreSnapshot(snapshot);
        });
      },

      isInsideGroup: () => {
        return get().editingStack.length > 1;
      },

      enterGroup: async (groupNodeId) => {
        const eng = getEngine();
        if (!eng.getGroupInternalGraph) {
          set({ lastError: makeEngineError('Group editing not supported by this engine') });
          return;
        }

        const node = get().nodes.get(groupNodeId);
        if (!node) return;

        const internalGraph = await eng.getGroupInternalGraph(groupNodeId);
        const newNodes = new Map<string, NodeInstance>();
        const newConnections: Connection[] = [];

        for (const n of internalGraph.nodes) {
          const spec = get().nodeSpecs.find(s => s.id === n.typeId);
          const params: Record<string, ParamValue> = {};
          if (spec) {
            spec.params.forEach(p => {
              params[p.key] = n.params[p.key] ?? p.default;
            });
          } else {
            Object.assign(params, n.params);
          }
          newNodes.set(n.id, {
            id: n.id,
            typeId: n.typeId,
            params,
            inputDefaults: n.inputDefaults ?? {},
            position: n.position,
            muted: false,
          });
        }

        for (const c of internalGraph.connections) {
          newConnections.push({
            id: crypto.randomUUID(),
            fromNode: c.fromNode,
            fromPort: c.fromPort,
            toNode: c.toNode,
            toPort: c.toPort,
          });
        }

        const context: EditingContext = {
          id: internalGraph.groupDefId,
          label: internalGraph.name,
          groupNodeId,
          groupDefId: internalGraph.groupDefId,
          savedNodes: new Map(get().nodes),
          savedConnections: [...get().connections],
          savedNodeSpecs: [...get().nodeSpecs],
        };

        set({
          editingStack: [...get().editingStack, context],
          nodes: newNodes,
          connections: newConnections,
          nodeSpecs: withGroupIOSpecs(get().nodeSpecs, internalGraph),
          selectedNodeIds: new Set(),
          renderResults: new Map(),
          fitViewRequestId: get().fitViewRequestId + 1,
        });
      },

      exitGroup: () => {
        const stack = get().editingStack;
        if (stack.length <= 1) return;
        get().navigateToBreadcrumb(stack.length - 2);
      },

      navigateToBreadcrumb: async (index) => {
        const stack = get().editingStack;
        if (index < 0 || index >= stack.length) return;
        if (index === stack.length - 1) return;

        const newStack = stack.slice(0, index + 1);
        const eng = getEngine();

        if (index === 0) {
          const childContext = stack[index + 1];
          if (childContext?.savedNodes) {
            const specs = await Promise.resolve(eng.listNodeTypes());
            set({
              editingStack: newStack,
              nodes: childContext.savedNodes,
              connections: childContext.savedConnections ?? [],
              nodeSpecs: specs,
              selectedNodeIds: new Set(),
              renderResults: new Map(),
              fitViewRequestId: get().fitViewRequestId + 1,
            });
            triggerAllViewers();
            return;
          }

          const graphData = await Promise.resolve(eng.exportGraph());
          const data = graphData as any;
          const specs = await Promise.resolve(eng.listNodeTypes());
          const newNodes = new Map<string, NodeInstance>();
          const newConnections: Connection[] = [];

          if (data.nodes) {
            for (const node of data.nodes) {
              const spec = specs.find((s: NodeSpec) => s.id === node.type_id);
              const params: Record<string, ParamValue> = {};
              if (spec) {
                spec.params.forEach((p: { key: string; default: ParamValue }) => {
                  params[p.key] = node.params?.[p.key] ?? p.default;
                });
              }
              newNodes.set(node.id, {
                id: node.id,
                typeId: node.type_id,
                params,
                inputDefaults: node.input_defaults ?? {},
                position: { x: node.position[0], y: node.position[1] },
                muted: node.muted ?? false,
              });
            }
          }

          if (data.connections) {
            for (const conn of data.connections) {
              newConnections.push({
                id: crypto.randomUUID(),
                fromNode: conn.from_node,
                fromPort: conn.from_port,
                toNode: conn.to_node,
                toPort: conn.to_port,
              });
            }
          }

          set({
            editingStack: newStack,
            nodes: newNodes,
            connections: newConnections,
            nodeSpecs: specs,
            selectedNodeIds: new Set(),
            renderResults: new Map(),
              fitViewRequestId: get().fitViewRequestId + 1,
          });
          triggerAllViewers();
        } else {
          const childContext = stack[index + 1];
          if (childContext?.savedNodes) {
            const specs = await Promise.resolve(eng.listNodeTypes());
            set({
              editingStack: newStack,
              nodes: childContext.savedNodes,
              connections: childContext.savedConnections ?? [],
              nodeSpecs: specs,
              selectedNodeIds: new Set(),
              renderResults: new Map(),
            });
            triggerAllViewers();
            return;
          }

          const targetContext = newStack[newStack.length - 1];
          if (targetContext.groupNodeId && eng.getGroupInternalGraph) {
            const internalGraph = await eng.getGroupInternalGraph(targetContext.groupNodeId);
            const newNodes = new Map<string, NodeInstance>();
            const newConnections: Connection[] = [];

            for (const n of internalGraph.nodes) {
              newNodes.set(n.id, {
                id: n.id,
                typeId: n.typeId,
                params: n.params,
                inputDefaults: n.inputDefaults ?? {},
                position: n.position,
                muted: false,
              });
            }

            for (const c of internalGraph.connections) {
              newConnections.push({
                id: crypto.randomUUID(),
                fromNode: c.fromNode,
                fromPort: c.fromPort,
                toNode: c.toNode,
                toPort: c.toPort,
              });
            }

            set({
              editingStack: newStack,
              nodes: newNodes,
              connections: newConnections,
              nodeSpecs: withGroupIOSpecs(get().nodeSpecs, internalGraph),
              selectedNodeIds: new Set(),
              renderResults: new Map(),
              fitViewRequestId: get().fitViewRequestId + 1,
            });
            triggerAllViewers();
          }
        }
      },

      createGroup: async (nodeIds, name) => {
        const eng = getEngine();
        if (!eng.createGroupFromNodes) {
          set({ lastError: makeEngineError('Group creation not supported by this engine') });
          return;
        }

        await pushUndo();
        const result = await eng.createGroupFromNodes(nodeIds, name ?? 'Node Group');

        const newNodes = new Map(get().nodes);
        for (const removedId of result.removedNodeIds) {
          newNodes.delete(removedId);
        }

        const spec = result.newSpec;
        const params: Record<string, ParamValue> = {};
        if (spec) {
          spec.params.forEach(p => {
            params[p.key] = p.default;
          });
        }

        const positions = nodeIds
          .map(id => get().nodes.get(id)?.position)
          .filter((p): p is { x: number; y: number } => p != null);
        const centroidX = positions.reduce((sum, p) => sum + p.x, 0) / (positions.length || 1);
        const centroidY = positions.reduce((sum, p) => sum + p.y, 0) / (positions.length || 1);

        newNodes.set(result.groupNodeId, {
          id: result.groupNodeId,
          typeId: result.groupDefinitionId,
          params,
          inputDefaults: {},
          position: { x: centroidX, y: centroidY },
          muted: false,
        });

        const newConnections = get().connections.filter(
          c => !result.removedNodeIds.includes(c.fromNode) && !result.removedNodeIds.includes(c.toNode)
        );

        const specs = await Promise.resolve(eng.listNodeTypes());

        set({
          nodes: newNodes,
          connections: newConnections,
          nodeSpecs: specs,
          selectedNodeIds: new Set([result.groupNodeId]),
        });

        const graphData = await Promise.resolve(eng.exportGraph());
        const data = graphData as any;
        if (data.connections) {
          const updatedConnections: Connection[] = [];
          for (const conn of data.connections) {
            updatedConnections.push({
              id: crypto.randomUUID(),
              fromNode: conn.from_node,
              fromPort: conn.from_port,
              toNode: conn.to_node,
              toPort: conn.to_port,
            });
          }
          set({ connections: updatedConnections });
        }

        triggerAllViewers();
      },

      ungroupNode: async (groupNodeId) => {
        const eng = getEngine();
        if (!eng.ungroupNode) {
          set({ lastError: makeEngineError('Ungrouping not supported by this engine') });
          return;
        }

        await pushUndo();
        const result = await eng.ungroupNode(groupNodeId);

        const newNodes = new Map(get().nodes);
        newNodes.delete(result.removedGroupNodeId);

        for (const restored of result.restoredNodes) {
          newNodes.set(restored.id, {
            id: restored.id,
            typeId: restored.typeId,
            params: restored.params,
            inputDefaults: restored.inputDefaults,
            position: restored.position,
            muted: false,
          });
        }

        const graphData = await Promise.resolve(eng.exportGraph());
        const data = graphData as any;
        const newConnections: Connection[] = [];
        if (data.connections) {
          for (const conn of data.connections) {
            newConnections.push({
              id: crypto.randomUUID(),
              fromNode: conn.from_node,
              fromPort: conn.from_port,
              toNode: conn.to_node,
              toPort: conn.to_port,
            });
          }
        }

        const specs = await Promise.resolve(eng.listNodeTypes());
        set({
          nodes: newNodes,
          connections: newConnections,
          nodeSpecs: specs,
          selectedNodeIds: new Set(result.restoredNodes.map(n => n.id)),
        });

        triggerAllViewers();
      },

      renameGroup: async (groupNodeId, newName) => {
        const node = get().nodes.get(groupNodeId);
        if (!node || !node.typeId.startsWith('group::')) return;

        const eng = getEngine();
        if (!eng.renameGroup) {
          set({ lastError: makeEngineError('Group rename not supported by this engine') });
          return;
        }

        await pushUndo();
        await eng.renameGroup(node.typeId, newName);

        const specs = await Promise.resolve(eng.listNodeTypes());
        set({ nodeSpecs: specs });
      },


      importCustomNodes: async (json) => {
        const eng = getEngine();
        if (!eng.importCustomNodes) {
          set({ lastError: makeEngineError('Custom node import not supported by this engine') });
          return;
        }
        try {
          const newSpecs = await Promise.resolve(eng.importCustomNodes(json));
          const specs = await Promise.resolve(eng.listNodeTypes());
          set({ nodeSpecs: specs });
          console.log(`[CustomNodes] Imported ${newSpecs.length} custom node(s)`);
        } catch (e) {
          set({ lastError: parseEngineError(e) });
        }
      },

      exportGroupAsPackage: async (groupDefId) => {
        const eng = getEngine();
        if (!eng.exportGroupAsPackage) {
          set({ lastError: makeEngineError('Custom node export not supported by this engine') });
          return;
        }
        try {
          const pkg = await Promise.resolve(eng.exportGroupAsPackage(groupDefId));
          const json = JSON.stringify(pkg, null, 2);
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          // Extract a readable name from the groupDefId (e.g. 'group::My Filter' -> 'My Filter')
          const name = groupDefId.replace(/^group::/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
          a.href = url;
          a.download = `${name}.compnode`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (e) {
          set({ lastError: parseEngineError(e) });
        }
      },
      updateGroupInterface: async (inputs, outputs) => {
        const stack = get().editingStack;
        if (stack.length <= 1) return;
        const currentContext = stack[stack.length - 1];
        if (!currentContext.groupDefId || !currentContext.groupNodeId) return;

        const eng = getEngine();
        if (!eng.updateGroupInterface || !eng.getGroupInternalGraph) {
          set({ lastError: makeEngineError('Group interface update not supported by this engine') });
          return;
        }

        const currentGraph = await eng.getGroupInternalGraph(currentContext.groupNodeId);
        const resolvedInputs = inputs ?? currentGraph.inputs;
        const resolvedOutputs = outputs ?? currentGraph.outputs;

        await pushUndo();
        const updatedSpec = await eng.updateGroupInterface(currentContext.groupDefId, resolvedInputs, resolvedOutputs);

        const specs = await Promise.resolve(eng.listNodeTypes());
        const internalGraph = await eng.getGroupInternalGraph(currentContext.groupNodeId);
        const newNodes = new Map<string, NodeInstance>();
        const newConnections: Connection[] = [];

        for (const n of internalGraph.nodes) {
          const nSpec = specs.find(s => s.id === n.typeId) ?? updatedSpec;
          const params: Record<string, ParamValue> = {};
          if (nSpec) {
            nSpec.params.forEach(p => {
              params[p.key] = n.params[p.key] ?? p.default;
            });
          } else {
            Object.assign(params, n.params);
          }
          newNodes.set(n.id, {
            id: n.id,
            typeId: n.typeId,
            params,
            inputDefaults: n.inputDefaults ?? {},
            position: n.position,
            muted: false,
          });
        }

        for (const c of internalGraph.connections) {
          newConnections.push({
            id: crypto.randomUUID(),
            fromNode: c.fromNode,
            fromPort: c.fromPort,
            toNode: c.toNode,
            toPort: c.toPort,
          });
        }

        set({
          nodes: newNodes,
          connections: newConnections,
          nodeSpecs: withGroupIOSpecs(specs, internalGraph),
        });
      },

      loadProjectFromPath: () => {
        const eng = getEngine();
        if (!isTauri() || !eng.loadProject) {
          set({ lastError: makeEngineError('Project loading is only available in the desktop app') });
          return;
        }

        import('@tauri-apps/plugin-dialog').then(({ open }) => {
          open({
            filters: [{ name: 'Compositor Project', extensions: ['compositor'] }],
            multiple: false,
          }).then(async path => {
            if (typeof path === 'string') {
              const loaded = await eng.loadProject?.(path);
              const graphData = extractGraphData(loaded);
              applyGraphData(graphData);
              const framesData: Frame[] = Array.isArray((loaded as any).frames) ? (loaded as any).frames : [];
              const frameMap = new Map<string, Frame>();
              for (const frame of framesData) {
                frameMap.set(frame.id, frame);
              }
              set({ frames: frameMap });
            }
          });
        });
      },

      loadProject: (file) => {
        file.text().then(async text => {
          let data = JSON.parse(text);
          const eng = getEngine();

          // Run migrations if needed
          if (eng?.needsMigration) {
            try {
              if (eng.needsMigration(text)) {
                const migratedJson = eng.migrateDocument!(text);
                data = JSON.parse(migratedJson);
                console.info('[Migration] Project upgraded to latest format');
              }
            } catch (e) {
              console.warn('[Migration] Migration failed, loading original:', e);
              // Continue with original data — migration failure shouldn't block loading
            }
          }

          const graphData = extractGraphData(data);

          if (eng.importDocument) {
            await eng.importDocument(data);
          } else {
            await eng.importGraph(graphData);
          }

          applyGraphData(graphData);
          const framesData: Frame[] = Array.isArray((data as any).frames) ? (data as any).frames : [];
          const frameMap = new Map<string, Frame>();
          for (const frame of framesData) {
            frameMap.set(frame.id, frame);
          }
          set({ frames: frameMap });
        });
      },

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

      refreshAiNodeStale: () => {
        const eng = getEngine();
        if (!eng.getNodeExecutionState) return;
        const state = get();
        const newStale: Record<string, boolean> = {};
        for (const nodeId of Object.keys(state.aiNodeStatuses)) {
          const execState = eng.getNodeExecutionState(nodeId);
          newStale[nodeId] = execState.isStale;
        }
        set({ aiNodeStale: newStale });
      },

      runAiNode: async (nodeId) => {
        const eng = getEngine();
        if (!eng.runAiNode) return;
        set(state => ({
          aiNodeStatuses: { ...state.aiNodeStatuses, [nodeId]: 'running' }
        }));
        try {
          await eng.runAiNode(nodeId);
          set(state => ({
            aiNodeStatuses: { ...state.aiNodeStatuses, [nodeId]: 'complete' },
            aiNodeStale: { ...state.aiNodeStale, [nodeId]: false },
          }));
          renderAllViewersAsync();
        } catch (e) {
          const execState = eng.getNodeExecutionState?.(nodeId);
          set(state => ({
            aiNodeStatuses: { ...state.aiNodeStatuses, [nodeId]: `error:${execState?.error ?? e}` }
          }));
        }
      },

      loadColorManagementInfo: async () => {
        const eng = getEngine();
        if (eng.getColorManagementInfo) {
          const info = await eng.getColorManagementInfo();
          set({ colorManagement: info });
        }
      },

      getViewsForDisplay: async (display: string) => {
        const eng = getEngine();
        if (eng.getViewsForDisplay) {
          return eng.getViewsForDisplay(display);
        }
        return [];
      },

      setDisplayView: async (display: string, view: string) => {
        const eng = getEngine();
        if (eng.setDisplayView) {
          await eng.setDisplayView(display, view);
          const cm = get().colorManagement;
          if (cm) {
            set({ colorManagement: { ...cm, activeDisplay: display, activeView: view } });
          }
          renderAllViewersAsync();
        }
      },

      setProjectFormat: async (width: number, height: number) => {
        const eng = getEngine();
        if (eng.setProjectFormat) {
          await eng.setProjectFormat(width, height);
          useSettingsStore.getState().setProjectFormat(width, height);
          renderAllViewersAsync();
        }
      },

      graphRevision: 0,
      lastTransactionOrigin: null,
      aiActionInProgress: false,

      beginAiAction: async () => {
        set({ aiActionInProgress: true });
      },
      endAiAction: () => {
        set({ aiActionInProgress: false });
      },

      flushRender: async () => {
        if (renderNeededWhileSuspended) {
          renderNeededWhileSuspended = false;
          triggerAllViewers();
        }
        await renderLock;
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

        renderSuspendCount++;
        graphRevision++;
        set({
          lastTransactionOrigin: options.origin,
          graphRevision,
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

        renderSuspendCount--;

        if (options.awaitRender && renderSuspendCount <= 0) {
          renderSuspendCount = 0;
          if (renderNeededWhileSuspended) {
            renderNeededWhileSuspended = false;
            triggerAllViewers();
          }
          await renderLock;
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
        } else if (renderSuspendCount <= 0) {
          renderSuspendCount = 0;
          if (renderNeededWhileSuspended) {
            renderNeededWhileSuspended = false;
            triggerAllViewers();
          }
        }

        if (snapshot && !options.suppressUndo) {
          undoStack.push(snapshot);
          if (undoStack.length > useSettingsStore.getState().maxUndoSteps) undoStack.shift();
          redoStack.length = 0;
          set({ canUndo: undoStack.length > 0, canRedo: false, dirty: true });
        }

        return {
          success,
          diagnostics,
          graphRevision,
        };
      },

      linkToViewer: async (nodeId, outputIndex) => {
        const { nodes, nodeSpecs } = get();
        const clickedNode = nodes.get(nodeId);
        if (!clickedNode) return;

        const clickedSpec = nodeSpecs.find(s => s.id === clickedNode.typeId);
        if (!clickedSpec || clickedSpec.outputs.length === 0) return;

        // Determine which output to connect
        const idx = outputIndex ?? 0;
        const output = clickedSpec.outputs[idx % clickedSpec.outputs.length];

        // Find an existing viewer node
        let viewerNodeId: string | null = null;
        for (const [id, node] of nodes) {
          if (node.typeId === 'viewer') {
            viewerNodeId = id;
            break;
          }
        }

        // If no viewer exists, create one to the right of all existing nodes
        if (!viewerNodeId) {
          let maxX = -Infinity;
          let avgY = 0;
          let count = 0;
          for (const node of nodes.values()) {
            if (node.position.x > maxX) maxX = node.position.x;
            avgY += node.position.y;
            count++;
          }
          if (count > 0) avgY /= count;
          else avgY = 0;
          if (!isFinite(maxX)) maxX = 0;

          const viewerX = maxX + 400;
          const viewerY = avgY;

          viewerNodeId = await get().addNode('viewer', { x: viewerX, y: viewerY });
        }

        // Re-read connections from current state (addNode may have mutated)
        const currentConnections = get().connections;

        // Disconnect any existing connection going into the viewer's "value" input
        const existingConn = currentConnections.find(
          c => c.toNode === viewerNodeId && c.toPort === 'value'
        );
        if (existingConn) {
          await get().disconnect(existingConn.id);
        }

        // Connect the clicked node's output to the viewer's input
        await get().connect(nodeId, output.name, viewerNodeId, 'value');
      },
    };
  })
);

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as any).__compositorStore = useGraphStore;
}
