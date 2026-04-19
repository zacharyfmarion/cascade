import { invoke } from '@tauri-apps/api/core';
import type { EngineBridge, AddNodeResult, JobProgress, SequenceInfo, VideoInfo, ColorManagementInfo, NodeInterfaceChange } from './bridge';
import type { NodeSpec, ParamValue, PortSpec, ViewerResult, CreateGroupResult, UngroupResult, GroupInternalGraph, CustomNodeInfo } from '../store/types';

type DocumentEnvelope = {
  cascade: unknown;
  graph: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const asParamValueRecord = (value: unknown): Record<string, ParamValue> => (isRecord(value) ? value as Record<string, ParamValue> : {});

const isDocumentEnvelope = (value: unknown): value is DocumentEnvelope => isRecord(value) && ('cascade' in value || 'compositor' in value) && 'graph' in value;

const extractGraphData = (value: unknown): unknown => isDocumentEnvelope(value) ? value.graph : value;

const createDocumentEnvelope = (graph: unknown) => ({
  cascade: {
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

export class TauriEngine implements EngineBridge {
  private lastTimings: Record<string, number> = {};

  getLastRenderTimings(): Record<string, number> {
    return this.lastTimings;
  }

  private async fetchTimings(): Promise<void> {
    try {
      const json = await invoke<string>('get_last_render_timings');
      this.lastTimings = JSON.parse(json) as Record<string, number>;
    } catch {
      // Timings are best-effort; don't break rendering if this fails
    }
  }

  async listNodeTypes(): Promise<NodeSpec[]> {
    const json = await invoke<string>('list_node_types');
    return JSON.parse(json) as NodeSpec[];
  }

  async addNode(typeId: string, x: number, y: number): Promise<AddNodeResult> {
    const json = await invoke<string>('add_node', { typeId, x, y });
    return JSON.parse(json) as AddNodeResult;
  }

  async removeNode(nodeId: string): Promise<void> {
    await invoke('remove_node', { nodeId });
  }

  async connect(fromNode: string, fromPort: string, toNode: string, toPort: string): Promise<void> {
    await invoke('connect', { fromNode, fromPort, toNode, toPort });
  }

  async disconnect(toNode: string, toPort: string): Promise<void> {
    await invoke('disconnect', { toNode, toPort });
  }

  async setParam(nodeId: string, key: string, value: ParamValue): Promise<void> {
    await invoke('set_param', { nodeId, key, value });
  }

  async setInputDefault(nodeId: string, portName: string, value: ParamValue): Promise<void> {
    await invoke('set_input_default', { nodeId, portName, value });
  }

  async setPosition(nodeId: string, x: number, y: number): Promise<void> {
    await invoke('set_position', { nodeId, x, y });
  }

  async setMuted(nodeId: string, muted: boolean): Promise<void> {
    await invoke('set_muted', { nodeId, muted });
  }

  async setAndRender(mutation: { type: 'param' | 'inputDefault'; nodeId: string; key: string; value: ParamValue }, frame: number, previewScale?: number): Promise<Array<[string, ViewerResult]>> {
    const cmd = mutation.type === 'param' ? 'set_param_and_render' : 'set_input_default_and_render';
    const args = mutation.type === 'param'
      ? { nodeId: mutation.nodeId, key: mutation.key, value: mutation.value, frame, previewScale }
      : { nodeId: mutation.nodeId, portName: mutation.key, value: mutation.value, frame, previewScale };
    const buf = await invoke<ArrayBuffer>(cmd, args);
    const results: Array<[string, ViewerResult]> = [];
    if (!buf || buf.byteLength < 4) return results;

    const view = new DataView(buf);
    let offset = 0;
    const count = view.getUint32(offset, true);
    offset += 4;

    for (let i = 0; i < count; i++) {
      const idLen = view.getUint32(offset, true);
      offset += 4;
      const idBytes = new Uint8Array(buf, offset, idLen);
      const id = new TextDecoder().decode(idBytes);
      offset += idLen;
      const width = view.getUint32(offset, true);
      offset += 4;
      const height = view.getUint32(offset, true);
      offset += 4;
      const pixelLen = width * height * 4;
      const pixels = new Uint8ClampedArray(buf, offset, pixelLen);
      offset += pixelLen;
      results.push([id, { type: 'image' as const, nodeId: id, width, height, pixels }]);
    }
    await this.fetchTimings();
    return results;
  }

  async registerGpuKernel(manifestJson: string): Promise<NodeSpec> {
    const json = await invoke<string>('register_gpu_kernel', { manifestJson });
    return JSON.parse(json) as NodeSpec;
  }

  async compileScriptNode(nodeId: string, manifestJson: string): Promise<NodeSpec> {
    const json = await invoke<string>('compile_script_node', { nodeId, manifestJson });
    return JSON.parse(json) as NodeSpec;
  }

  async loadImageData(nodeId: string, data: Uint8Array): Promise<NodeInterfaceChange> {
    const json = await invoke<string>('load_image_data', data, {
      headers: { 'x-node-id': nodeId },
    });
    return JSON.parse(json) as NodeInterfaceChange;
  }

  async getImageData(nodeId: string): Promise<Uint8Array | null> {
    try {
      const buf = await invoke<ArrayBuffer>('get_image_data', { nodeId });
      if (!buf || buf.byteLength === 0) return null;
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }

  async renderViewer(viewerNodeId: string, frame: number): Promise<ViewerResult | null> {
    try {
      const buf = await invoke<ArrayBuffer>('render_viewer', { viewerNodeId, frame });
      if (!buf || buf.byteLength < 8) return null;

      const view = new DataView(buf);
      const width = view.getUint32(0, true);
      const height = view.getUint32(4, true);
      const pixels = new Uint8ClampedArray(buf, 8);

      await this.fetchTimings();
      return { type: 'image', nodeId: viewerNodeId, width, height, pixels };
    } catch {
      return null;
    }
  }

  async exportGraph(): Promise<unknown> {
    const json = await invoke<string>('export_graph');
    return JSON.parse(json);
  }

  async importGraph(data: unknown): Promise<void> {
    await invoke('import_graph', { data: JSON.stringify(data) });
  }

  async exportDocument(): Promise<unknown> {
    const json = await invoke<string>('export_graph');
    const graph = JSON.parse(json);
    return createDocumentEnvelope(graph);
  }

  async importDocument(data: unknown): Promise<void> {
    const graph = extractGraphData(data);
    await invoke('import_graph', { data: JSON.stringify(graph) });
  }

  async saveProject(path: string): Promise<void> {
    await invoke('save_project', { path });
  }

  async loadProject(path: string): Promise<unknown> {
    const json = await invoke<string>('load_project', { path });
    return JSON.parse(json);
  }

  async exportImage(nodeId: string, frame: number): Promise<Uint8Array> {
    const buf = await invoke<ArrayBuffer>('export_image', { nodeId, frame });
    return new Uint8Array(buf);
  }

  async exportImageToPath(nodeId: string, frame: number, path: string): Promise<void> {
    await invoke('export_image_to_path', { nodeId, frame, path });
  }

  async renderSequence(nodeId: string): Promise<string> {
    return invoke<string>('render_sequence', { nodeId });
  }

  async renderVideo(nodeId: string): Promise<string> {
    return invoke<string>('render_video', { nodeId });
  }

  async cancelJob(): Promise<void> {
    await invoke('cancel_render_job');
  }

  async getJobProgress(): Promise<JobProgress | null> {
    const json = await invoke<string>('get_job_progress');
    const parsed = JSON.parse(json);
    return parsed === null ? null : parsed as JobProgress;
  }

  async setSequenceDirectory(nodeId: string, directory: string): Promise<SequenceInfo> {
    const json = await invoke<string>('set_sequence_directory', { nodeId, directory });
    return JSON.parse(json) as SequenceInfo;
  }

  async getSequenceInfo(nodeId: string, pattern: string): Promise<SequenceInfo> {
    const json = await invoke<string>('get_sequence_info', { nodeId, pattern });
    return JSON.parse(json) as SequenceInfo;
  }

  async loadVideoFile(nodeId: string, path: string): Promise<VideoInfo> {
    const json = await invoke<string>('load_video_file', { nodeId, path });
    return JSON.parse(json) as VideoInfo;
  }

  async createGroupFromNodes(nodeIds: string[], name: string): Promise<CreateGroupResult> {
    const json = await invoke<string>('create_group_from_nodes', { nodeIds, name });
    return JSON.parse(json) as CreateGroupResult;
  }

  async ungroupNode(groupNodeId: string): Promise<UngroupResult> {
    const json = await invoke<string>('ungroup_node', { groupNodeId });
    const raw = JSON.parse(json) as unknown;
    const rawRecord = asRecord(raw);
    const restoredRaw = Array.isArray(rawRecord.restoredNodes) ? rawRecord.restoredNodes : [];
    return {
      removedGroupNodeId: String(rawRecord.removedGroupNodeId ?? ''),
      restoredNodes: restoredRaw.map((nodeEntry: unknown) => {
        const nodeRecord = asRecord(nodeEntry);
        const position = Array.isArray(nodeRecord.position)
          ? { x: Number(nodeRecord.position[0]), y: Number(nodeRecord.position[1]) }
          : isRecord(nodeRecord.position)
            ? { x: Number(nodeRecord.position.x), y: Number(nodeRecord.position.y) }
            : { x: 0, y: 0 };
        return {
          id: String(nodeRecord.id ?? ''),
          typeId: String(nodeRecord.typeId ?? ''),
          position,
          params: asParamValueRecord(nodeRecord.params),
          inputDefaults: asParamValueRecord(nodeRecord.input_defaults),
        };
      }),
    };
  }

  async getGroupInternalGraph(groupNodeId: string): Promise<GroupInternalGraph> {
    const json = await invoke<string>('get_group_internal_graph', { groupNodeId });
    const raw = JSON.parse(json) as unknown;
    const rawRecord = asRecord(raw);
    const rawNodes = Array.isArray(rawRecord.nodes) ? rawRecord.nodes : [];
    const rawConnections = Array.isArray(rawRecord.connections) ? rawRecord.connections : [];
    return {
      groupDefId: String(rawRecord.groupDefId ?? ''),
      name: String(rawRecord.name ?? ''),
      nodes: rawNodes.map((nodeEntry: unknown) => {
        const nodeRecord = asRecord(nodeEntry);
        const position = Array.isArray(nodeRecord.position)
          ? { x: Number(nodeRecord.position[0]), y: Number(nodeRecord.position[1]) }
          : isRecord(nodeRecord.position)
            ? { x: Number(nodeRecord.position.x), y: Number(nodeRecord.position.y) }
            : { x: 0, y: 0 };
        return {
          id: String(nodeRecord.id ?? ''),
          typeId: String(nodeRecord.typeId ?? ''),
          position,
          params: asParamValueRecord(nodeRecord.params),
          inputDefaults: asParamValueRecord(nodeRecord.input_defaults),
        };
      }),
      connections: rawConnections.map((connEntry: unknown) => {
        const connRecord = asRecord(connEntry);
        return {
          id: String(connRecord.id ?? crypto.randomUUID()),
          fromNode: String(connRecord.fromNode ?? ''),
          fromPort: String(connRecord.fromPort ?? ''),
          toNode: String(connRecord.toNode ?? ''),
          toPort: String(connRecord.toPort ?? ''),
        };
      }),
      inputs: Array.isArray(rawRecord.inputs) ? rawRecord.inputs as PortSpec[] : [],
      outputs: Array.isArray(rawRecord.outputs) ? rawRecord.outputs as PortSpec[] : [],
    };
  }

  async updateGroupInterface(groupDefId: string, inputs: PortSpec[], outputs: PortSpec[]): Promise<NodeSpec> {
    const json = await invoke<string>('update_group_interface', { groupDefId, inputs: JSON.stringify(inputs), outputs: JSON.stringify(outputs) });
    return JSON.parse(json) as NodeSpec;
  }

  async addInternalConnection(groupDefId: string, fromNode: string, fromPort: string, toNode: string, toPort: string): Promise<NodeSpec> {
    const json = await invoke<string>('add_internal_connection', { groupDefId, fromNode, fromPort, toNode, toPort });
    return JSON.parse(json) as NodeSpec;
  }

  async removeInternalConnection(groupDefId: string, toNode: string, toPort: string): Promise<NodeSpec> {
    const json = await invoke<string>('remove_internal_connection', { groupDefId, toNode, toPort });
    return JSON.parse(json) as NodeSpec;
  }

  async renameGroup(groupDefId: string, newName: string): Promise<NodeSpec> {
    const json = await invoke<string>('rename_group', { groupDefId, newName });
    return JSON.parse(json) as NodeSpec;
  }

  async setAiApiKey(provider: string, key: string): Promise<void> {
    await invoke('set_ai_api_key', { provider, key });
  }

  async isAiConfigured(): Promise<boolean> {
    return invoke<boolean>('is_ai_configured');
  }

  async getColorManagementInfo(): Promise<ColorManagementInfo> {
    const json = await invoke<string>('get_color_management_info');
    return JSON.parse(json) as ColorManagementInfo;
  }

  async getViewsForDisplay(display: string): Promise<string[]> {
    const json = await invoke<string>('list_views', { display });
    return JSON.parse(json) as string[];
  }

  async setDisplayView(display: string, view: string): Promise<void> {
    await invoke('set_display_view', { display, view });
  }

  async setProjectFormat(width: number, height: number): Promise<void> {
    await invoke('set_project_format', { width, height });
  }

  async exportGroupAsPackage(groupDefId: string): Promise<unknown> {
    const json = await invoke<string>('export_group_as_package', { groupDefId });
    return JSON.parse(json);
  }

  async importCustomNodes(json: string): Promise<NodeSpec[]> {
    const result = await invoke<string>('import_custom_nodes', { json });
    return JSON.parse(result) as NodeSpec[];
  }

  async listCustomNodes(): Promise<CustomNodeInfo[]> {
    const json = await invoke<string>('list_custom_nodes');
    return JSON.parse(json) as CustomNodeInfo[];
  }

  async removeCustomNode(groupDefId: string): Promise<void> {
    await invoke('remove_custom_node', { groupDefId });
  }

  migrateDocument(_jsonStr: string): string {
    // TODO: Implement Tauri IPC for migration
    return _jsonStr;  // Pass-through for now
  }

  needsMigration(_jsonStr: string): boolean {
    // TODO: Implement Tauri IPC
    return false;
  }
}

export const tauriEngine = new TauriEngine();
