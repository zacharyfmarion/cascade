import init, { Engine, needs_migration_json, migrate_document_json } from '../wasm-pkg/cascade_wasm';
import type { EngineBridge, AddNodeResult, ColorManagementInfo, EditValidationError, NodeInterfaceChange } from './bridge';
import type { NodeSpec, ParamValue, PortSpec, ViewerResult, CreateGroupResult, UngroupResult, GroupInternalGraph, InternalGraphNode } from '../store/types';
import { extractParamValue } from '../store/types';
import { decodeViewerResult } from './viewerResult';

/**
 * Convert a tagged ParamValue (e.g. { CurvePoints: [...] }) to the raw form
 * expected by WASM's set_param. For simple scalars we unwrap; for complex
 * structured params (ColorRamp, CurvePoints, ColorPalette) we send the raw
 * inner value directly so WASM can deserialize via serde_wasm_bindgen.
 */
function paramValueToWasm(value: ParamValue): unknown {
  if ('Float' in value) return value.Float;
  if ('Int' in value) return value.Int;
  if ('Bool' in value) return value.Bool;
  if ('Color' in value) return value.Color;
  if ('String' in value) return value.String;
  // Complex structured params: send the inner array directly.
  // WASM convert_param_value uses the ParamSpec ui_hint to know the type.
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

let engine: Engine | null = null;
let initPromise: Promise<void> | null = null;

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

export async function initWasmEngine(): Promise<void> {
  if (engine) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await init();
    engine = new Engine();
    try {
      await engine.init_gpu();
      console.log('[WASM] GPU initialized successfully');
    } catch (e) {
      console.warn('[WASM] GPU initialization failed (GPU nodes will be unavailable):', e);
    }
  })();
  return initPromise;
}

/**
 * Promise-based FIFO scheduler that serializes all access to the WASM Engine.
 *
 * wasm-bindgen wraps exported structs in a RefCell. Async methods (render_viewer,
 * run_ai_node, etc.) hold a mutable borrow across .await points. If any other
 * engine call occurs while that borrow is live, the RefCell panics with
 * "recursive use of an object detected which would lead to unsafe aliasing in rust."
 *
 * This scheduler guarantees that at most one operation touches the Engine at a time
 * by chaining every call onto a single promise. Operations execute in FIFO order.
 */
class EngineScheduler {
  private chain: Promise<void> = Promise.resolve();

  /**
   * Enqueue an operation. It will execute after all previously enqueued
   * operations complete. The returned promise resolves with the operation's
   * result (or rejects if it throws).
   */
  enqueue<T>(op: () => T | Promise<T>): Promise<T> {
    const result = this.chain.then(op);
    // Swallow rejections on the chain itself so one failure doesn't block
    // subsequent operations. The caller still gets the rejection via `result`.
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  /**
   * Returns a promise that resolves when all currently enqueued operations
   * have completed (regardless of success/failure).
   */
  whenIdle(): Promise<void> {
    return this.chain;
  }
}

export class WasmEngine implements EngineBridge {
  private lastTimings: Record<string, number> = {};
  private scheduler = new EngineScheduler();

  private getEngine(): Engine {
    if (!engine) throw new Error('WASM engine not initialized');
    return engine;
  }

  private getEngineWithBindings(): Engine & {
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
    render_internal_viewer_scaled?: (groupNodeId: string, internalViewerId: string, frame: bigint, scale: number) => Promise<unknown>;
  } {
    return this.getEngine() as Engine & {
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
      render_internal_viewer_scaled?: (groupNodeId: string, internalViewerId: string, frame: bigint, scale: number) => Promise<unknown>;
    };
  }

  /**
   * Wait for all pending engine operations to complete.
   * Useful for ensuring deferred writes are flushed before snapshotting.
   */
  whenIdle(): Promise<void> {
    return this.scheduler.whenIdle();
  }

  getLastRenderTimings(): Record<string, number> {
    return this.lastTimings;
  }

