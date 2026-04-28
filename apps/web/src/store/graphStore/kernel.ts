import type {
  NodeInstance,
  Connection,
  NodeSpec,
  PortSpec,
  ParamValue,
  ViewerResult,
  EditingContext,
  GroupInternalGraph,
  Frame,
  SerializableGroupDefinition,
} from '../types';
import { isPixelResult } from '../types';
import type { EngineBridge, SequenceInfo, VideoInfo } from '../../engine/bridge';
import { isDesktopRuntime } from '../../platform/runtime';
import { useSettingsStore } from '../settingsStore';

export const DEFAULT_FRAME_COLOR = 'purple';

/** Sentinel port name appended to GroupInput outputs — drag from this to create a new group input. */
export const ADD_OUTPUT_PORT = '__add_output';
/** Sentinel port name appended to GroupOutput inputs — drag to this to create a new group output. */
export const ADD_INPUT_PORT = '__add_input';

export const kernel = {
  engine: null as EngineBridge | null,
  renderGenerations: new Map<string, number>(),
  idlePreviewTimer: null as ReturnType<typeof setTimeout> | null,
  liveRenderGeneration: 0,
  undoStack: [] as AnyUndoSnapshot[],
  redoStack: [] as AnyUndoSnapshot[],
  liveRenderRaf: null as number | null,
  preCommitSnapshot: null as AnyUndoSnapshot | null,
  pendingLiveRender: null as (() => void) | null,
  playbackTimeoutId: null as ReturnType<typeof setTimeout> | null,
  playbackAborted: false,
  webRenderCancelled: false,
  renderLock: Promise.resolve() as Promise<void>,
  renderSuspendCount: 0,
  renderNeededWhileSuspended: false,
  graphRevision: 0,
  /** Guards against concurrent undo/redo operations. Resolves when the current operation completes. */
  undoLock: Promise.resolve() as Promise<void>,
};

