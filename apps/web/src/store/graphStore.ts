import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  NodeInstance,
  Connection,
  NodeSpec,
  PortSpec,
  ParamValue,
  RenderResult,
  EditingContext,
  GroupInternalGraph,
} from './types';
import type { EngineBridge, JobProgress, SequenceInfo } from '../engine/bridge';

let engine: EngineBridge | null = null;

function buildGroupIOSpecs(
  internalGraph: GroupInternalGraph,
): { groupInputSpec: NodeSpec; groupOutputSpec: NodeSpec } {
  return {
    groupInputSpec: {
      id: 'group_input',
      display_name: 'Group Input',
      category: 'Group',
      description: 'Inputs to this group',
      inputs: [],
      outputs: internalGraph.inputs,
      params: [],
    },
    groupOutputSpec: {
      id: 'group_output',
      display_name: 'Group Output',
      category: 'Group',
      description: 'Outputs from this group',
      inputs: internalGraph.outputs,
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

const downscaleRenderResult = async (result: RenderResult, scale: number): Promise<RenderResult> => {
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
  position: [number, number];
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
    format_version: '1.0.0',
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
  editingStack: EditingContext[];
}

interface GraphState {
  nodes: Map<string, NodeInstance>;
  connections: Connection[];
  selectedNodeIds: Set<string>;
  nodeSpecs: NodeSpec[];
  engineReady: boolean;
  renderResults: Map<string, RenderResult>;
  lastError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  currentFrame: number;
  renderProgress: JobProgress | null;
  isRendering: boolean;
  previewScale: number;

  hasSequenceNodes: boolean;
  sequenceLength: number;
  sequenceStart: number;
  sequenceInfoMap: Map<string, SequenceInfo>;
  isPlaying: boolean;
  fps: number;
  loopPlayback: boolean;

  nodeTimings: Map<string, number>;

  initEngine: () => Promise<void>;
  addNode: (typeId: string, position: { x: number; y: number }) => Promise<string>;
  removeNode: (id: string) => Promise<void>;
  connect: (fromNode: string, fromPort: string, toNode: string, toPort: string) => Promise<void>;
  disconnect: (connectionId: string) => Promise<void>;
  setParam: (nodeId: string, key: string, value: ParamValue) => Promise<void>;
  setParamLive: (nodeId: string, key: string, value: ParamValue) => Promise<void>;
  setParamCommit: (nodeId: string, key: string, value: ParamValue) => Promise<void>;
  setPosition: (nodeId: string, position: { x: number; y: number }) => void;
  selectNode: (id: string | null) => void;
  setSelectedNodes: (ids: string[]) => void;
  loadImageFile: (nodeId: string, file: File) => void;
  triggerRender: (viewerNodeId: string) => void;
  saveProject: () => void;
  loadProject: (file: File) => void;
  loadProjectFromPath?: () => void;
  exportImage: (nodeId: string) => void;
  setCurrentFrame: (frame: number) => void;
  setSequenceDirectory: (nodeId: string, directory: string) => Promise<void>;
  renderSequence: (nodeId: string) => Promise<void>;
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
  isInsideGroup: () => boolean;
  updateGroupInterface: (inputs: PortSpec[] | null, outputs: PortSpec[] | null) => Promise<void>;
}

const MAX_UNDO = 50;
const undoStack: UndoSnapshot[] = [];
const redoStack: UndoSnapshot[] = [];

let liveRenderRaf: number | null = null;
let preCommitSnapshot: UndoSnapshot | null = null;
let pendingLiveRender: (() => void) | null = null;
let playbackTimeoutId: ReturnType<typeof setTimeout> | null = null;
let playbackAborted = false;

export const useGraphStore = create<GraphState>()(
  devtools((set, get) => {
    const triggerAllViewers = () => {
      const { nodes } = get();
      for (const [viewerId, node] of nodes) {
        if (node.typeId === 'viewer' || node.typeId === 'export_image' || node.typeId === 'export_image_sequence') {
          get().triggerRender(viewerId);
        }
      }
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
              params[p.key] = node.params?.[p.key] ?? p.default;
            });
          } else if (node.params) {
            Object.assign(params, node.params);
          }
          const [x, y] = node.position;
          newNodes.set(node.id, {
            id: node.id,
            typeId: node.type_id,
            params,
            position: { x, y },
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
        renderResults: new Map(),
        editingStack: [{ id: 'root', label: 'Root' }],
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

    const renderAllViewersAsync = async () => {
      const { nodes } = get();
      const frame = get().currentFrame;
      const scale = get().previewScale;
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
        } catch {
        }
      }
      if (changed) {
        set({ renderResults: newResults, lastError: null });
        updateNodeTimings();
      }
    };

    const recomputeSequenceState = () => {
      const { nodes, sequenceInfoMap } = get();
      let hasSeq = false;
      for (const [, node] of nodes) {
        if (node.typeId === 'load_image_sequence') {
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

    const pushUndo = async () => {
      const snapshot: UndoSnapshot = {
        engineState: await getEngine().exportGraph(),
        nodes: new Map(get().nodes),
        connections: [...get().connections],
        editingStack: [...get().editingStack],
      };
      undoStack.push(snapshot);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      redoStack.length = 0;
      set({ canUndo: undoStack.length > 0, canRedo: false });
    };

    const restoreSnapshot = async (snapshot: UndoSnapshot) => {
      await getEngine().importGraph(snapshot.engineState);
      set({
        nodes: new Map(snapshot.nodes),
        connections: [...snapshot.connections],
        editingStack: [...snapshot.editingStack],
        selectedNodeIds: new Set(),
        renderResults: new Map(),
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
      });
      triggerAllViewers();
    };

    return {
      nodes: new Map(),
      connections: [],
      selectedNodeIds: new Set(),
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
      hasSequenceNodes: false,
      sequenceLength: 0,
      sequenceStart: 0,
      sequenceInfoMap: new Map(),
      isPlaying: false,
      fps: useSettingsStore.getState().defaultFps,
      loopPlayback: useSettingsStore.getState().loopPlayback,
      editingStack: [{ id: 'root', label: 'Root' }],

      nodeTimings: new Map(),

      initEngine: async () => {
        engine = await createEngine();
        const specs = await engine.listNodeTypes();
        set({ engineReady: true, nodeSpecs: specs });
      },

      addNode: async (typeId, position) => {
        await pushUndo();

        const id = await getEngine().addNode(typeId, position.x, position.y);

        const spec = get().nodeSpecs.find(s => s.id === typeId);
        const params: Record<string, ParamValue> = {};

        if (spec) {
          spec.params.forEach(p => {
            params[p.key] = p.default;
          });
        }

        const newNodes = new Map(get().nodes);
        newNodes.set(id, {
          id,
          typeId,
          params,
          position
        });

        set({ nodes: newNodes });
        if (typeId === 'load_image_sequence') {
          recomputeSequenceState();
        }
        return id;
      },

      removeNode: async (id) => {
        await pushUndo();
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
          recomputeSequenceState();
        }
      },

      connect: async (fromNode, fromPort, toNode, toPort) => {
        await pushUndo();
        const exists = get().connections.some(
          c => c.fromNode === fromNode && c.fromPort === fromPort && 
               c.toNode === toNode && c.toPort === toPort
        );
        if (exists) return;

        const eng = getEngine();
        const editingStack = get().editingStack;
        if (editingStack.length > 1) {
          const ctx = editingStack[editingStack.length - 1];
          if (!eng.addInternalConnection || !eng.getGroupInternalGraph) {
            set({ lastError: 'Group editing not supported by this engine' });
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
            set({ lastError: 'Group editing not supported by this engine' });
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
        const conn = get().connections.find(c => c.id === connectionId);
        if (conn) {
          const eng = getEngine();
          const editingStack = get().editingStack;
          if (editingStack.length > 1) {
            const ctx = editingStack[editingStack.length - 1];
            if (!eng.removeInternalConnection || !eng.getGroupInternalGraph) {
              set({ lastError: 'Group editing not supported by this engine' });
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
              set({ lastError: 'Group editing not supported by this engine' });
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
        await getEngine().setParam(nodeId, key, value);
        const newNodes = new Map(get().nodes);
        const node = newNodes.get(nodeId);
        if (node) {
          node.params = { ...node.params, [key]: value };
          newNodes.set(nodeId, { ...node });
          set({ nodes: newNodes });
        }
        triggerAllViewers();
      },

      setParamLive: async (nodeId, key, value) => {
        if (!preCommitSnapshot) {
          preCommitSnapshot = {
            engineState: null,
            nodes: new Map(get().nodes),
            connections: [...get().connections],
            editingStack: [...get().editingStack],
          };
          Promise.resolve(getEngine().exportGraph()).then(state => {
            if (preCommitSnapshot) preCommitSnapshot.engineState = state;
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
            }).catch(() => {});
          };
        } else {
          getEngine().setParam(nodeId, key, value);
          pendingLiveRender = () => triggerAllViewers();
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
          if (undoStack.length > MAX_UNDO) undoStack.shift();
          redoStack.length = 0;
          preCommitSnapshot = null;
        }

        const newNodes = new Map(get().nodes);
        const node = newNodes.get(nodeId);
        if (node) {
          node.params = { ...node.params, [key]: value };
          newNodes.set(nodeId, { ...node });
          set({ nodes: newNodes, canUndo: undoStack.length > 0, canRedo: false, previewScale: 1 });
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
          }).catch(() => {});
        } else {
          await getEngine().setParam(nodeId, key, value);
          triggerAllViewers();
        }
      },

      setPosition: (nodeId, position) => {
        const newNodes = new Map(get().nodes);
        const node = newNodes.get(nodeId);
        if (node) {
          node.position = position;
          newNodes.set(nodeId, { ...node });
          set({ nodes: newNodes });
        }
      },

      selectNode: (id) => {
        set({ selectedNodeIds: id ? new Set([id]) : new Set() });
      },

      setSelectedNodes: (ids) => {
        set({ selectedNodeIds: new Set(ids) });
      },

      loadImageFile: (nodeId, file) => {
        file.arrayBuffer().then(async buffer => {
          const data = new Uint8Array(buffer);
          await getEngine().loadImageData(nodeId, data);
          triggerAllViewers();
        }).catch(e => {
          console.error('loadImageFile failed:', e);
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
          set({ lastError: e instanceof Error ? e.message : String(e) });
        });
      },

      triggerRender: (viewerNodeId) => {
        const frame = get().currentFrame;
        const scale = get().previewScale;
        const generation = nextRenderGeneration(viewerNodeId);
        Promise.resolve(getEngine().renderViewer(viewerNodeId, frame))
          .then(result => (result ? downscaleRenderResult(result, scale) : null))
          .then(result => {
            if (!result) return;
            if (renderGenerations.get(viewerNodeId) !== generation) return;
            const newResults = new Map(get().renderResults);
            newResults.set(viewerNodeId, result);
            set({ renderResults: newResults, lastError: null });
            updateNodeTimings();
          })
          .catch(e => {
            const msg = e instanceof Error ? e.message : String(e);
            if (!msg.includes('Missing input')) {
              set({ lastError: msg });
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
          set({ lastError: 'Image sequences are only available in the desktop app' });
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

      renderSequence: async (nodeId) => {
        const eng = getEngine();
        if (!eng.renderSequence) {
          set({ lastError: 'Sequence rendering is only available in the desktop app' });
          return;
        }
        set({ isRendering: true, renderProgress: null, lastError: null });
        try {
          await eng.renderSequence(nodeId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[renderSequence] start failed:', msg);
          set({
            isRendering: false,
            lastError: msg,
            renderProgress: {
              job_id: '',
              current_frame: 0,
              total_frames: 0,
              completed: true,
              error: msg,
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
                lastError: progress.error ?? null,
              });
            }
          } catch {
            clearInterval(pollInterval);
            set({ isRendering: false });
          }
        }, 250);
      },

      cancelRender: async () => {
        const eng = getEngine();
        if (eng.cancelJob) {
          await eng.cancelJob();
        }
        set({ isRendering: false });
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
              }
            });
          });
          return;
        }

        const exportPromise = eng.exportDocument
          ? Promise.resolve(eng.exportDocument())
          : Promise.resolve(eng.exportGraph()).then(graphData => createDocumentEnvelope(graphData));

        exportPromise.then(projectDoc => {
          const json = JSON.stringify(projectDoc, null, 2);
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'project.compositor';
          link.click();
          URL.revokeObjectURL(url);
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

        set({ nodeSpecs: specs });
        triggerAllViewers();
        return spec;
      },

      play: () => {
        if (get().isPlaying) return;
        const { currentFrame, sequenceLength, sequenceStart } = get();
        const end = sequenceLength || 999;
        const startFrame = currentFrame >= end ? sequenceStart : currentFrame;
        set({ isPlaying: true, currentFrame: startFrame });
        playbackAborted = false;

        const loop = async () => {
          while (!playbackAborted) {
            const frameStart = performance.now();
            const { fps, sequenceLength: seqLen, loopPlayback, sequenceStart: seqStart } = get();
            const endFrame = seqLen || 999;
            const interval = 1000 / fps;

            await renderAllViewersAsync();

            if (playbackAborted) break;

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
        set({ isPlaying: false });
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
        Promise.resolve(getEngine().exportGraph()).then(async engineState => {
          const current: UndoSnapshot = {
            engineState,
            nodes: new Map(get().nodes),
            connections: [...get().connections],
            editingStack: [...get().editingStack],
          };
          redoStack.push(current);
          await restoreSnapshot(snapshot);
        });
      },

      redo: () => {
        const snapshot = redoStack.pop();
        if (!snapshot) return;
        Promise.resolve(getEngine().exportGraph()).then(async engineState => {
          const current: UndoSnapshot = {
            engineState,
            nodes: new Map(get().nodes),
            connections: [...get().connections],
            editingStack: [...get().editingStack],
          };
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
          set({ lastError: 'Group editing not supported by this engine' });
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
            position: n.position,
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
        };

        set({
          editingStack: [...get().editingStack, context],
          nodes: newNodes,
          connections: newConnections,
          nodeSpecs: withGroupIOSpecs(get().nodeSpecs, internalGraph),
          selectedNodeIds: new Set(),
          renderResults: new Map(),
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
                position: { x: node.position[0], y: node.position[1] },
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
          });
          triggerAllViewers();
        } else {
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
                position: n.position,
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
            });
          }
        }
      },

      createGroup: async (nodeIds, name) => {
        const eng = getEngine();
        if (!eng.createGroupFromNodes) {
          set({ lastError: 'Group creation not supported by this engine' });
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
          position: { x: centroidX, y: centroidY },
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
          set({ lastError: 'Ungrouping not supported by this engine' });
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
            position: restored.position,
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

      updateGroupInterface: async (inputs, outputs) => {
        const stack = get().editingStack;
        if (stack.length <= 1) return;
        const currentContext = stack[stack.length - 1];
        if (!currentContext.groupDefId || !currentContext.groupNodeId) return;

        const eng = getEngine();
        if (!eng.updateGroupInterface || !eng.getGroupInternalGraph) {
          set({ lastError: 'Group interface update not supported by this engine' });
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
            position: n.position,
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
          set({ lastError: 'Project loading is only available in the desktop app' });
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
            }
          });
        });
      },

      loadProject: (file) => {
        file.text().then(async text => {
          const data = JSON.parse(text);
          const graphData = extractGraphData(data);
          const eng = getEngine();

          if (eng.importDocument) {
            await eng.importDocument(data);
          } else {
            await eng.importGraph(graphData);
          }

          applyGraphData(graphData);
        });
      },
    };
  })
);

if (import.meta.env.DEV) {
  (window as any).__compositorStore = useGraphStore;
}