  listNodeTypes(): Promise<NodeSpec[]> {
    return this.scheduler.enqueue(() =>
      this.getEngine().list_node_types() as NodeSpec[]
    );
  }

  addNode(typeId: string, x: number, y: number): Promise<AddNodeResult> {
    return this.scheduler.enqueue(() => {
      const result = this.getEngine().add_node(typeId, x, y) as unknown as { id: string; typeId: string };
      return { id: result.id, typeId: result.typeId };
    });
  }

  removeNode(nodeId: string): Promise<void> {
    return this.scheduler.enqueue(() => {
      this.getEngine().remove_node(nodeId);
    });
  }

  connect(fromNode: string, fromPort: string, toNode: string, toPort: string): Promise<void> {
    return this.scheduler.enqueue(() => {
      this.getEngine().connect(fromNode, fromPort, toNode, toPort);
    });
  }

  disconnect(toNode: string, toPort: string): Promise<void> {
    return this.scheduler.enqueue(() => {
      this.getEngine().disconnect(toNode, toPort);
    });
  }

  getAffectedViewers(nodeId: string): string[] {
    return this.getEngine().get_affected_viewers(nodeId);
  }

  setParam(nodeId: string, key: string, value: ParamValue): Promise<void> {
    return this.scheduler.enqueue(() => {
      const raw = paramValueToWasm(value);
      this.getEngine().set_param(nodeId, key, raw);
    });
  }

  setInputDefault(nodeId: string, portName: string, value: ParamValue): Promise<void> {
    return this.scheduler.enqueue(() => {
      const raw = paramValueToWasm(value);
      this.getEngine().set_input_default(nodeId, portName, raw);
    });
  }

  setPosition(nodeId: string, x: number, y: number): Promise<void> {
    return this.scheduler.enqueue(() => {
      this.getEngine().set_position(nodeId, x, y);
    });
  }

  setMuted(nodeId: string, muted: boolean): Promise<void> {
    return this.scheduler.enqueue(() => {
      this.getEngineWithBindings().set_muted(nodeId, muted);
    });
  }

  loadImageData(nodeId: string, data: Uint8Array): Promise<NodeInterfaceChange> {
    return this.scheduler.enqueue(() => {
      return this.getEngine().load_image_data(nodeId, data) as unknown as NodeInterfaceChange;
    });
  }

  loadPaletteData(nodeId: string, data: Uint8Array): Promise<[number, number, number, number][]> {
    return this.scheduler.enqueue(() => {
      return this.getEngineWithBindings().load_palette_data(nodeId, data);
    });
  }

  loadSequenceFrameData(nodeId: string, frame: number, data: Uint8Array): Promise<NodeInterfaceChange> {
    return this.scheduler.enqueue(() => {
      return this.getEngineWithBindings().load_sequence_frame_data(nodeId, BigInt(frame), data);
    });
  }

  setSequenceInfo(nodeId: string, info: { frame_count: number; first_frame: number; last_frame: number }): Promise<void> {
    return this.scheduler.enqueue(() => {
      this.getEngineWithBindings().set_sequence_info(
        nodeId,
        BigInt(info.frame_count),
        BigInt(info.first_frame),
        BigInt(info.last_frame),
      );
    });
  }


  batchClear(nodeId: string): Promise<void> {
    return this.scheduler.enqueue(() => {
      this.getEngineWithBindings().batch_clear(nodeId);
    });
  }

  batchAddImage(nodeId: string, filename: string, data: Uint8Array): Promise<void> {
    return this.scheduler.enqueue(() => {
      this.getEngineWithBindings().batch_add_image(nodeId, filename, data);
    });
  }

  getBatchInfo(exportNodeId: string): Promise<{ count: number; filenames: string[] }> {
    return this.scheduler.enqueue(() => {
      const result: { count: number; filenames: Iterable<string> } = this.getEngineWithBindings().get_batch_info(exportNodeId);
      const count = result.count;
      const filenames = Array.from(result.filenames, name => String(name));
      return { count, filenames };
    });
  }

