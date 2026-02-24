import init, { Engine } from '../wasm-pkg/compositor_wasm';
import type { EngineBridge, AddNodeResult, ColorManagementInfo, EditValidationError } from './bridge';
import type { NodeSpec, ParamValue, PortSpec, RenderResult, CreateGroupResult, UngroupResult, GroupInternalGraph } from '../store/types';
import { extractParamValue } from '../store/types';

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
    const raw = paramValueToWasm(value);
    this.getEngine().set_param(nodeId, key, raw);
  }

  setInputDefault(nodeId: string, portName: string, value: ParamValue): void {
    const raw = paramValueToWasm(value);
    this.getEngine().set_input_default(nodeId, portName, raw);
  }

  setPosition(nodeId: string, x: number, y: number): void {
    this.getEngine().set_position(nodeId, x, y);
  }

  setMuted(nodeId: string, muted: boolean): void {
    (this.getEngine() as any).set_muted(nodeId, muted);
  }

  loadImageData(nodeId: string, data: Uint8Array): void {
    this.getEngine().load_image_data(nodeId, data);
  }

  loadPaletteData(nodeId: string, data: Uint8Array): [number, number, number, number][] {
    const result = (this.getEngine() as any).load_palette_data(nodeId, data);
    return result as [number, number, number, number][];
  }

  loadSequenceFrameData(nodeId: string, frame: number, data: Uint8Array): void {
    (this.getEngine() as any).load_sequence_frame_data(nodeId, BigInt(frame), data);
  }

  setSequenceInfo(nodeId: string, info: { frame_count: number; first_frame: number; last_frame: number }): void {
    (this.getEngine() as any).set_sequence_info(
      nodeId,
      BigInt(info.frame_count),
      BigInt(info.first_frame),
      BigInt(info.last_frame),
    );
  }

  async renderViewer(viewerNodeId: string, frame: number): Promise<RenderResult | null> {
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

    if (!pixels || pixels.length === 0) return null;

    const dims = await this.getEngine().get_render_dimensions(viewerNodeId, BigInt(frame));
    if (!dims) return null;

    return {
      nodeId: viewerNodeId,
      width: dims.width,
      height: dims.height,
      pixels: new Uint8ClampedArray(pixels.buffer),
    };
  }

  exportGraph(): unknown {
    return this.getEngine().export_graph();
  }

  importGraph(data: unknown): void {
    this.getEngine().import_graph(data);
  }

  getImageData(nodeId: string): Uint8Array | null {
    try {
      const bytes = this.getEngine().get_image_data(nodeId);
      return new Uint8Array(bytes);
    } catch {
      return null;
    }
  }

  exportDocument(): unknown {
    const eng = this.getEngine();
    const graph = eng.export_graph();
    const doc = createDocumentEnvelope(graph);

    // Embed image data for LoadImage nodes and AI node results as base64
    const graphData = graph as { nodes?: Array<{ id: string; type_id: string }> };
    if (graphData.nodes) {
      const assets: Record<string, { type: string; source: string; data: string; original_filename: string; hash: string }> = {};
      for (const node of graphData.nodes) {
        if (node.type_id === 'load_image') {
          const imageData = this.getImageData(node.id);
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
        } else if (node.type_id.startsWith('ai_')) {
          try {
            const aiData = (eng as any).get_ai_node_image_data(node.id) as Uint8Array;
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
  }

  importDocument(data: unknown): void {
    const graph = extractGraphData(data);
    this.getEngine().import_graph(graph);

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
            this.getEngine().load_image_data(nodeId, bytes);
          } else if (assetRef.type === 'ai_result') {
            (this.getEngine() as any).set_ai_node_image_data(nodeId, bytes);
          }
        } catch (e) {
          console.warn(`Failed to load embedded asset for node ${nodeId}:`, e);
        }
      }
    }
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
        inputDefaults: n.input_defaults ?? {},
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
        inputDefaults: n.input_defaults ?? {},
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

  async renameGroup(groupDefId: string, newName: string): Promise<NodeSpec> {
    const eng = this.getEngine() as any;
    if (typeof eng.rename_group !== 'function') {
      throw new Error('Group rename not yet supported in WASM engine');
    }
    return eng.rename_group(groupDefId, newName) as NodeSpec;
  }

  async addInternalConnection(groupDefId: string, fromNode: string, fromPort: string, toNode: string, toPort: string): Promise<NodeSpec> {
    return this.getEngine().add_internal_connection(groupDefId, fromNode, fromPort, toNode, toPort) as NodeSpec;
  }

  async removeInternalConnection(groupDefId: string, toNode: string, toPort: string): Promise<NodeSpec> {
    return this.getEngine().remove_internal_connection(groupDefId, toNode, toPort) as NodeSpec;
  }

  setAiApiKey(provider: string, key: string): void {
    (this.getEngine() as any).set_ai_api_key(provider, key);
  }

  isAiConfigured(): boolean {
    return (this.getEngine() as any).is_ai_configured() as boolean;
  }

  async runAiNode(nodeId: string): Promise<void> {
    await (this.getEngine() as any).run_ai_node(nodeId);
  }

  getNodeExecutionState(nodeId: string): { status: string; isStale: boolean; error: string } {
    const result = (this.getEngine() as any).get_node_execution_state(nodeId);
    return {
      status: result.status ?? 'idle',
      isStale: result.isStale ?? false,
      error: result.error ?? '',
    };
  }

  getColorManagementInfo(): ColorManagementInfo {
    const eng = this.getEngine() as any;
    return eng.get_color_management_info() as ColorManagementInfo;
  }

  getViewsForDisplay(display: string): string[] {
    const eng = this.getEngine() as any;
    return eng.get_views_for_display(display) as string[];
  }

  setDisplayView(display: string, view: string): void {
    const eng = this.getEngine() as any;
    eng.set_display_view(display, view);
  }

  setProjectFormat(width: number, height: number): void {
    (this.getEngine() as any).set_project_format(width, height);
  }

  validateEdits(editsJson: string): EditValidationError[] {
    return this.getEngine().validate_edits(editsJson) as EditValidationError[];
  }
}

export const wasmEngine = new WasmEngine();
