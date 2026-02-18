import type { EngineBridge, AddNodeResult } from '../engine/bridge';
import type { NodeSpec, ParamValue, RenderResult } from '../store/types';

const NODE_SPECS: NodeSpec[] = [
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
    id: 'brightness_contrast',
    display_name: 'Brightness/Contrast',
    category: 'Color',
    description: 'Adjust brightness and contrast',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: [
      {
        key: 'brightness',
        label: 'Brightness',
        ty: 'Float',
        default: { Float: 0.0 },
        min: -1.0,
        max: 1.0,
        step: 0.01,
        ui_hint: { type: 'Slider' },
        promotable: true,
      },
      {
        key: 'contrast',
        label: 'Contrast',
        ty: 'Float',
        default: { Float: 0.0 },
        min: -1.0,
        max: 1.0,
        step: 0.01,
        ui_hint: { type: 'Slider' },
        promotable: true,
      },
    ],
  },
  {
    id: 'invert',
    display_name: 'Invert',
    category: 'Color',
    description: 'Invert colors',
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
];

let nodeCounter = 0;

export function createMockEngine(): EngineBridge & {
  _nodes: Map<string, { typeId: string; params: Record<string, ParamValue> }>;
  _connections: Array<{ fromNode: string; fromPort: string; toNode: string; toPort: string }>;
  _graphState: unknown;
  _renderResult: RenderResult | null;
  _setRenderResult: (r: RenderResult | null) => void;
} {
  const nodes = new Map<string, { typeId: string; params: Record<string, ParamValue> }>();
  const connections: Array<{ fromNode: string; fromPort: string; toNode: string; toPort: string }> = [];
  const imageDataStore = new Map<string, Uint8Array>();
  let graphState: unknown = { nodes: [], connections: [] };
  let renderResult: RenderResult | null = null;

  return {
    _nodes: nodes,
    _connections: connections,
    _graphState: graphState,
    _renderResult: renderResult,
    _setRenderResult: (r: RenderResult | null) => { renderResult = r; },

    listNodeTypes: () => NODE_SPECS,

    addNode: (typeId: string, _x: number, _y: number): AddNodeResult => {
      const id = `node-${++nodeCounter}`;
      const spec = NODE_SPECS.find(s => s.id === typeId);
      const params: Record<string, ParamValue> = {};
      if (spec) {
        for (const p of spec.params) {
          params[p.key] = p.default;
        }
      }
      nodes.set(id, { typeId, params });
      return { id, typeId };
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

    loadImageData: (nodeId: string, data: Uint8Array) => {
      imageDataStore.set(nodeId, data);
    },

    getImageData: (nodeId: string): Uint8Array | null => {
      return imageDataStore.get(nodeId) ?? null;
    },

    renderViewer: (_viewerNodeId: string, _frame: number): RenderResult | null => {
      return renderResult;
    },

    exportGraph: () => graphState,

    importGraph: (data: unknown) => {
      graphState = data;
      nodes.clear();
      connections.length = 0;
    },

    exportImage: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  };
}

export function resetNodeCounter() {
  nodeCounter = 0;
}

export { NODE_SPECS };
