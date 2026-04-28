import type { EngineBridge, AddNodeResult, NodeInterfaceChange } from '../engine/bridge';
import type { GroupInternalGraph, InternalGraphNode, NodeSpec, ParamValue, ViewerResult } from '../store/types';
import { buildDefaultGpuScriptManifest, buildGpuScriptNodeSpec, parseGpuScriptManifestJson } from '../ai/gpuScript';

const NODE_SPECS: NodeSpec[] = [
  {
    id: 'gpu_script',
    display_name: 'GPU Script',
    category: 'GPU',
    description: 'Custom GPU shader node. Write GLSL and compile to run.',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: [],
  },
  {
    id: 'load_image',
    display_name: 'Load Image',
    category: 'Input',
    description: 'Load an image from file',
    inputs: [],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: [
      {
        key: 'file',
        label: 'File',
        ty: 'Image',
        default: { String: '' },
        ui_hint: { type: 'FilePicker' },
        promotable: true,
      },
    ],
  },
  {
    id: 'viewer',
    display_name: 'Viewer',
    category: 'Output',
    description: 'View the result',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [{ name: 'display', label: 'Display', ty: 'Image' }],
    params: [],
  },
  {
    id: 'float_constant',
    display_name: 'Float',
    category: 'Generator',
    description: 'A constant float value',
    inputs: [],
    outputs: [{ name: 'value', label: 'Value', ty: 'Float' }],
    params: [
      {
        key: 'value',
        label: 'Value',
        ty: 'Float',
        default: { Float: 0 },
        ui_hint: { type: 'NumberInput' },
        promotable: true,
      },
    ],
  },
  {
    id: 'gaussian_blur',
    display_name: 'Gaussian Blur',
    category: 'Filter',
    description: 'Apply gaussian blur',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: [
      {
        key: 'amount',
        label: 'Amount',
        ty: 'Float',
        default: { Float: 0.5 },
        min: 0.0,
        max: 5.0,
        step: 0.01,
        ui_hint: { type: 'Slider' },
        promotable: true,
      },
      {
        key: 'radius',
        label: 'Radius',
        ty: 'Float',
        default: { Float: 1.0 },
        min: 0.0,
        max: 20.0,
        step: 0.1,
        ui_hint: { type: 'Slider' },
        promotable: true,
      },
    ],
  },
  {
    id: 'curves',
    display_name: 'Curves',
    category: 'Color',
    description: 'Adjust curves',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: [],
  },
  {
    id: 'load_image_sequence',
    display_name: 'Load Image Sequence',
    category: 'Input',
    description: 'Load a sequence of images',
    inputs: [],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: [
      {
        key: 'pattern',
        label: 'Pattern',
        ty: 'Float',
        default: { String: '' },
        ui_hint: { type: 'FilePicker' },
        promotable: true,
      },
    ],
  },
  {
    id: 'load_video',
    display_name: 'Load Video',
    category: 'Input',
    description: 'Load a video file',
    inputs: [],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: [
      {
        key: 'file_path',
        label: 'File Path',
        ty: 'String',
        default: { String: '' },
        ui_hint: { type: 'Hidden' },
        promotable: false,
      },
    ],
    supported_surfaces: ['desktop'],
  },
  {
    id: 'export_image',
    display_name: 'Export Image',
    category: 'Output',
    description: 'Export image to file',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [],
    params: [
      {
        key: 'format',
        label: 'Format',
        ty: 'Int',
        default: { Int: 0 },
        ui_hint: { type: 'Dropdown', data: ['PNG', 'JPG'] },
        promotable: true,
      },
    ],
  },
  {
    id: 'export_video',
    display_name: 'Export Video',
    category: 'Output',
    description: 'Export rendered frames as an encoded video file',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [{ name: 'display', label: 'Display', ty: 'Image' }],
    params: [],
    supported_surfaces: ['desktop'],
  },
  {
    id: 'ai_depth_estimate',
    display_name: 'AI Depth Estimate',
    category: 'AI',
    description: 'Estimate depth from an image using AI',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [{ name: 'depth', label: 'Depth', ty: 'Image' }],
    params: [],
  },
];

