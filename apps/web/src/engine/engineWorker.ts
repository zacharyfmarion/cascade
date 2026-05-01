// WASM modules are dynamically imported for threaded/non-threaded dual-bundle support.
// See wasm-pkg/ (single-threaded, stable) and wasm-pkg-threads/ (multi-threaded, nightly).
type WasmModule = typeof import('../wasm-pkg/cascade_wasm');
type EngineInstance = InstanceType<WasmModule['Engine']>;
import * as Comlink from 'comlink';
import type { AddNodeResult, ColorManagementInfo, EditValidationError, NodeInterfaceChange } from './bridge';
import type { NodeSpec, ParamValue, PortSpec, ViewerResult, CreateGroupResult, UngroupResult, GroupInternalGraph, InternalGraphNode } from '../store/types';
import { extractParamValue } from '../store/types';
import {
  collectViewerResultTransferables,
  decodeViewerResult,
} from './viewerResult';

function paramValueToWasm(value: ParamValue): unknown {
  if ('Float' in value) return value.Float;
  if ('Int' in value) return value.Int;
  if ('Bool' in value) return value.Bool;
  if ('Color' in value) return value.Color;
  if ('String' in value) return value.String;
  if ('ColorRamp' in value) return value.ColorRamp;
  if ('CurvePoints' in value) return value.CurvePoints;
  if ('ColorPalette' in value) return value.ColorPalette;
  return extractParamValue(value);
}

type DocumentEnvelope = {
  cascade: unknown;
  graph: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const asParamValueRecord = (value: unknown): Record<string, ParamValue> => (isRecord(value) ? value as Record<string, ParamValue> : {});

const normalizeWasmInternalNode = (nodeEntry: unknown): InternalGraphNode => {
  const nodeRecord = asRecord(nodeEntry) as WasmEngineGroupNode;
  const position = Array.isArray(nodeRecord.position)
    ? { x: nodeRecord.position[0], y: nodeRecord.position[1] }
    : nodeRecord.position ?? { x: 0, y: 0 };
  return {
    id: String(nodeRecord.id ?? ''),
    typeId: String(nodeRecord.typeId ?? ''),
    position,
    params: asParamValueRecord(nodeRecord.params),
    inputDefaults: asParamValueRecord(nodeRecord.inputDefaults ?? nodeRecord.input_defaults),
    muted: Boolean(nodeRecord.muted),
  };
};

const isDocumentEnvelope = (value: unknown): value is DocumentEnvelope => isRecord(value) && ('cascade' in value || 'compositor' in value) && 'graph' in value;

const extractGraphData = (value: unknown): unknown => isDocumentEnvelope(value) ? value.graph : value;

const createDocumentEnvelope = (graph: unknown) => ({
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any = null;
let wasmModule: WasmModule | null = null;
let initPromise: Promise<void> | null = null;
let lastTimings: Record<string, number> = {};

type WasmEngineGroupNode = {
  id: string;
  typeId: string;
  position: [number, number] | { x: number; y: number };
  params?: Record<string, ParamValue>;
  inputDefaults?: Record<string, ParamValue>;
  input_defaults?: Record<string, ParamValue>;
  muted?: boolean;
};

type WasmEngineGroupConnection = {
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
};

type WasmEngineGroupInternalGraph = {
  groupDefId: string;
  name: string;
  nodes?: WasmEngineGroupNode[];
  connections?: WasmEngineGroupConnection[];
  inputs?: PortSpec[];
  outputs?: PortSpec[];
};

class EngineScheduler {
  private chain: Promise<void> = Promise.resolve();

  /**
   * Latest-wins live render support.
   * When a live render is in-flight, new requests overwrite `pendingLive`
   * instead of queuing behind the current render. Once the in-flight op
   * completes, only the latest pending op runs — intermediate values are
   * dropped, preventing backlog during fast slider drags.
   */
  private liveInFlight = false;
  private pendingLive: (() => Promise<unknown>) | null = null;
  private pendingLiveResolvers: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];

  enqueue<T>(op: () => T | Promise<T>): Promise<T> {
    const result = this.chain.then(op);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  /**
   * Enqueue a live render operation with latest-wins coalescing.
   * If a live op is already in-flight, the new op replaces any pending one
   * (callers waiting for replaced ops get the result of the op that actually ran).
   */
  enqueueLive<T>(op: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.liveInFlight) {
        // Replace pending — all waiters will get the final result
        this.pendingLive = op as () => Promise<unknown>;
        this.pendingLiveResolvers.push({ resolve: resolve as (v: unknown) => void, reject });
        return;
      }
      this.runLive(op, [{ resolve: resolve as (v: unknown) => void, reject }]);
    });
  }

  private runLive<T>(op: () => Promise<T>, resolvers: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }>): void {
    this.liveInFlight = true;
    // Chain onto the FIFO so live ops don't overlap with normal ops
    const task = this.chain.then(op);
    this.chain = task.then(() => undefined, () => undefined);
    task.then(
      (result) => {
        for (const r of resolvers) r.resolve(result);
        this.drainPendingLive();
      },
      (err) => {
        for (const r of resolvers) r.reject(err);
        this.drainPendingLive();
      },
    );
  }

  private drainPendingLive(): void {
    const next = this.pendingLive;
    const nextResolvers = this.pendingLiveResolvers;
    this.pendingLive = null;
    this.pendingLiveResolvers = [];
    if (next) {
      this.runLive(next, nextResolvers);
    } else {
      this.liveInFlight = false;
    }
  }

  whenIdle(): Promise<void> {
    return this.chain;
  }
}

