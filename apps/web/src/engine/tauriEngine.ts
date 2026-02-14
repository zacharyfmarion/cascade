import { invoke } from '@tauri-apps/api/core';
import type { EngineBridge, JobProgress, SequenceInfo } from './bridge';
import type { NodeSpec, ParamValue, PortSpec, RenderResult, CreateGroupResult, UngroupResult, GroupInternalGraph } from '../store/types';

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

  async addNode(typeId: string, x: number, y: number): Promise<string> {
    return invoke<string>('add_node', { typeId, x, y });
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

  async setParamAndRender(nodeId: string, key: string, value: ParamValue, frame: number): Promise<Map<string, RenderResult>> {
    const buf = await invoke<ArrayBuffer>('set_param_and_render', { nodeId, key, value, frame });
    const results = new Map<string, RenderResult>();
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
      results.set(id, { nodeId: id, width, height, pixels });
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

  async loadImageData(nodeId: string, data: Uint8Array): Promise<void> {
    await invoke('load_image_data', data, {
      headers: { 'x-node-id': nodeId },
    });
  }

  async renderViewer(viewerNodeId: string, frame: number): Promise<RenderResult | null> {
    try {
      const buf = await invoke<ArrayBuffer>('render_viewer', { viewerNodeId, frame });
      if (!buf || buf.byteLength < 8) return null;

      const view = new DataView(buf);
      const width = view.getUint32(0, true);
      const height = view.getUint32(4, true);
      const pixels = new Uint8ClampedArray(buf, 8);

      await this.fetchTimings();
      return { nodeId: viewerNodeId, width, height, pixels };
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

  async renderSequence(nodeId: string): Promise<string> {
    return invoke<string>('render_sequence', { nodeId });
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

  async createGroupFromNodes(nodeIds: string[], name: string): Promise<CreateGroupResult> {
    const json = await invoke<string>('create_group_from_nodes', { nodeIds, name });
    return JSON.parse(json) as CreateGroupResult;
  }

  async ungroupNode(groupNodeId: string): Promise<UngroupResult> {
    const json = await invoke<string>('ungroup_node', { groupNodeId });
    const raw = JSON.parse(json);
    return {
      removedGroupNodeId: raw.removedGroupNodeId,
      restoredNodes: (raw.restoredNodes ?? []).map((n: any) => ({
        id: n.id,
        typeId: n.typeId,
        position: { x: n.position[0], y: n.position[1] },
        params: n.params,
      })),
    };
  }

  async getGroupInternalGraph(groupNodeId: string): Promise<GroupInternalGraph> {
    const json = await invoke<string>('get_group_internal_graph', { groupNodeId });
    const raw = JSON.parse(json);
    return {
      groupDefId: raw.groupDefId,
      name: raw.name,
      nodes: (raw.nodes ?? []).map((n: any) => ({
        id: n.id,
        typeId: n.typeId,
        position: { x: n.position[0], y: n.position[1] },
        params: n.params,
      })),
      connections: (raw.connections ?? []).map((c: any) => ({
        id: c.id ?? crypto.randomUUID(),
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
}

export const tauriEngine = new TauriEngine();