let nodeCounter = 0;

export function createMockEngine(): EngineBridge & {
  _nodes: Map<string, { typeId: string; params: Record<string, ParamValue> }>;
  _connections: Array<{ fromNode: string; fromPort: string; toNode: string; toPort: string }>;
  _graphState: unknown;
  _renderResult: ViewerResult | null;
  _setRenderResult: (r: ViewerResult | null) => void;
  _renderCalls: string[];
  _clearRenderCalls: () => void;
  _groupGraphs: Map<string, GroupInternalGraph>;
} {
  const nodes = new Map<string, { typeId: string; params: Record<string, ParamValue> }>();
  const connections: Array<{ fromNode: string; fromPort: string; toNode: string; toPort: string }> = [];
  const imageDataStore = new Map<string, Uint8Array>();
  const groupGraphs = new Map<string, GroupInternalGraph>();
  const extraSpecs: NodeSpec[] = [];
  let graphState: unknown = { nodes: [], connections: [] };
  let renderResult: ViewerResult | null = null;
  const renderCalls: string[] = [];

  return {
    _nodes: nodes,
    _connections: connections,
    _graphState: graphState,
    _renderResult: renderResult,
    _setRenderResult: (r: ViewerResult | null) => { renderResult = r; },
    _renderCalls: renderCalls,
    _clearRenderCalls: () => { renderCalls.length = 0; },
    _groupGraphs: groupGraphs,

    listNodeTypes: () => [...NODE_SPECS, ...extraSpecs],

    registerGpuKernel: async (manifestJson: string): Promise<NodeSpec> => {
      const manifest = parseGpuScriptManifestJson(manifestJson);
      if (!manifest) throw new Error('Invalid manifest');
      const spec = buildGpuScriptNodeSpec(manifest);
      const existing = extraSpecs.findIndex(s => s.id === spec.id);
      if (existing >= 0) {
        extraSpecs[existing] = spec;
      } else {
        extraSpecs.push(spec);
      }
      return spec;
    },

    registerGroupDefinition: async (json: string): Promise<NodeSpec> => {
      const definition = JSON.parse(json) as {
        id: string;
        name: string;
        category: string;
        description: string;
        explicit_inputs?: NodeSpec['inputs'];
        explicit_outputs?: NodeSpec['outputs'];
        promotions?: Array<{ spec: NodeSpec['params'][number] }>;
      };
      const spec: NodeSpec = {
        id: definition.id,
        display_name: definition.name,
        category: definition.category,
        description: definition.description,
        inputs: definition.explicit_inputs ?? [],
        outputs: definition.explicit_outputs ?? [],
        params: (definition.promotions ?? []).map(promotion => promotion.spec),
      };
      const existing = extraSpecs.findIndex(s => s.id === spec.id);
      if (existing >= 0) {
        extraSpecs[existing] = spec;
      } else {
        extraSpecs.push(spec);
      }
      return spec;
    },

    addNode: (typeId: string, _x: number, _y: number): AddNodeResult => {
      const id = `node-${++nodeCounter}`;
      const actualTypeId = typeId === 'gpu_script' ? `gpu_script::mock_${nodeCounter}` : typeId;
      const spec = [...NODE_SPECS, ...extraSpecs].find(s => s.id === typeId);
      const params: Record<string, ParamValue> = {};
      if (spec) {
        for (const p of spec.params) {
          params[p.key] = p.default;
        }
      }
      if (actualTypeId.startsWith('gpu_script::')) {
        params.__script_manifest = { String: JSON.stringify(buildDefaultGpuScriptManifest(actualTypeId)) };
      }
      nodes.set(id, { typeId: actualTypeId, params });
      return { id, typeId: actualTypeId };
    },

    removeNode: (nodeId: string) => {
      nodes.delete(nodeId);
      const toRemove: number[] = [];
      connections.forEach((c, i) => {
        if (c.fromNode === nodeId || c.toNode === nodeId) toRemove.push(i);
      });
      for (let i = toRemove.length - 1; i >= 0; i--) {
        connections.splice(toRemove[i], 1);
      }
    },

    connect: (fromNode: string, fromPort: string, toNode: string, toPort: string) => {
      connections.push({ fromNode, fromPort, toNode, toPort });
    },

    disconnect: (toNode: string, toPort: string) => {
      const idx = connections.findIndex(c => c.toNode === toNode && c.toPort === toPort);
      if (idx >= 0) connections.splice(idx, 1);
    },

    setParam: (nodeId: string, key: string, value: ParamValue) => {
      const node = nodes.get(nodeId);
      if (node) node.params[key] = value;
    },

    setInputDefault: () => {},

    setPosition: () => {},

    setMuted: () => {},

    compileScriptNode: async (nodeId: string, manifestJson: string): Promise<NodeSpec> => {
      const node = nodes.get(nodeId);
      if (!node) throw new Error('Node not found');
      const manifest = parseGpuScriptManifestJson(manifestJson);
      if (!manifest) throw new Error('Invalid manifest');
      node.params.__script_manifest = { String: manifestJson };
      return buildGpuScriptNodeSpec({ ...manifest, id: node.typeId });
    },

    compileInternalScriptNode: async (_groupDefId: string, nodeId: string, manifestJson: string): Promise<NodeSpec> => {
      const manifest = parseGpuScriptManifestJson(manifestJson);
      if (!manifest) throw new Error('Invalid manifest');
      const spec = buildGpuScriptNodeSpec({ ...manifest, id: nodeId });
      return spec;
    },

    getGroupInternalGraph: async (groupNodeId: string): Promise<GroupInternalGraph> => {
      let graph = groupGraphs.get(groupNodeId);
      if (!graph) {
        graph = {
          groupDefId: 'group::test',
          name: 'Test Group',
          nodes: [],
          connections: [],
          inputs: [],
          outputs: [],
        };
        groupGraphs.set(groupNodeId, graph);
      }
      return graph;
    },

    addInternalNode: async (groupDefId: string, typeId: string, x: number, y: number): Promise<InternalGraphNode> => {
      let graph = Array.from(groupGraphs.values()).find(item => item.groupDefId === groupDefId);
      if (!graph) {
        graph = { groupDefId, name: 'Test Group', nodes: [], connections: [], inputs: [], outputs: [] };
        groupGraphs.set('group-node', graph);
      }
      const id = `internal-${++nodeCounter}`;
      const actualTypeId = typeId === 'gpu_script' ? `gpu_script::mock_${nodeCounter}` : typeId;
      const spec = NODE_SPECS.find(s => s.id === typeId || s.id === actualTypeId);
      const params: Record<string, ParamValue> = {};
      if (spec) {
        for (const p of spec.params) params[p.key] = p.default;
      }
      const node: InternalGraphNode = {
        id,
        typeId: actualTypeId,
        position: { x, y },
        params,
        inputDefaults: {},
        muted: false,
      };
      graph.nodes.push(node);
      return node;
    },

    removeInternalNode: async (groupDefId: string, nodeId: string): Promise<NodeSpec> => {
      const graph = Array.from(groupGraphs.values()).find(item => item.groupDefId === groupDefId);
      if (graph) {
        graph.nodes = graph.nodes.filter(node => node.id !== nodeId);
        graph.connections = graph.connections.filter(conn => conn.fromNode !== nodeId && conn.toNode !== nodeId);
      }
      return NODE_SPECS[0];
    },

    setInternalParam: async (groupDefId: string, nodeId: string, key: string, value: ParamValue): Promise<NodeSpec> => {
      const graph = Array.from(groupGraphs.values()).find(item => item.groupDefId === groupDefId);
      const node = graph?.nodes.find(item => item.id === nodeId);
      if (node) node.params = { ...node.params, [key]: value };
      return NODE_SPECS[0];
    },

    setInternalInputDefault: async (groupDefId: string, nodeId: string, portName: string, value: ParamValue): Promise<NodeSpec> => {
      const graph = Array.from(groupGraphs.values()).find(item => item.groupDefId === groupDefId);
      const node = graph?.nodes.find(item => item.id === nodeId);
      if (node) node.inputDefaults = { ...node.inputDefaults, [portName]: value };
      return NODE_SPECS[0];
    },

    setInternalPosition: async (groupDefId: string, nodeId: string, x: number, y: number): Promise<NodeSpec> => {
      const graph = Array.from(groupGraphs.values()).find(item => item.groupDefId === groupDefId);
      const node = graph?.nodes.find(item => item.id === nodeId);
      if (node) node.position = { x, y };
      return NODE_SPECS[0];
    },

    setInternalMuted: async (groupDefId: string, nodeId: string, muted: boolean): Promise<NodeSpec> => {
      const graph = Array.from(groupGraphs.values()).find(item => item.groupDefId === groupDefId);
      const node = graph?.nodes.find(item => item.id === nodeId);
      if (node) node.muted = muted;
      return NODE_SPECS[0];
    },

    getNodeSpec: async (nodeId: string): Promise<NodeSpec> => {
      const node = nodes.get(nodeId);
      if (!node) throw new Error('Node not found');
      if (node.typeId.startsWith('gpu_script::')) {
        const manifestValue = node.params.__script_manifest;
        const manifestJson = manifestValue && 'String' in manifestValue ? manifestValue.String : null;
        const manifest = parseGpuScriptManifestJson(manifestJson) ?? buildDefaultGpuScriptManifest(node.typeId);
        return buildGpuScriptNodeSpec({ ...manifest, id: node.typeId });
      }
      const spec = NODE_SPECS.find(s => s.id === node.typeId);
      if (!spec) throw new Error(`Unknown node type: ${node.typeId}`);
      return spec;
    },

    loadImageData: (nodeId: string, data: Uint8Array): NodeInterfaceChange => {
      imageDataStore.set(nodeId, data);
      const spec = NODE_SPECS.find(s => s.id === 'load_image');
      return {
        newSpec: spec ?? NODE_SPECS[0],
        removedOutputPorts: [],
        prunedConnections: [],
      };
    },

    loadImagePath: (nodeId: string, path: string): NodeInterfaceChange => {
      imageDataStore.set(nodeId, new TextEncoder().encode(path));
      const spec = NODE_SPECS.find(s => s.id === 'load_image');
      return {
        newSpec: spec ?? NODE_SPECS[0],
        removedOutputPorts: [],
        prunedConnections: [],
      };
    },

    getImageData: (nodeId: string): Uint8Array | null => {
      return imageDataStore.get(nodeId) ?? null;
    },

    renderViewer: (viewerNodeId: string, _frame: number): ViewerResult | null => {
      renderCalls.push(viewerNodeId);
      return renderResult;
    },

    exportGraph: () => graphState,

    importGraph: (data: unknown) => {
      graphState = data;
      nodes.clear();
      connections.length = 0;
    },

    exportImage: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),

    setAiApiKey: async () => {},
    isAiConfigured: () => true,
    runAiNode: async () => {},
    getNodeExecutionState: () => ({ status: 'idle', isStale: false, error: '' }),

    getAffectedViewers: (nodeId: string): string[] => {
      // Walk downstream from nodeId through connections, collect viewer/export nodes
      const visited = new Set<string>();
      const queue = [nodeId];
      const viewers: string[] = [];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        const node = nodes.get(current);
        if (node && ['viewer', 'export_image', 'export_image_sequence', 'export_video', 'export_image_batch'].includes(node.typeId)) {
          viewers.push(current);
        }
        for (const conn of connections) {
          if (conn.fromNode === current && !visited.has(conn.toNode)) {
            queue.push(conn.toNode);
          }
        }
      }
      return viewers;
    },
  };
}

export function resetNodeCounter() {
  nodeCounter = 0;
}

export { NODE_SPECS };