  renderViewer(viewerNodeId: string, frame: number): Promise<ViewerResult | null> {
    return this.scheduler.enqueue(async (): Promise<ViewerResult | null> => {
      const raw = await this.getEngine().render_viewer(viewerNodeId, BigInt(frame));

      try {
        const timingsRaw = this.getEngine().get_last_render_timings();
        if (timingsRaw) {
          if (timingsRaw instanceof Map) {
            const obj: Record<string, number> = {};
            (timingsRaw as Map<string, number>).forEach((v, k) => { obj[k] = v; });
            this.lastTimings = obj;
          } else {
            this.lastTimings = timingsRaw as unknown as Record<string, number>;
          }
        }
      } catch (e) {
        console.warn('[WASM] Failed to get timings:', e);
      }

      return decodeViewerResult(raw, viewerNodeId);
    });
  }

  renderInternalViewer(groupNodeId: string, internalViewerId: string, frame: number, previewScale = 1): Promise<ViewerResult | null> {
    return this.scheduler.enqueue(async (): Promise<ViewerResult | null> => {
      const eng = this.getEngineWithBindings();
      if (typeof eng.render_internal_viewer_scaled !== 'function') {
        throw new Error('Internal viewer rendering not supported by WASM engine');
      }
      const raw = await eng.render_internal_viewer_scaled(groupNodeId, internalViewerId, BigInt(frame), previewScale);
      try {
        const timingsRaw = this.getEngine().get_last_render_timings();
        if (timingsRaw) {
          if (timingsRaw instanceof Map) {
            const obj: Record<string, number> = {};
            (timingsRaw as Map<string, number>).forEach((v, k) => { obj[k] = v; });
            this.lastTimings = obj;
          } else {
            this.lastTimings = timingsRaw as unknown as Record<string, number>;
          }
        }
      } catch (e) {
        console.warn('[WASM] Failed to get timings:', e);
      }
      return decodeViewerResult(raw, internalViewerId);
    });
  }
  exportGraph(): Promise<unknown> {
    return this.scheduler.enqueue(() =>
      this.getEngine().export_graph()
    );
  }

  importGraph(data: unknown): Promise<void> {
    return this.scheduler.enqueue(() => {
      this.getEngine().import_graph(data);
    });
  }

  getImageData(nodeId: string): Promise<Uint8Array | null> {
    return this.scheduler.enqueue(() => {
      try {
        const bytes = this.getEngine().get_image_data(nodeId);
        return new Uint8Array(bytes);
      } catch {
        return null;
      }
    });
  }

  exportDocument(): Promise<unknown> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngine();
      const graph = eng.export_graph();
      const doc = createDocumentEnvelope(graph);

