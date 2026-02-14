import init, { Engine } from '../wasm-pkg/compositor_wasm';
import type { EngineBridge, AddNodeResult } from './bridge';
import type { NodeSpec, ParamValue, PortSpec, RenderResult, CreateGroupResult, UngroupResult, GroupInternalGraph } from '../store/types';
import { extractParamValue } from '../store/types';

type DocumentEnvelope = {
  compositor: unknown;
  graph: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isDocumentEnvelope = (value: unknown): value is DocumentEnvelope => isRecord(value) && 'compositor' in value && 'graph' in value;

const extractGraphData = (value: unknown): unknown => isDocumentEnvelope(value) ? value.graph : value;

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

let engine: Engine | null = null;
let initPromise: Promise<void> | null = null;

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

export class WasmEngine implements EngineBridge {
  private lastTimings: Record<string, number> = {};

  private getEngine(): Engine {
    if (!engine) throw new Error('WASM engine not initialized');
    return engine;
  }

  getLastRenderTimings(): Record<string, number> {
    return this.lastTimings;
  }

  listNodeTypes(): NodeSpec[] {
    return this.getEngine().list_node_types() as NodeSpec[];
  }

  addNode(typeId: string, x: number, y: number): AddNodeResult {
    // WASM returns { id, typeId } as JsValue; generated .d.ts lags behind until wasm-pack rebuild
    const result = this.getEngine().add_node(typeId, x, y) as unknown as { id: string; typeId: string };
    return { id: result.id, typeId: result.typeId };
  }

  removeNode(nodeId: string): void {
    this.getEngine().remove_node(nodeId);
  }

  connect(fromNode: string, fromPort: string, toNode: string, toPort: string): void {
    this.getEngine().connect(fromNode, fromPort, toNode, toPort);
  }

  disconnect(toNode: string, toPort: string): void {
    this.getEngine().disconnect(toNode, toPort);
  }

  setParam(nodeId: string, key: string, value: ParamValue): void {
    const raw = extractParamValue(value);
    this.getEngine().set_param(nodeId, key, raw);
  }

  loadImageData(nodeId: string, data: Uint8Array): void {
    console.log(`[WASM] loadImageData nodeId=${nodeId} bytes=${data.length}`);
    try {
      this.getEngine().load_image_data(nodeId, data);
      console.log(`[WASM] loadImageData SUCCESS`);
    } catch (e) {
      console.error(`[WASM] loadImageData FAILED:`, e);
      throw e;
    }
  }

  async renderViewer(viewerNodeId: string, frame: number): Promise<RenderResult | null> {
    console.log(`[WASM] renderViewer nodeId=${viewerNodeId} frame=${frame}`);
    try {
      const pixels = await this.getEngine().render_viewer(viewerNodeId, BigInt(frame));
      
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

      console.log(`[WASM] renderViewer pixels=${pixels ? pixels.length : 'null'}`);
      if (!pixels || pixels.length === 0) return null;

      const dims = await this.getEngine().get_render_dimensions(viewerNodeId, BigInt(frame));
      console.log(`[WASM] renderViewer dims=`, dims);
      if (!dims) return null;

      return {
        nodeId: viewerNodeId,
        width: dims.width,
        height: dims.height,
        pixels: new Uint8ClampedArray(pixels.buffer),
      };
    } catch (e) {
      console.error(`[WASM] renderViewer FAILED:`, e);
      return null;
    }
  }

  exportGraph(): unknown {
    return this.getEngine().export_graph();
  }

  importGraph(data: unknown): void {
    this.getEngine().import_graph(data);
  }

  exportDocument(): unknown {
    const graph = this.getEngine().export_graph();
    return createDocumentEnvelope(graph);
  }

  importDocument(data: unknown): void {
    const graph = extractGraphData(data);
    this.getEngine().import_graph(graph);
  }

  registerGpuKernel(_manifestJson: string): NodeSpec {
    throw new Error('Dynamic GPU kernel registration not yet supported in WASM');
  }

  compileScriptNode(nodeId: string, manifestJson: string): NodeSpec {
    const result = this.getEngine().compile_script_node(nodeId, manifestJson);
    return result as NodeSpec;
  }

  async exportImage(nodeId: string, frame: number): Promise<Uint8Array> {
    const bytes = await this.getEngine().export_image(nodeId, BigInt(frame));
    return new Uint8Array(bytes);
  }

  async createGroupFromNodes(nodeIds: string[], name: string): Promise<CreateGroupResult> {
    const eng = this.getEngine() as any;
    if (typeof eng.create_group_from_nodes !== 'function') {
      throw new Error('Group creation not yet supported in WASM engine');
    }
    return eng.create_group_from_nodes(nodeIds, name) as CreateGroupResult;
  }

  async ungroupNode(groupNodeId: string): Promise<UngroupResult> {
    const eng = this.getEngine() as any;
    if (typeof eng.ungroup_node !== 'function') {
      throw new Error('Ungrouping not yet supported in WASM engine');
    }
    const raw = eng.ungroup_node(groupNodeId) as any;
    return {
      removedGroupNodeId: raw.removedGroupNodeId,
      restoredNodes: (raw.restoredNodes ?? []).map((n: any) => ({
        id: n.id,
        typeId: n.typeId,
        position: Array.isArray(n.position) ? { x: n.position[0], y: n.position[1] } : n.position,
        params: n.params,
      })),
    };
  }

  async getGroupInternalGraph(groupNodeId: string): Promise<GroupInternalGraph> {
    const eng = this.getEngine() as any;
    if (typeof eng.get_group_internal_graph !== 'function') {
      throw new Error('Group inspection not yet supported in WASM engine');
    }
    const raw = eng.get_group_internal_graph(groupNodeId) as any;
    return {
      groupDefId: raw.groupDefId,
      name: raw.name,
      nodes: (raw.nodes ?? []).map((n: any) => ({
        id: n.id,
        typeId: n.typeId,
        position: Array.isArray(n.position) ? { x: n.position[0], y: n.position[1] } : n.position,
        params: n.params,
      })),
      connections: (raw.connections ?? []).map((c: any) => ({
        id: crypto.randomUUID(),
        fromNode: c.fromNode,
        fromPort: c.fromPort,
        toNode: c.toNode,
        toPort: c.toPort,
      })),
      inputs: raw.inputs,
      outputs: raw.outputs,
    };
  }

  async updateGroupInterface(groupDefId: string, inputs: PortSpec[], outputs: PortSpec[]): Promise<NodeSpec> {
    const eng = this.getEngine() as any;
    if (typeof eng.update_group_interface !== 'function') {
      throw new Error('Group interface update not yet supported in WASM engine');
    }
    return eng.update_group_interface(groupDefId, inputs, outputs) as NodeSpec;
  }

  async addInternalConnection(groupDefId: string, fromNode: string, fromPort: string, toNode: string, toPort: string): Promise<NodeSpec> {
    return this.getEngine().add_internal_connection(groupDefId, fromNode, fromPort, toNode, toPort) as NodeSpec;
  }

  async removeInternalConnection(groupDefId: string, toNode: string, toPort: string): Promise<NodeSpec> {
    return this.getEngine().remove_internal_connection(groupDefId, toNode, toPort) as NodeSpec;
  }
}

export const wasmEngine = new WasmEngine();