export function buildGroupIOSpecs(
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

export function withGroupIOSpecs(specs: NodeSpec[], internalGraph: GroupInternalGraph): NodeSpec[] {
  const { groupInputSpec, groupOutputSpec } = buildGroupIOSpecs(internalGraph);
  return [
    ...specs.filter(s => s.id !== 'group_input' && s.id !== 'group_output'),
    groupInputSpec,
    groupOutputSpec,
  ];
}

export const cloneEditingStack = (stack: EditingContext[]): EditingContext[] =>
  stack.map(ctx => ({
    ...ctx,
    savedNodes: ctx.savedNodes ? new Map(ctx.savedNodes) : undefined,
    savedConnections: ctx.savedConnections ? [...ctx.savedConnections] : undefined,
    savedNodeSpecs: ctx.savedNodeSpecs ? [...ctx.savedNodeSpecs] : undefined,
  }));

export const nextRenderGeneration = (viewerNodeId: string): number => {
  const next = (kernel.renderGenerations.get(viewerNodeId) ?? 0) + 1;
  kernel.renderGenerations.set(viewerNodeId, next);
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

export const downscaleRenderResult = async (result: ViewerResult, scale: number): Promise<ViewerResult> => {
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
  const sourceImage: CanvasImageSource = sourceCanvas;
  targetCtx.drawImage(sourceImage, 0, 0, targetWidth, targetHeight);

  const scaledImage = targetCtx.getImageData(0, 0, targetWidth, targetHeight);
  return {
    ...result,
    width: targetWidth,
    height: targetHeight,
    pixels: scaledImage.data,
    previewScale: scale,
    originalWidth: result.originalWidth ?? result.width,
    originalHeight: result.originalHeight ?? result.height,
  };
};

export type GraphNodeData = {
  id: string;
  type_id: string;
  params?: Record<string, ParamValue>;
  input_defaults?: Record<string, ParamValue>;
  position: [number, number];
  muted?: boolean;
};

export type GraphConnectionData = {
  from_node: string;
  from_port: string;
  to_node: string;
  to_port: string;
};

export type SerializableGraphData = {
  nodes?: GraphNodeData[];
  connections?: GraphConnectionData[];
  group_definitions?: SerializableGroupDefinition[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const isDocumentEnvelope = (value: unknown): value is { cascade: unknown; graph: unknown } => (
  isRecord(value) && ('cascade' in value || 'compositor' in value) && 'graph' in value
);

export const extractGraphData = (value: unknown): SerializableGraphData => {
  if (isDocumentEnvelope(value)) {
    return isRecord(value.graph) ? value.graph as SerializableGraphData : {};
  }
  return isRecord(value) ? value as SerializableGraphData : {};
};

export const extractCustomGroupDefinitions = (value: unknown): SerializableGroupDefinition[] => {
  const graph = extractGraphData(value);
  return Array.isArray(graph.group_definitions)
    ? graph.group_definitions.filter(definition => !definition.is_builtin)
    : [];
};

export const extractFrames = (value: unknown): Frame[] => {
  const record = asRecord(value);
  return Array.isArray(record.frames) ? record.frames as Frame[] : [];
};

export const normalizeParamValue = (value: ParamValue): ParamValue => {
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

export const createDocumentEnvelope = (graph: unknown) => ({
  cascade: {
    format_version: '1.3.0',
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

export function isTauri(): boolean {
  return isDesktopRuntime();
}

export async function createEngine(): Promise<EngineBridge> {
  if (isTauri()) {
    const { tauriEngine } = await import('../../engine/tauriEngine');
    return tauriEngine;
  }

  // Use Web Worker by default for non-blocking UI.
  // Opt out with ?noworker=true in the URL.
  const noWorker = new URLSearchParams(globalThis.location?.search ?? '').has('noworker');
  if (!noWorker && typeof Worker !== 'undefined') {
    try {
      const { WorkerEngine } = await import('../../engine/workerEngine');
      const engine = new WorkerEngine();
      await engine.init();
      console.info('[Cascade] Engine running in Web Worker');
      return engine;
    } catch (err) {
      console.warn('[Cascade] Worker engine failed, falling back to main-thread engine:', err);
    }
  }

  // Fallback: run WASM engine on main thread
  const { initWasmEngine, wasmEngine } = await import('../../engine/wasmEngine');
  await initWasmEngine();
  console.info('[Cascade] Engine running on main thread');
  return wasmEngine;
}

export function getEngine(): EngineBridge {
  if (!kernel.engine) throw new Error('Engine not initialized');
  return kernel.engine;
}

export interface UndoSnapshot {
  engineState: unknown;
  nodes: Map<string, NodeInstance>;
  connections: Connection[];
  frames: Map<string, Frame>;
  editingStack: EditingContext[];
  /** Compressed original image bytes per LoadImage node id */
  imageData: Map<string, Uint8Array>;
  /** Sequence metadata per LoadImageSequence node id */
  sequenceInfoMap: Map<string, SequenceInfo | VideoInfo>;
  /** @internal Promise resolving to engineState — awaited on commit to prevent incomplete snapshots */
  _pendingEngineState?: Promise<unknown>;
  /** @internal Promise resolving to imageData — awaited on commit to prevent incomplete snapshots */
  _pendingImageData?: Promise<Map<string, Uint8Array>>;
}

/** Type guard to distinguish SequenceInfo from VideoInfo */
export const isSequenceInfo = (info: SequenceInfo | VideoInfo): info is SequenceInfo => (
  'first_frame' in info && 'last_frame' in info
);

// ---------------------------------------------------------------------------
// Param-delta snapshots — lightweight undo for parameter-only edits
// ---------------------------------------------------------------------------

export interface ParamDeltaSnapshot {
  kind: 'param-delta';
  editType: 'param' | 'inputDefault';
  nodeId: string;
  key: string;
  oldValue: ParamValue | undefined;
  newValue?: ParamValue;
  /** Pre-edit Zustand state for full restoration */
  nodes: Map<string, NodeInstance>;
  connections: Connection[];
  frames: Map<string, Frame>;
  editingStack: EditingContext[];
  sequenceInfoMap: Map<string, SequenceInfo | VideoInfo>;
}

// ---------------------------------------------------------------------------
// Mute-delta snapshots — lightweight undo for mute toggles
// ---------------------------------------------------------------------------

export interface MuteDeltaEntry {
  nodeId: string;
  oldMuted: boolean;
  newMuted: boolean;
}

export interface MuteDeltaSnapshot {
  kind: 'mute-delta';
  entries: MuteDeltaEntry[];
  /** Pre-edit Zustand state for full restoration */
  nodes: Map<string, NodeInstance>;
  connections: Connection[];
  frames: Map<string, Frame>;
  editingStack: EditingContext[];
  sequenceInfoMap: Map<string, SequenceInfo | VideoInfo>;
}

export type AnyUndoSnapshot = UndoSnapshot | ParamDeltaSnapshot | MuteDeltaSnapshot;

export const isParamDelta = (s: AnyUndoSnapshot): s is ParamDeltaSnapshot =>
  'kind' in s && s.kind === 'param-delta';

export const isMuteDelta = (s: AnyUndoSnapshot): s is MuteDeltaSnapshot =>
  'kind' in s && s.kind === 'mute-delta';

// ---------------------------------------------------------------------------
// Synchronous delta-push helpers — shared by graphSlice and paramController
// ---------------------------------------------------------------------------

/**
 * Push a param-delta snapshot synchronously onto the undo stack.
 * No Worker calls, no exportGraph, no collectImageData.
 * Used by graphSlice.setParam / setInputDefault for instant undo capture.
 */
export function pushParamDeltaSync(
  editType: 'param' | 'inputDefault',
  nodeId: string,
  key: string,
  get: () => GraphStoreReadonly,
  set: (partial: { canUndo: boolean; canRedo: boolean; dirty?: boolean }) => void,
): void {
  const node = get().nodes.get(nodeId);
  const oldValue =
    editType === 'param'
      ? node?.params[key]
      : node?.inputDefaults?.[key];

  const delta: ParamDeltaSnapshot = {
    kind: 'param-delta',
    editType,
    nodeId,
    key,
    oldValue,
    nodes: new Map(get().nodes),
    connections: [...get().connections],
    frames: new Map(get().frames),
    editingStack: cloneEditingStack(get().editingStack),
    sequenceInfoMap: new Map(get().sequenceInfoMap),
  };

  kernel.undoStack.push(delta);
  if (kernel.undoStack.length > _maxUndoSteps()) kernel.undoStack.shift();
  kernel.redoStack.length = 0;
  set({ canUndo: true, canRedo: false, dirty: true });
}

/**
 * Push a mute-delta snapshot synchronously onto the undo stack.
 */
export function pushMuteDeltaSync(
  entries: MuteDeltaEntry[],
  get: () => GraphStoreReadonly,
  set: (partial: { canUndo: boolean; canRedo: boolean; dirty?: boolean }) => void,
): void {
  const delta: MuteDeltaSnapshot = {
    kind: 'mute-delta',
    entries,
    nodes: new Map(get().nodes),
    connections: [...get().connections],
    frames: new Map(get().frames),
    editingStack: cloneEditingStack(get().editingStack),
    sequenceInfoMap: new Map(get().sequenceInfoMap),
  };

  kernel.undoStack.push(delta);
  if (kernel.undoStack.length > _maxUndoSteps()) kernel.undoStack.shift();
  kernel.redoStack.length = 0;
  set({ canUndo: true, canRedo: false, dirty: true });
}

// Minimal read-only shape of GraphState needed by sync helpers.
// Avoids circular import of the full GraphState type.
export interface GraphStoreReadonly {
  nodes: Map<string, NodeInstance>;
  connections: Connection[];
  frames: Map<string, Frame>;
  editingStack: EditingContext[];
  sequenceInfoMap: Map<string, SequenceInfo | VideoInfo>;
}

/** Lazily read max undo steps from settings store. */
function _maxUndoSteps(): number {
  return useSettingsStore.getState().maxUndoSteps;
}