      // Embed image data for LoadImage nodes and AI node results as base64
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
            } catch {
              // Node may not have image loaded yet
            }
          } else if (node.type_id.startsWith('ai_')) {
            try {
              const aiData = this.getEngineWithBindings().get_ai_node_image_data?.(node.id);
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
            } catch {
              // No cached AI result for this node — skip
            }
          }
        }
        (doc as Record<string, unknown>).assets = assets;
      }

      return doc;
    });
  }

  importDocument(data: unknown): Promise<void> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngine();
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
              this.getEngineWithBindings().set_ai_node_image_data?.(nodeId, bytes);
            }
          } catch (e) {
            console.warn(`Failed to load embedded asset for node ${nodeId}:`, e);
          }
        }
      }
    });
  }

  registerGpuKernel(_manifestJson: string): NodeSpec {
    throw new Error('Dynamic GPU kernel registration not yet supported in WASM');
  }

  compileScriptNode(nodeId: string, manifestJson: string): Promise<NodeSpec> {
    return this.scheduler.enqueue(() => {
      const result = this.getEngine().compile_script_node(nodeId, manifestJson);
      return result as NodeSpec;
    });
  }

  exportImage(nodeId: string, frame: number): Promise<Uint8Array> {
    return this.scheduler.enqueue(async () => {
      const bytes = await this.getEngine().export_image(nodeId, BigInt(frame));
      return new Uint8Array(bytes);
    });
  }

  createGroupFromNodes(nodeIds: string[], name: string): Promise<CreateGroupResult> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      if (typeof eng.create_group_from_nodes !== 'function') {
        throw new Error('Group creation not yet supported in WASM engine');
      }
      return eng.create_group_from_nodes(nodeIds, name) as CreateGroupResult;
    });
  }

  ungroupNode(groupNodeId: string): Promise<UngroupResult> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
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
  }

  getGroupInternalGraph(groupNodeId: string): Promise<GroupInternalGraph> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
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
  }

  updateGroupInterface(groupDefId: string, inputs: PortSpec[], outputs: PortSpec[]): Promise<NodeSpec> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      if (typeof eng.update_group_interface !== 'function') {
        throw new Error('Group interface update not yet supported in WASM engine');
      }
      return eng.update_group_interface(groupDefId, inputs, outputs) as NodeSpec;
    });
  }

  renameGroup(groupDefId: string, newName: string): Promise<NodeSpec> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      if (typeof eng.rename_group !== 'function') {
        throw new Error('Group rename not yet supported in WASM engine');
      }
      return eng.rename_group(groupDefId, newName) as NodeSpec;
    });
  }

  addInternalConnection(groupDefId: string, fromNode: string, fromPort: string, toNode: string, toPort: string): Promise<NodeSpec> {
    return this.scheduler.enqueue(() =>
      this.getEngine().add_internal_connection(groupDefId, fromNode, fromPort, toNode, toPort) as NodeSpec
    );
  }

  removeInternalConnection(groupDefId: string, toNode: string, toPort: string): Promise<NodeSpec> {
    return this.scheduler.enqueue(() =>
      this.getEngine().remove_internal_connection(groupDefId, toNode, toPort) as NodeSpec
    );
  }

  addInternalNode(groupDefId: string, typeId: string, x: number, y: number): Promise<InternalGraphNode> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      if (typeof eng.add_internal_node !== 'function') {
        throw new Error('Internal group node creation not yet supported in WASM engine');
      }
      return normalizeWasmInternalNode(eng.add_internal_node(groupDefId, typeId, x, y));
    });
  }

  removeInternalNode(groupDefId: string, nodeId: string): Promise<NodeSpec> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      if (typeof eng.remove_internal_node !== 'function') {
        throw new Error('Internal group node removal not yet supported in WASM engine');
      }
      return eng.remove_internal_node(groupDefId, nodeId);
    });
  }

  setInternalParam(groupDefId: string, nodeId: string, key: string, value: ParamValue): Promise<NodeSpec> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      if (typeof eng.set_internal_param !== 'function') {
        throw new Error('Internal group param edits not yet supported in WASM engine');
      }
      return eng.set_internal_param(groupDefId, nodeId, key, value);
    });
  }

  setInternalInputDefault(groupDefId: string, nodeId: string, portName: string, value: ParamValue): Promise<NodeSpec> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      if (typeof eng.set_internal_input_default !== 'function') {
        throw new Error('Internal group input default edits not yet supported in WASM engine');
      }
      return eng.set_internal_input_default(groupDefId, nodeId, portName, value);
    });
  }

  setInternalPosition(groupDefId: string, nodeId: string, x: number, y: number): Promise<NodeSpec> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      if (typeof eng.set_internal_position !== 'function') {
        throw new Error('Internal group position edits not yet supported in WASM engine');
      }
      return eng.set_internal_position(groupDefId, nodeId, x, y);
    });
  }

  setInternalMuted(groupDefId: string, nodeId: string, muted: boolean): Promise<NodeSpec> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      if (typeof eng.set_internal_muted !== 'function') {
        throw new Error('Internal group mute edits not yet supported in WASM engine');
      }
      return eng.set_internal_muted(groupDefId, nodeId, muted);
    });
  }

  compileInternalScriptNode(groupDefId: string, nodeId: string, manifestJson: string): Promise<NodeSpec> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      if (typeof eng.compile_internal_script_node !== 'function') {
        throw new Error('Internal GPU script compilation not yet supported in WASM engine');
      }
      return eng.compile_internal_script_node(groupDefId, nodeId, manifestJson);
    });
  }

  setAiApiKey(provider: string, key: string): Promise<void> {
    return this.scheduler.enqueue(() => {
      this.getEngineWithBindings().set_ai_api_key?.(provider, key);
    });
  }

  isAiConfigured(): Promise<boolean> {
    return this.scheduler.enqueue(() =>
      this.getEngineWithBindings().is_ai_configured?.() ?? false
    );
  }

  runAiNode(nodeId: string): Promise<void> {
    return this.scheduler.enqueue(async () => {
      const eng = this.getEngineWithBindings();
      if (!eng.run_ai_node) {
        throw new Error('AI node execution not supported in WASM engine');
      }
      await eng.run_ai_node(nodeId);
    });
  }

  getNodeExecutionState(nodeId: string): { status: string; isStale: boolean; error: string } {
    // This reads lightweight cached state — no engine mutation, safe without scheduling.
    // Keeping it synchronous so polling UIs don't add microtask latency.
    const result = this.getEngineWithBindings().get_node_execution_state?.(nodeId) ?? {};
    return {
      status: result.status ?? 'idle',
      isStale: result.isStale ?? false,
      error: result.error ?? '',
    };
  }

  getColorManagementInfo(): Promise<ColorManagementInfo> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      return eng.get_color_management_info?.() as ColorManagementInfo;
    });
  }

  getViewsForDisplay(display: string): Promise<string[]> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      return eng.get_views_for_display?.(display) ?? [];
    });
  }

  setDisplayView(display: string, view: string): Promise<void> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      eng.set_display_view?.(display, view);
    });
  }

  setProjectFormat(width: number, height: number): Promise<void> {
    return this.scheduler.enqueue(() => {
      this.getEngineWithBindings().set_project_format?.(width, height);
    });
  }

  getNodeSpec(nodeId: string): Promise<NodeSpec> {
    return this.scheduler.enqueue(() => {
      return this.getEngine().get_node_spec(nodeId) as unknown as NodeSpec;
    });
  }

  async evaluateBytesOutput(nodeId: string, portName: string): Promise<Uint8Array> {
    return this.scheduler.enqueue(() =>
      this.getEngine().evaluate_bytes_output(nodeId, portName) as unknown as Uint8Array
    );
  }

  validateEdits(editsJson: string): Promise<EditValidationError[]> {
    return this.scheduler.enqueue(() =>
      this.getEngine().validate_edits(editsJson) as EditValidationError[]
    );
  }

  exportGroupAsPackage(groupDefId: string): Promise<unknown> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      return eng.export_group_as_package?.(groupDefId);
    });
  }

  importCustomNodes(json: string): Promise<NodeSpec[]> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      const pkg = JSON.parse(json);
      return eng.import_custom_nodes?.(pkg) ?? [];
    });
  }

  registerGroupDefinition(json: string): Promise<NodeSpec> {
    return this.scheduler.enqueue(() => {
      const eng = this.getEngineWithBindings();
      const definition = JSON.parse(json);
      const spec = eng.register_group_definition?.(definition);
      if (!spec) throw new Error('Group definition registration not supported');
      return spec;
    });
  }

  typesCompatible(fromType: string, toType: string): boolean {
    const eng = this.getEngine();
    return eng.types_compatible(fromType, toType);
  }

  migrateDocument(jsonStr: string): string {
    return migrate_document_json(jsonStr);
  }

  needsMigration(jsonStr: string): boolean {
    return needs_migration_json(jsonStr);
  }
}
export const wasmEngine = new WasmEngine();
