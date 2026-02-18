import type { NodeSpec, ParamValue, RenderResult, NodeInstance, Connection } from '../store/types';
import type { EngineBridge, AddNodeResult } from './bridge';

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
      }
    ]
  },
  {
    id: 'viewer',
    display_name: 'Viewer',
    category: 'Output',
    description: 'View the result',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [{ name: 'display', label: 'Display', ty: 'Image' }],
    params: []
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
      }
    ]
  },
  {
    id: 'hue_saturation',
    display_name: 'Hue/Saturation',
    category: 'Color',
    description: 'Adjust hue and saturation',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: [
      {
        key: 'hue',
        label: 'Hue',
        ty: 'Float',
        default: { Float: 0.0 },
        min: -180.0,
        max: 180.0,
        step: 1.0,
        ui_hint: { type: 'Slider' },
        promotable: true,
      },
      {
        key: 'saturation',
        label: 'Saturation',
        ty: 'Float',
        default: { Float: 0.0 },
        min: -1.0,
        max: 1.0,
        step: 0.01,
        ui_hint: { type: 'Slider' },
        promotable: true,
      }
    ]
  },
  {
    id: 'invert',
    display_name: 'Invert',
    category: 'Color',
    description: 'Invert colors',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: []
  },
   {
     id: 'gaussian_blur',
     display_name: 'Gaussian Blur',
     category: 'Filter',
     description: 'Blur the image',
     inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
     outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
     params: [
       {
         key: 'sigma',
         label: 'Sigma',
         ty: 'Float',
         default: { Float: 1.0 },
         min: 0.1,
         max: 100.0,
         step: 0.1,
         ui_hint: { type: 'Slider' },
         promotable: true,
       }
     ]
   },
   {
     id: 'separate_hsva',
     display_name: 'Separate HSVA',
     category: 'Color',
     description: 'Separate image into HSVA channels',
     inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
     outputs: [
       { name: 'hue', label: 'Hue', ty: 'Image' },
       { name: 'saturation', label: 'Saturation', ty: 'Image' },
       { name: 'value', label: 'Value', ty: 'Image' },
       { name: 'alpha', label: 'Alpha', ty: 'Image' }
     ],
     params: []
   },
   {
     id: 'combine_hsva',
     display_name: 'Combine HSVA',
     category: 'Color',
     description: 'Combine HSVA channels into an image',
     inputs: [
       { name: 'hue', label: 'Hue', ty: 'Image' },
       { name: 'saturation', label: 'Saturation', ty: 'Image' },
       { name: 'value', label: 'Value', ty: 'Image' },
       { name: 'alpha', label: 'Alpha', ty: 'Image' }
     ],
     outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
     params: []
   },
   {
     id: 'map_range',
     display_name: 'Map Range',
     category: 'Utility',
     description: 'Map values from one range to another',
     inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
     outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
     params: [
       {
         key: 'from_min',
         label: 'From Min',
         ty: 'Float',
         default: { Float: 0.0 },
         min: 0.0,
         max: 1.0,
         step: 0.01,
         ui_hint: { type: 'Slider' },
         promotable: true,
       },
       {
         key: 'from_max',
         label: 'From Max',
         ty: 'Float',
         default: { Float: 1.0 },
         min: 0.0,
         max: 1.0,
         step: 0.01,
         ui_hint: { type: 'Slider' },
         promotable: true,
       },
       {
         key: 'to_min',
         label: 'To Min',
         ty: 'Float',
         default: { Float: 0.0 },
         min: 0.0,
         max: 1.0,
         step: 0.01,
         ui_hint: { type: 'Slider' },
         promotable: true,
       },
       {
         key: 'to_max',
         label: 'To Max',
         ty: 'Float',
         default: { Float: 1.0 },
         min: 0.0,
         max: 1.0,
         step: 0.01,
         ui_hint: { type: 'Slider' },
         promotable: true,
       },
       {
         key: 'clamp',
         label: 'Clamp',
         ty: 'Bool',
         default: { Bool: false },
         ui_hint: { type: 'Checkbox' },
         promotable: true,
       }
     ]
   },
   {
     id: 'math',
     display_name: 'Math',
     category: 'Utility',
     description: 'Apply mathematical operations',
     inputs: [
       { name: 'a', label: 'A', ty: 'Image' },
       { name: 'b', label: 'B', ty: 'Image' }
     ],
     outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
     params: [
       {
         key: 'operation',
         label: 'Operation',
         ty: 'Int',
         default: { Int: 0 },
         ui_hint: { type: 'Dropdown', data: ['Add', 'Subtract', 'Multiply', 'Divide', 'Power', 'Min', 'Max', 'Average', 'Difference', 'Screen', 'Overlay', 'Soft Light', 'Hard Light', 'Dodge'] },
         promotable: true,
       },
       {
         key: 'value',
         label: 'Value',
         ty: 'Float',
         default: { Float: 0.0 },
         min: -10.0,
         max: 10.0,
         step: 0.01,
         ui_hint: { type: 'Slider' },
         promotable: true,
       },
       {
         key: 'clamp_result',
         label: 'Clamp Result',
         ty: 'Bool',
         default: { Bool: true },
         ui_hint: { type: 'Checkbox' },
         promotable: true,
       }
     ]
   },
   {
     id: 'color_ramp',
     display_name: 'Color Ramp',
     category: 'Color',
     description: 'Map luminance through a color ramp',
     inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
     outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
     params: [
       {
         key: 'stops',
         label: 'Color Ramp',
         ty: 'Float',
         default: { ColorRamp: [
           { position: 0, color: [0, 0, 0, 1] },
           { position: 1, color: [1, 1, 1, 1] }
         ]},
         ui_hint: { type: 'ColorRamp' },
         promotable: true,
       },
       {
         key: 'interpolation',
         label: 'Interpolation',
         ty: 'Int',
         default: { Int: 0 },
         min: 0,
         max: 1,
         step: 1,
         ui_hint: { type: 'Dropdown', data: ['Linear', 'Constant'] },
         promotable: true,
       }
     ]
   },
   {
     id: 'group::color_range',
     display_name: 'Color Range',
     category: 'Matte',
     description: 'Select colors within a range',
     inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
     outputs: [{ name: 'mask', label: 'Mask', ty: 'Image' }],
     params: [
       {
         key: 'hue_min',
         label: 'Hue Min',
         ty: 'Float',
         default: { Float: 0.0 },
         min: 0.0,
         max: 1.0,
         step: 0.01,
         ui_hint: { type: 'Slider' },
         promotable: true,
       },
       {
         key: 'hue_max',
         label: 'Hue Max',
         ty: 'Float',
         default: { Float: 1.0 },
         min: 0.0,
         max: 1.0,
         step: 0.01,
         ui_hint: { type: 'Slider' },
         promotable: true,
       },
       {
         key: 'sat_min',
         label: 'Saturation Min',
         ty: 'Float',
         default: { Float: 0.0 },
         min: 0.0,
         max: 1.0,
         step: 0.01,
         ui_hint: { type: 'Slider' },
         promotable: true,
       },
       {
         key: 'val_min',
         label: 'Value Min',
         ty: 'Float',
         default: { Float: 0.0 },
         min: 0.0,
         max: 1.0,
         step: 0.01,
         ui_hint: { type: 'Slider' },
         promotable: true,
       }
     ]
   }
 ];