const scheduler = new EngineScheduler();

const getEngine = (): EngineInstance => {
  if (!engine) throw new Error('WASM engine not initialized');
  return engine;
};

const getEngineWithBindings = () => getEngine() as EngineInstance & {
  set_muted: (nodeId: string, muted: boolean) => void;
  load_palette_data: (nodeId: string, data: Uint8Array) => [number, number, number, number][];
  load_sequence_frame_data: (nodeId: string, frame: bigint, data: Uint8Array) => NodeInterfaceChange;
  set_sequence_info: (nodeId: string, frameCount: bigint, firstFrame: bigint, lastFrame: bigint) => void;
  batch_clear: (nodeId: string) => void;
  batch_add_image: (nodeId: string, filename: string, data: Uint8Array) => void;
  get_batch_info: (exportNodeId: string) => { count: number; filenames: Iterable<string> };
  get_ai_node_image_data?: (nodeId: string) => Uint8Array;
  set_ai_node_image_data?: (nodeId: string, data: Uint8Array) => void;
  create_group_from_nodes?: (nodeIds: string[], name: string) => CreateGroupResult;
  ungroup_node?: (groupNodeId: string) => unknown;
  get_group_internal_graph?: (groupNodeId: string) => unknown;
  update_group_interface?: (groupDefId: string, inputs: PortSpec[], outputs: PortSpec[]) => NodeSpec;
  add_internal_node?: (groupDefId: string, typeId: string, x: number, y: number) => unknown;
  remove_internal_node?: (groupDefId: string, nodeId: string) => NodeSpec;
  set_internal_param?: (groupDefId: string, nodeId: string, key: string, value: ParamValue) => NodeSpec;
  set_internal_input_default?: (groupDefId: string, nodeId: string, portName: string, value: ParamValue) => NodeSpec;
  set_internal_position?: (groupDefId: string, nodeId: string, x: number, y: number) => NodeSpec;
  set_internal_muted?: (groupDefId: string, nodeId: string, muted: boolean) => NodeSpec;
  compile_internal_script_node?: (groupDefId: string, nodeId: string, manifestJson: string) => NodeSpec;
  rename_group?: (groupDefId: string, newName: string) => NodeSpec;
  set_ai_api_key?: (provider: string, key: string) => void;
  is_ai_configured?: () => boolean;
  run_ai_node?: (nodeId: string) => Promise<void> | void;
  get_node_execution_state?: (nodeId: string) => { status?: string; isStale?: boolean; error?: string };
  get_color_management_info?: () => ColorManagementInfo;
  get_views_for_display?: (display: string) => string[];
  set_display_view?: (display: string, view: string) => void;
  set_project_format?: (width: number, height: number) => void;
  export_group_as_package?: (groupDefId: string) => unknown;
  import_custom_nodes?: (pkg: unknown) => NodeSpec[];
  register_group_definition?: (definition: unknown) => NodeSpec;
  render_viewer_scaled?: (viewerId: string, frame: bigint, scale: number) => Promise<unknown>;
  render_internal_viewer_scaled?: (groupNodeId: string, internalViewerId: string, frame: bigint, scale: number) => Promise<unknown>;
};