export class MockEngine implements EngineBridge {
  private nodes: Map<string, NodeInstance> = new Map();
  private connections: Map<string, Connection> = new Map();

  listNodeTypes(): NodeSpec[] {
    return NODE_SPECS;
  }

  addNode(typeId: string, x: number, y: number): AddNodeResult {
    const id = crypto.randomUUID();
    const spec = NODE_SPECS.find(n => n.id === typeId);
    if (!spec) throw new Error(`Unknown node type: ${typeId}`);

    const params: Record<string, ParamValue> = {};
    for (const p of spec.params) {
      params[p.key] = p.default;
    }

    this.nodes.set(id, {
      id,
      typeId,
      params,
      inputDefaults: {},
      position: { x, y },
      muted: false,
    });
    return { id, typeId };
  }

  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    
    for (const [id, conn] of this.connections) {
      if (conn.fromNode === nodeId || conn.toNode === nodeId) {
        this.connections.delete(id);
      }
    }
  }

  connect(fromNode: string, fromPort: string, toNode: string, toPort: string): void {
    const id = crypto.randomUUID();
    this.connections.set(id, { id, fromNode, fromPort, toNode, toPort });
  }

  disconnect(toNode: string, toPort: string): void {
     
     for (const [id, conn] of this.connections) {
       if (conn.toNode === toNode && conn.toPort === toPort) {
         this.connections.delete(id);
         return;
       }
     }
  }

  setParam(nodeId: string, key: string, value: ParamValue): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.params[key] = value;
    }
  }

  setInputDefault(nodeId: string, portName: string, value: ParamValue): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.inputDefaults[portName] = value;
    }
  }

  setPosition(nodeId: string, x: number, y: number): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.position = { x, y };
    }
  }

  setMuted(_nodeId: string, _muted: boolean): void {
    // No-op in mock engine
  }

  loadImageData(nodeId: string, _data: Uint8Array): void {
    console.log(`Loading image data for node ${nodeId}`);
  }

  renderViewer(viewerNodeId: string, _frame: number): RenderResult | null {
    const width = 200;
    const height = 150;
    const pixels = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        pixels[i] = (x / width) * 255;
        pixels[i + 1] = (y / height) * 255;
        pixels[i + 2] = 128;
        pixels[i + 3] = 255;
      }
    }

    return {
      nodeId: viewerNodeId,
      width,
      height,
      pixels,
    };
  }

  exportGraph(): unknown {
    return { nodes: [], connections: [] };
  }

  importGraph(_data: unknown): void {
    this.nodes.clear();
    this.connections.clear();
  }

  async exportImage(_nodeId: string, _frame: number): Promise<Uint8Array> {
    return new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  }

  setAiApiKey(_provider: string, _key: string): void {
  }

  isAiConfigured(): boolean {
    return false;
  }

  setProjectFormat(_width: number, _height: number): void {
  }
}

export const mockEngine = new MockEngine();