const engineAPI = {
  async init(): Promise<boolean> {
    if (engine) return true;
    if (initPromise) {
      await initPromise;
      return true;
    }
    initPromise = (async () => {
      const useThreads =
        typeof crossOriginIsolated !== 'undefined' &&
        crossOriginIsolated &&
        typeof SharedArrayBuffer !== 'undefined';

      if (useThreads) {
        try {
          const threadedModulePath = '../wasm-pkg-threads/cascade_wasm';
          const threaded = await import(/* @vite-ignore */ threadedModulePath);
          await threaded.default();
          const cores = navigator.hardwareConcurrency ?? 4;
          const threads = Math.min(8, Math.max(1, cores - 1));
          await threaded.initThreadPool(threads);
          wasmModule = threaded as unknown as WasmModule;
          engine = new threaded.Engine();
          console.log(`[cascade] Threaded WASM initialized with ${threaded.rayon_num_threads()} threads`);
        } catch (e) {
          console.warn('[cascade] Threaded WASM failed, falling back to single-threaded:', e);
          engine = null;
        }
      }

      if (!engine) {
        const st: WasmModule = await import('../wasm-pkg/cascade_wasm');
        await st.default();
        wasmModule = st;
        engine = new st.Engine();
        console.log('[cascade] Single-threaded WASM initialized');
      }

      try {
        await engine.init_gpu();
        console.log('[cascade] GPU initialized successfully');
      } catch (e) {
        console.warn('[cascade] GPU initialization failed (GPU nodes will be unavailable):', e);
      }
    })();
    await initPromise;
    return true;
  },

  whenIdle(): Promise<void> {
    return scheduler.whenIdle();
  },

  getLastRenderTimings(): Record<string, number> {
    return lastTimings;
  },

  listNodeTypes(): Promise<NodeSpec[]> {
    return scheduler.enqueue(() =>
      getEngine().list_node_types() as NodeSpec[]
    );
  },

  addNode(typeId: string, x: number, y: number): Promise<AddNodeResult> {
    return scheduler.enqueue(() => {
      const result = getEngine().add_node(typeId, x, y) as unknown as { id: string; typeId: string };
      return { id: result.id, typeId: result.typeId };
    });
  },

  removeNode(nodeId: string): Promise<void> {
    return scheduler.enqueue(() => {
      getEngine().remove_node(nodeId);
    });
  },

  connect(fromNode: string, fromPort: string, toNode: string, toPort: string): Promise<void> {
    return scheduler.enqueue(() => {
      getEngine().connect(fromNode, fromPort, toNode, toPort);
    });
  },

  disconnect(toNode: string, toPort: string): Promise<void> {
    return scheduler.enqueue(() => {
      getEngine().disconnect(toNode, toPort);
    });
  },

  getAffectedViewers(nodeId: string): Promise<string[]> {
    return scheduler.enqueue(() => getEngine().get_affected_viewers(nodeId));
  },

  setParam(nodeId: string, key: string, value: ParamValue): Promise<void> {
    return scheduler.enqueue(() => {
      const raw = paramValueToWasm(value);
      getEngine().set_param(nodeId, key, raw);
    });
  },

  setInputDefault(nodeId: string, portName: string, value: ParamValue): Promise<void> {
    return scheduler.enqueue(() => {
      const raw = paramValueToWasm(value);
      getEngine().set_input_default(nodeId, portName, raw);
    });
  },

  setPosition(nodeId: string, x: number, y: number): Promise<void> {
    return scheduler.enqueue(() => {
      getEngine().set_position(nodeId, x, y);
    });
  },

  setMuted(nodeId: string, muted: boolean): Promise<void> {
    return scheduler.enqueue(() => {
      getEngineWithBindings().set_muted(nodeId, muted);
    });
  },

  setAndRender(mutation: { type: 'param' | 'inputDefault'; nodeId: string; key: string; value: ParamValue }, frame: number, previewScale?: number): Promise<Array<[string, ViewerResult]>> {
    const scale = previewScale ?? 1;
    return scheduler.enqueueLive(async (): Promise<Array<[string, ViewerResult]>> => {
      const eng = getEngine();
      const raw = paramValueToWasm(mutation.value);

      // Apply the mutation (param or input default)
      if (mutation.type === 'param') {
        eng.set_param(mutation.nodeId, mutation.key, raw);
      } else {
        eng.set_input_default(mutation.nodeId, mutation.key, raw);
      }

      // Find which viewers are affected and render them atomically
      const viewerIds: string[] = eng.get_affected_viewers(mutation.nodeId);
      const results: Array<[string, ViewerResult]> = [];

      for (const viewerId of viewerIds) {
        const eng2 = getEngineWithBindings();
        const useScaled = scale < 1 && typeof eng2.render_viewer_scaled === 'function';
        const rawResult = useScaled
          ? await eng2.render_viewer_scaled(viewerId, BigInt(frame), scale)
          : await eng.render_viewer(viewerId, BigInt(frame));
        // Extract timings
        try {
          const timingsRaw = eng.get_last_render_timings();
          if (timingsRaw) {
            if (timingsRaw instanceof Map) {
              const obj: Record<string, number> = {};
              (timingsRaw as Map<string, number>).forEach((v, k) => { obj[k] = v; });
              lastTimings = obj;
            } else {
              lastTimings = timingsRaw as unknown as Record<string, number>;
            }
          }
        } catch (e) {
          console.warn('[WASM] Failed to get timings:', e);
        }

        const result = decodeViewerResult(rawResult, viewerId, { copyPixels: true });
        if (result) {
          results.push([viewerId, result]);
        }
      }

      // Transfer pixel buffers for zero-copy
      const transferables: ArrayBuffer[] = [];
      for (const [, r] of results) {
        transferables.push(...collectViewerResultTransferables(r));
      }
      if (transferables.length > 0) {
        return Comlink.transfer(results, transferables);
      }
      return results;
    });
  },

  registerGpuKernel(_manifestJson: string): NodeSpec {
    throw new Error('Dynamic GPU kernel registration not yet supported in WASM');
  },

  compileScriptNode(nodeId: string, manifestJson: string): Promise<NodeSpec> {
    return scheduler.enqueue(() => {
      const result = getEngine().compile_script_node(nodeId, manifestJson);
      return result as NodeSpec;
    });
  },

  setDslHandle(_nodeId: string, _handle: string): Promise<void> {
    return Promise.reject(new Error('DSL handles are not supported in WASM engine')); 
  },

  loadImageData(nodeId: string, data: Uint8Array): Promise<NodeInterfaceChange> {
    return scheduler.enqueue(() => {
      return getEngine().load_image_data(nodeId, data) as unknown as NodeInterfaceChange;
    });
  },

  loadPaletteData(nodeId: string, data: Uint8Array): Promise<[number, number, number, number][]> {
    return scheduler.enqueue(() => {
      return getEngineWithBindings().load_palette_data(nodeId, data);
    });
  },

  renderViewer(viewerNodeId: string, frame: number, previewScale = 1): Promise<ViewerResult | null> {
    return scheduler.enqueue(async (): Promise<ViewerResult | null> => {
      const eng = getEngineWithBindings();
      const raw = previewScale < 1 && typeof eng.render_viewer_scaled === 'function'
        ? await eng.render_viewer_scaled(viewerNodeId, BigInt(frame), previewScale)
        : await getEngine().render_viewer(viewerNodeId, BigInt(frame));

      try {
        const timingsRaw = getEngine().get_last_render_timings();
        if (timingsRaw) {
          if (timingsRaw instanceof Map) {
            const obj: Record<string, number> = {};
            (timingsRaw as Map<string, number>).forEach((v, k) => { obj[k] = v; });
            lastTimings = obj;
          } else {
            lastTimings = timingsRaw as unknown as Record<string, number>;
          }
        }
      } catch (e) {
        console.warn('[WASM] Failed to get timings:', e);
      }

      // Comlink throws "Unserializable return value" if a worker result is not
      // cloneable/transferable, so we normalize image payloads to a fresh buffer first.
      const result = decodeViewerResult(raw, viewerNodeId, { copyPixels: true });
      if (!result) {
        return null;
      }

      const transferables = collectViewerResultTransferables(result);
      if (transferables.length > 0) {
        return Comlink.transfer(result, transferables);
      }

      return result;
    });
  },

  renderInternalViewer(groupNodeId: string, internalViewerId: string, frame: number, previewScale = 1): Promise<ViewerResult | null> {
    return scheduler.enqueue(async (): Promise<ViewerResult | null> => {
      const eng = getEngineWithBindings();
      if (typeof eng.render_internal_viewer_scaled !== 'function') {
        throw new Error('Internal viewer rendering not supported in WASM worker');
      }
      const raw = await eng.render_internal_viewer_scaled(groupNodeId, internalViewerId, BigInt(frame), previewScale);

      try {
        const timingsRaw = getEngine().get_last_render_timings();
        if (timingsRaw) {
          if (timingsRaw instanceof Map) {
            const obj: Record<string, number> = {};
            (timingsRaw as Map<string, number>).forEach((v, k) => { obj[k] = v; });
            lastTimings = obj;
          } else {
            lastTimings = timingsRaw as unknown as Record<string, number>;
          }
        }
      } catch (e) {
        console.warn('[WASM] Failed to get timings:', e);
      }

      const result = decodeViewerResult(raw, internalViewerId, { copyPixels: true });
      if (!result) {
        return null;
      }

      const transferables = collectViewerResultTransferables(result);
      if (transferables.length > 0) {
        return Comlink.transfer(result, transferables);
      }

      return result;
    });
  },

  exportGraph(): Promise<unknown> {
    return scheduler.enqueue(() =>
      getEngine().export_graph()
    );
  },

  importGraph(data: unknown): Promise<void> {
    return scheduler.enqueue(() => {
      getEngine().import_graph(data);
    });
  },

  exportDocument(): Promise<unknown> {
    return scheduler.enqueue(() => {
      const eng = getEngine();
      const graph = eng.export_graph();
      const doc = createDocumentEnvelope(graph);

      const graphData = graph as { nodes?: Array<{ id: string; type_id: string }> };
      if (graphData.nodes) {
        const assets: Record<string, { type: string; source: string; data: string; original_filename: string; hash: string }> = {};
        for (const node of graphData.nodes) {
          if (node.type_id === 'load_image') {
            try {
              const bytes = eng.get_image_data(node.id);
              const imageData = new Uint8Array(bytes);
              if (imageData) {
                let binary = '';
                for (let i = 0; i < imageData.length; i++) {
                  binary += String.fromCharCode(imageData[i]);
                }
                assets[node.id] = {
                  type: 'image',
                  source: 'embedded',
                  data: btoa(binary),
                  original_filename: '',
                  hash: '',
                };
              }
            } catch (e) {
              console.warn('[WASM] Failed to export embedded image asset:', e);
            }
          } else if (node.type_id.startsWith('ai_')) {
            try {
              const aiData = getEngineWithBindings().get_ai_node_image_data?.(node.id);
              if (aiData && aiData.length > 0) {
                let binary = '';
                for (let i = 0; i < aiData.length; i++) {
                  binary += String.fromCharCode(aiData[i]);
                }
                assets[node.id] = {
                  type: 'ai_result',
                  source: 'embedded',
                  data: btoa(binary),
                  original_filename: '',
                  hash: '',
                };
              }
            } catch (e) {
              console.warn('[WASM] Failed to export embedded AI asset:', e);
            }
          }
        }
        (doc as Record<string, unknown>).assets = assets;
      }

      return doc;
    });
  },

  importDocument(data: unknown): Promise<void> {
    return scheduler.enqueue(() => {
      const eng = getEngine();
      const graph = extractGraphData(data);
      eng.import_graph(graph);

      if (isRecord(data) && isRecord(data.assets)) {
        const assets = data.assets as Record<string, Record<string, unknown>>;
        for (const [nodeId, assetRef] of Object.entries(assets)) {
          if (typeof assetRef.data !== 'string') continue;
          const binary = atob(assetRef.data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          try {
            if (assetRef.type === 'image') {
              eng.load_image_data(nodeId, bytes);
            } else if (assetRef.type === 'ai_result') {
              getEngineWithBindings().set_ai_node_image_data?.(nodeId, bytes);
            }
          } catch (e) {
            console.warn(`Failed to load embedded asset for node ${nodeId}:`, e);
          }
        }
      }
    });
  },

  saveProject(_path: string): Promise<void> {
    return Promise.reject(new Error('Project save is not supported in WASM engine'));
  },

  loadProject(_path: string): Promise<unknown> {
    return Promise.reject(new Error('Project load is not supported in WASM engine'));
  },

  getImageData(nodeId: string): Promise<Uint8Array | null> {
    return scheduler.enqueue(() => {
      try {
        const bytes = getEngine().get_image_data(nodeId);
        const result = new Uint8Array(bytes);
      return Comlink.transfer(result, [result.buffer]);
      } catch {
        return null;
      }
    });
  },

  exportImage(nodeId: string, frame: number): Promise<Uint8Array> {
    return scheduler.enqueue(async () => {
      const bytes = await getEngine().export_image(nodeId, BigInt(frame));
      const result = new Uint8Array(bytes);
      return Comlink.transfer(result, [result.buffer]);
    });
  },

  renderSequence(_nodeId: string): Promise<string> {
    return Promise.reject(new Error('Sequence rendering is not supported in WASM engine'));
  },

  renderVideo(_nodeId: string): Promise<string> {
    return Promise.reject(new Error('Video rendering is not supported in WASM engine'));
  },

  cancelJob(): Promise<void> {
    return Promise.reject(new Error('Job control is not supported in WASM engine'));
  },

  getJobProgress(): Promise<null> {
    return Promise.resolve(null);
  },

  setSequenceDirectory(_nodeId: string, _directory: string): Promise<never> {
    return Promise.reject(new Error('Sequence directory assignment is not supported in WASM engine'));
  },

  getSequenceInfo(_nodeId: string, _pattern: string): Promise<never> {
    return Promise.reject(new Error('Sequence info is not supported in WASM engine'));
  },

  loadVideoFile(_nodeId: string, _path: string): Promise<never> {
    return Promise.reject(new Error('Video loading is not supported in WASM engine'));
  },

  loadSequenceFrameData(nodeId: string, frame: number, data: Uint8Array): Promise<NodeInterfaceChange> {
    return scheduler.enqueue(() => {
      return getEngineWithBindings().load_sequence_frame_data(nodeId, BigInt(frame), data);
    });
  },

  setSequenceInfo(nodeId: string, info: { frame_count: number; first_frame: number; last_frame: number }): Promise<void> {
    return scheduler.enqueue(() => {
      getEngineWithBindings().set_sequence_info(
        nodeId,
        BigInt(info.frame_count),
        BigInt(info.first_frame),
        BigInt(info.last_frame),
      );
    });
  },

  batchClear(nodeId: string): Promise<void> {
    return scheduler.enqueue(() => {
      getEngineWithBindings().batch_clear(nodeId);
    });
  },

  batchAddImage(nodeId: string, filename: string, data: Uint8Array): Promise<void> {
    return scheduler.enqueue(() => {
      getEngineWithBindings().batch_add_image(nodeId, filename, data);
    });
  },

  getBatchInfo(exportNodeId: string): Promise<{ count: number; filenames: string[] }> {
    return scheduler.enqueue(() => {
      const result: { count: number; filenames: Iterable<string> } = getEngineWithBindings().get_batch_info(exportNodeId);
      const count = result.count;
      const filenames = Array.from(result.filenames, name => String(name));
      return { count, filenames };
    });
  },

  createGroupFromNodes(nodeIds: string[], name: string): Promise<CreateGroupResult> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      if (typeof eng.create_group_from_nodes !== 'function') {
        throw new Error('Group creation not yet supported in WASM engine');
      }
      return eng.create_group_from_nodes(nodeIds, name) as CreateGroupResult;
    });
  },

  ungroupNode(groupNodeId: string): Promise<UngroupResult> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      if (typeof eng.ungroup_node !== 'function') {
        throw new Error('Ungrouping not yet supported in WASM engine');
      }
      const raw = eng.ungroup_node(groupNodeId);
      const rawRecord = asRecord(raw);
      const restoredRaw = Array.isArray(rawRecord.restoredNodes) ? rawRecord.restoredNodes : [];
      return {
        removedGroupNodeId: String(rawRecord.removedGroupNodeId ?? ''),
        restoredNodes: restoredRaw.map(normalizeWasmInternalNode),
      };
    });
  },

  getGroupInternalGraph(groupNodeId: string): Promise<GroupInternalGraph> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      if (typeof eng.get_group_internal_graph !== 'function') {
        throw new Error('Group inspection not yet supported in WASM engine');
      }
      const raw = eng.get_group_internal_graph(groupNodeId);
      const rawRecord = asRecord(raw) as WasmEngineGroupInternalGraph;
      const rawNodes = Array.isArray(rawRecord.nodes) ? rawRecord.nodes : [];
      const rawConnections = Array.isArray(rawRecord.connections) ? rawRecord.connections : [];
      return {
        groupDefId: String(rawRecord.groupDefId ?? ''),
        name: String(rawRecord.name ?? ''),
        nodes: rawNodes.map(normalizeWasmInternalNode),
        connections: rawConnections.map((connEntry: unknown) => {
          const connRecord = asRecord(connEntry) as WasmEngineGroupConnection;
          return {
            id: crypto.randomUUID(),
            fromNode: String(connRecord.fromNode ?? ''),
            fromPort: String(connRecord.fromPort ?? ''),
            toNode: String(connRecord.toNode ?? ''),
            toPort: String(connRecord.toPort ?? ''),
          };
        }),
        inputs: rawRecord.inputs ?? [],
        outputs: rawRecord.outputs ?? [],
      };
    });
  },

  updateGroupInterface(groupDefId: string, inputs: PortSpec[], outputs: PortSpec[]): Promise<NodeSpec> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      if (typeof eng.update_group_interface !== 'function') {
        throw new Error('Group interface update not yet supported in WASM engine');
      }
      return eng.update_group_interface(groupDefId, inputs, outputs) as NodeSpec;
    });
  },

  addInternalConnection(groupDefId: string, fromNode: string, fromPort: string, toNode: string, toPort: string): Promise<NodeSpec> {
    return scheduler.enqueue(() =>
      getEngine().add_internal_connection(groupDefId, fromNode, fromPort, toNode, toPort) as NodeSpec
    );
  },

  removeInternalConnection(groupDefId: string, toNode: string, toPort: string): Promise<NodeSpec> {
    return scheduler.enqueue(() =>
      getEngine().remove_internal_connection(groupDefId, toNode, toPort) as NodeSpec
    );
  },

  addInternalNode(groupDefId: string, typeId: string, x: number, y: number): Promise<InternalGraphNode> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      if (typeof eng.add_internal_node !== 'function') {
        throw new Error('Internal group node creation not yet supported in WASM engine');
      }
      return normalizeWasmInternalNode(eng.add_internal_node(groupDefId, typeId, x, y));
    });
  },

  removeInternalNode(groupDefId: string, nodeId: string): Promise<NodeSpec> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      if (typeof eng.remove_internal_node !== 'function') {
        throw new Error('Internal group node removal not yet supported in WASM engine');
      }
      return eng.remove_internal_node(groupDefId, nodeId);
    });
  },

  setInternalParam(groupDefId: string, nodeId: string, key: string, value: ParamValue): Promise<NodeSpec> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      if (typeof eng.set_internal_param !== 'function') {
        throw new Error('Internal group param edits not yet supported in WASM engine');
      }
      return eng.set_internal_param(groupDefId, nodeId, key, value);
    });
  },

  setInternalInputDefault(groupDefId: string, nodeId: string, portName: string, value: ParamValue): Promise<NodeSpec> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      if (typeof eng.set_internal_input_default !== 'function') {
        throw new Error('Internal group input default edits not yet supported in WASM engine');
      }
      return eng.set_internal_input_default(groupDefId, nodeId, portName, value);
    });
  },

  setInternalPosition(groupDefId: string, nodeId: string, x: number, y: number): Promise<NodeSpec> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      if (typeof eng.set_internal_position !== 'function') {
        throw new Error('Internal group position edits not yet supported in WASM engine');
      }
      return eng.set_internal_position(groupDefId, nodeId, x, y);
    });
  },

  setInternalMuted(groupDefId: string, nodeId: string, muted: boolean): Promise<NodeSpec> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      if (typeof eng.set_internal_muted !== 'function') {
        throw new Error('Internal group mute edits not yet supported in WASM engine');
      }
      return eng.set_internal_muted(groupDefId, nodeId, muted);
    });
  },

  compileInternalScriptNode(groupDefId: string, nodeId: string, manifestJson: string): Promise<NodeSpec> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      if (typeof eng.compile_internal_script_node !== 'function') {
        throw new Error('Internal GPU script compilation not yet supported in WASM engine');
      }
      return eng.compile_internal_script_node(groupDefId, nodeId, manifestJson);
    });
  },

  renameGroup(groupDefId: string, newName: string): Promise<NodeSpec> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      if (typeof eng.rename_group !== 'function') {
        throw new Error('Group rename not yet supported in WASM engine');
      }
      return eng.rename_group(groupDefId, newName) as NodeSpec;
    });
  },

  setAiApiKey(provider: string, key: string): Promise<void> {
    return scheduler.enqueue(() => {
      getEngineWithBindings().set_ai_api_key?.(provider, key);
    });
  },

  isAiConfigured(): Promise<boolean> {
    return scheduler.enqueue(() =>
      getEngineWithBindings().is_ai_configured?.() ?? false
    );
  },

  runAiNode(nodeId: string): Promise<void> {
    return scheduler.enqueue(async () => {
      const eng = getEngineWithBindings();
      if (!eng.run_ai_node) {
        throw new Error('AI node execution not supported in WASM engine');
      }
      await eng.run_ai_node(nodeId);
    });
  },

  getNodeExecutionState(nodeId: string): Promise<{ status: string; isStale: boolean; error: string }> {
    return scheduler.enqueue(() => {
      const result = getEngineWithBindings().get_node_execution_state?.(nodeId) ?? {};
      return {
        status: result.status ?? 'idle',
        isStale: result.isStale ?? false,
        error: result.error ?? '',
      };
    });
  },

  getColorManagementInfo(): Promise<ColorManagementInfo> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      return eng.get_color_management_info?.() as ColorManagementInfo;
    });
  },

  getViewsForDisplay(display: string): Promise<string[]> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      return eng.get_views_for_display?.(display) ?? [];
    });
  },

  setDisplayView(display: string, view: string): Promise<void> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      eng.set_display_view?.(display, view);
    });
  },

  setProjectFormat(width: number, height: number): Promise<void> {
    return scheduler.enqueue(() => {
      getEngineWithBindings().set_project_format?.(width, height);
    });
  },

  getNodeSpec(nodeId: string): Promise<NodeSpec> {
    return scheduler.enqueue(() => {
      return getEngine().get_node_spec(nodeId) as unknown as NodeSpec;
    });
  },

  async evaluateBytesOutput(nodeId: string, portName: string): Promise<Uint8Array> {
    return scheduler.enqueue(() => {
      const bytes = getEngine().evaluate_bytes_output(nodeId, portName) as unknown as Uint8Array;
      return Comlink.transfer(bytes, [bytes.buffer]);
    });
  },

  validateEdits(editsJson: string): Promise<EditValidationError[]> {
    return scheduler.enqueue(() =>
      getEngine().validate_edits(editsJson) as EditValidationError[]
    );
  },

  exportGroupAsPackage(groupDefId: string): Promise<unknown> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      return eng.export_group_as_package?.(groupDefId);
    });
  },

  importCustomNodes(json: string): Promise<NodeSpec[]> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      const pkg = JSON.parse(json);
      return eng.import_custom_nodes?.(pkg) ?? [];
    });
  },

  registerGroupDefinition(json: string): Promise<NodeSpec> {
    return scheduler.enqueue(() => {
      const eng = getEngineWithBindings();
      const definition = JSON.parse(json);
      const spec = eng.register_group_definition?.(definition);
      if (!spec) throw new Error('Group definition registration not supported');
      return spec;
    });
  },

  listCustomNodes(): Promise<never> {
    return Promise.reject(new Error('Custom node listing is not supported in WASM engine'));
  },

  removeCustomNode(_groupDefId: string): Promise<void> {
    return Promise.reject(new Error('Custom node removal is not supported in WASM engine'));
  },

  typesCompatible(fromType: string, toType: string): Promise<boolean> {
    return scheduler.enqueue(() => {
      const eng = getEngine();
      return eng.types_compatible(fromType, toType);
    });
  },

  migrateDocument(jsonStr: string): string {
    if (!wasmModule) throw new Error('WASM not initialized');
    return wasmModule.migrate_document_json(jsonStr);
  },

  needsMigration(jsonStr: string): boolean {
    if (!wasmModule) throw new Error('WASM not initialized');
    return wasmModule.needs_migration_json(jsonStr);
  },
};

Comlink.expose(engineAPI);
