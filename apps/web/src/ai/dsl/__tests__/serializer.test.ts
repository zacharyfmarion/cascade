import { describe, it, expect } from 'vitest';
import { serializeGraph, serializeCustomDefinition, type SerializerInput } from '../serializer';
import { HandleMap } from '../handleMap';
import type { Connection, NodeInstance, NodeSpec, SerializableGroupDefinition } from '../../../store/types';
import type {
  DslConnection,
  DslGroupDefinition,
  DslGpuDefinition,
  DslNode,
  DslParamDeclaration,
  DslParamValue,
  DslPortDeclaration,
} from '../types';
import { makeNodeInstance, mockSpecs } from './helpers';
import { buildDefaultGpuScriptManifest, buildGpuScriptManifest, buildGpuScriptNodeSpec } from '../../gpuScript';

const buildInput = (nodes: Map<string, NodeInstance>, connections: Connection[], handleMap = new HandleMap()): SerializerInput => ({
  nodes,
  connections,
  nodeSpecs: mockSpecs,
  handleMap,
});

const buildInputWithSpecs = (
  nodes: Map<string, NodeInstance>,
  connections: Connection[],
  nodeSpecs: SerializerInput['nodeSpecs'],
  handleMap = new HandleMap(),
): SerializerInput => ({
  nodes,
  connections,
  nodeSpecs,
  handleMap,
});

const graph = (lines: string[]): string =>
  `graph {\n${lines.map((line) => (line ? `  ${line}` : '')).join('\n')}\n}`;

const graphBodyLines = (output: string): string[] =>
  output.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== 'graph {' && line !== '}');

const loaderSpecs: NodeSpec[] = [
  ...mockSpecs,
  {
    id: 'load_image_sequence',
    display_name: 'Load Image Sequence',
    category: 'Input',
    description: 'Load an image sequence from a directory',
    inputs: [],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: [
      {
        key: 'directory',
        label: 'Directory',
        ty: 'String',
        default: { String: '' },
        ui_hint: { type: 'Hidden' },
        promotable: true,
      },
      {
        key: 'pattern',
        label: 'Pattern',
        ty: 'String',
        default: { String: 'frame_{frame}.png' },
        ui_hint: { type: 'Hidden' },
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
    params: [{
      key: 'file_path',
      label: 'File Path',
      ty: 'String',
      default: { String: '' },
      ui_hint: { type: 'Hidden' },
      promotable: false,
    }],
  },
  {
    id: 'load_image',
    display_name: 'Load Image',
    category: 'Input',
    description: 'Load an image or multi-layer EXR file',
    inputs: [],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: [{
      key: 'image_data',
      label: 'Image Data',
      ty: 'String',
      default: { String: '' },
      ui_hint: { type: 'Hidden' },
      promotable: true,
    }],
  },
];

const glowSpec: NodeSpec = {
  id: 'gpu_kernel::glow',
  display_name: 'Glow',
  category: 'GPU',
  description: 'Adds glow',
  inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  params: [
    {
      key: 'threshold',
      label: 'Threshold',
      ty: 'Float',
      default: { Float: 0.5 },
      min: 0,
      max: 1,
      step: 0.01,
      ui_hint: { type: 'Slider' },
      promotable: true,
    },
    {
      key: 'radius',
      label: 'Radius',
      ty: 'Float',
      default: { Float: 4 },
      min: 0,
      max: 64,
      step: 0.1,
      ui_hint: { type: 'Slider' },
      promotable: true,
    },
    {
      key: 'intensity',
      label: 'Intensity',
      ty: 'Float',
      default: { Float: 1 },
      min: 0,
      max: 4,
      step: 0.01,
      ui_hint: { type: 'Slider' },
      promotable: true,
    },
  ],
};

describe('serializeGraph', () => {
  it('serializes empty graph to empty string', () => {
    const input = buildInput(new Map(), []);
    expect(serializeGraph(input)).toBe('');
  });

  it('serializes single node without params', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-1', makeNodeInstance({ id: 'node-1', typeId: 'viewer' }));
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe(graph(['viewer1 = Viewer()']));
  });

  it('serializes runtime group definitions created from selected nodes', () => {
    const specs: NodeSpec[] = [
      ...mockSpecs,
      glowSpec,
      {
        id: 'group::user_123',
        display_name: 'Node Group',
        category: 'User',
        description: 'User-defined group',
        inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        params: [],
      },
    ];
    const nodes = new Map<string, NodeInstance>([
      ['load-node', makeNodeInstance({ id: 'load-node', typeId: 'load_image' })],
      ['group-node', makeNodeInstance({ id: 'group-node', typeId: 'group::user_123' })],
      ['viewer-node', makeNodeInstance({ id: 'viewer-node', typeId: 'viewer' })],
    ]);
    const connections: Connection[] = [
      { id: 'c1', fromNode: 'load-node', fromPort: 'image', toNode: 'group-node', toPort: 'image' },
      { id: 'c2', fromNode: 'group-node', fromPort: 'image', toNode: 'viewer-node', toPort: 'image' },
    ];
    const groupDefinition: SerializableGroupDefinition = {
      id: 'group::user_123',
      name: 'Node Group',
      category: 'User',
      description: 'User-defined group',
      internal_graph: {
        nodes: [
          { id: 'pixelate1', type_id: 'gpu_kernel::pixelate', params: { pixel_size: { Int: 2 } }, input_defaults: {}, position: [0, 0] },
          { id: 'glow1', type_id: 'gpu_kernel::glow', params: { threshold: { Float: 0.28 }, radius: { Float: 12 }, intensity: { Float: 0.62 } }, input_defaults: {}, position: [200, 0] },
          { id: 'gi', type_id: 'group_input', params: {}, input_defaults: {}, position: [-200, 0] },
          { id: 'go', type_id: 'group_output', params: {}, input_defaults: {}, position: [400, 0] },
        ],
        connections: [
          { from_node: 'gi', from_port: 'image', to_node: 'pixelate1', to_port: 'image' },
          { from_node: 'pixelate1', from_port: 'image', to_node: 'glow1', to_port: 'image' },
          { from_node: 'glow1', from_port: 'image', to_node: 'go', to_port: 'image' },
        ],
      },
      promotions: [],
      is_builtin: false,
      explicit_inputs: null,
      explicit_outputs: null,
    };

    const output = serializeGraph({
      nodes,
      connections,
      nodeSpecs: specs,
      handleMap: new HandleMap(),
      groupDefinitions: [groupDefinition],
    });

    expect(output).toContain('node NodeGroup = group {');
    expect(output).toContain('inputs {\n    image image\n  }');
    expect(output).toContain('outputs {\n    image image\n  }');
    expect(output).toContain('pixelate1 = Pixelate(pixel_size: 2)');
    expect(output).toContain('glow1 = Glow(threshold: 0.28, radius: 12.0, intensity: 0.62)');
    expect(output).toContain('input.image -> pixelate1.image');
    expect(output).toContain('glow1.image -> output.image');
    expect(output).toContain('node_group1 = NodeGroup()');
    expect(output).not.toContain('User123');
  });

  it('uses shadow names for nested runtime groups inside group definitions', () => {
    const specs: NodeSpec[] = [
      ...mockSpecs,
      {
        id: 'group::child',
        display_name: 'Child Group',
        category: 'User',
        description: 'Nested child',
        inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        params: [],
      },
      {
        id: 'group::parent',
        display_name: 'Parent Group',
        category: 'User',
        description: 'Nested parent',
        inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        params: [],
      },
    ];
    const nodes = new Map<string, NodeInstance>([
      ['parent-node', makeNodeInstance({ id: 'parent-node', typeId: 'group::parent' })],
    ]);
    const childDefinition: SerializableGroupDefinition = {
      id: 'group::child',
      name: 'Child Group',
      category: 'User',
      description: 'Nested child',
      internal_graph: {
        nodes: [
          { id: 'curves1', type_id: 'curves', params: {}, input_defaults: {}, position: [0, 0] },
          { id: 'input', type_id: 'group_input', params: {}, input_defaults: {}, position: [0, 0] },
          { id: 'output', type_id: 'group_output', params: {}, input_defaults: {}, position: [0, 0] },
        ],
        connections: [
          { from_node: 'input', from_port: 'image', to_node: 'curves1', to_port: 'image' },
          { from_node: 'curves1', from_port: 'image', to_node: 'output', to_port: 'image' },
        ],
      },
      promotions: [],
      is_builtin: false,
      explicit_inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      explicit_outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    };
    const parentDefinition: SerializableGroupDefinition = {
      id: 'group::parent',
      name: 'Parent Group',
      category: 'User',
      description: 'Nested parent',
      internal_graph: {
        nodes: [
          { id: 'child-node', type_id: 'group::child', params: {}, input_defaults: {}, position: [0, 0] },
          { id: 'input', type_id: 'group_input', params: {}, input_defaults: {}, position: [0, 0] },
          { id: 'output', type_id: 'group_output', params: {}, input_defaults: {}, position: [0, 0] },
        ],
        connections: [
          { from_node: 'input', from_port: 'image', to_node: 'child-node', to_port: 'image' },
          { from_node: 'child-node', from_port: 'image', to_node: 'output', to_port: 'image' },
        ],
      },
      promotions: [],
      is_builtin: false,
      explicit_inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      explicit_outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    };

    const output = serializeGraph({
      nodes,
      connections: [],
      nodeSpecs: specs,
      handleMap: new HandleMap(),
      groupDefinitions: [childDefinition, parentDefinition],
      customDefinitionNames: [
        { runtimeId: 'group::child', name: 'CurvesGroup' },
        { runtimeId: 'group::parent', name: 'CloudyAdjustment' },
      ],
      pruneUnusedCustomDefinitions: true,
    });

    expect(output).toContain('node CurvesGroup = group {');
    expect(output).toContain('node CloudyAdjustment = group {');
    expect(output).toContain('child1 = CurvesGroup()');
    expect(output).toContain('cloudy_adjustment1 = CloudyAdjustment()');
  });

  it('serializes load image paths as inline asset constructors', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-1', makeNodeInstance({
      id: 'node-1',
      typeId: 'load_image',
      params: { path: { String: 'file:///plate.exr' } },
    }));
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe(graph(['load1 = LoadImage(path: image("file:///plate.exr"))']));
  });

  it('omits embedded web image data from load image DSL', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-1', makeNodeInstance({
      id: 'node-1',
      typeId: 'load_image',
      params: { image_data: { String: '<embedded bytes>' } },
    }));
    const output = serializeGraph(buildInputWithSpecs(nodes, [], loaderSpecs));
    expect(output).toBe(graph(['load1 = LoadImage()']));
  });

  it('serializes virtual load image path when the runtime spec only exposes image_data', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-1', makeNodeInstance({
      id: 'node-1',
      typeId: 'load_image',
      params: {
        image_data: { String: '<embedded bytes>' },
        path: { String: 'file:///Users/test/plate.png' },
      },
    }));
    const output = serializeGraph(buildInputWithSpecs(nodes, [], loaderSpecs));
    expect(output).toBe(graph(['load1 = LoadImage(path: image("file:///Users/test/plate.png"))']));
  });

  it('omits in-memory sequence pattern without a resolvable directory', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-1', makeNodeInstance({
      id: 'node-1',
      typeId: 'load_image_sequence',
      params: { pattern: { String: '00032_{frame}.png' } },
    }));
    const output = serializeGraph(buildInputWithSpecs(nodes, [], loaderSpecs));
    expect(output).toBe(graph(['seq1 = LoadImageSequence()']));
  });

  it('serializes sequence directories and patterns when the source is resolvable', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-1', makeNodeInstance({
      id: 'node-1',
      typeId: 'load_image_sequence',
      params: {
        directory: { String: 'file:///shots/a' },
        pattern: { String: 'plate_{frame}.exr' },
      },
    }));
    const output = serializeGraph(buildInputWithSpecs(nodes, [], loaderSpecs));
    expect(output).toBe(graph(['seq1 = LoadImageSequence(directory: sequence("file:///shots/a"), pattern: "plate_{frame}.exr")']));
  });

  it('serializes load video file paths as inline asset constructors', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-1', makeNodeInstance({
      id: 'node-1',
      typeId: 'load_video',
      params: { file_path: { String: 'file:///ref.mov' } },
    }));
    const output = serializeGraph(buildInputWithSpecs(nodes, [], loaderSpecs));
    expect(output).toBe(graph(['load1 = LoadVideo(file_path: video("file:///ref.mov"))']));
  });

  it('serializes single node with non-default param', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'gaussian_blur',
        params: { amount: { Float: 5.0 } },
        inputDefaults: { amount: { Float: 5.0 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe(graph(['blur1 = GaussianBlur(amount: 5.0)']));
  });

  it('serializes connectable params from node params when no input default is present', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'gaussian_blur',
        params: { amount: { Float: 2.0 } },
        inputDefaults: {},
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe(graph(['blur1 = GaussianBlur(amount: 2.0)']));
  });

  it('omits params when value matches default', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'gaussian_blur',
        params: { amount: { Float: 0.5 } },
        inputDefaults: { amount: { Float: 0.5 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe(graph(['blur1 = GaussianBlur()']));
  });

  it('serializes muted nodes with prefix', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'gaussian_blur',
        muted: true,
        params: { amount: { Float: 5.0 } },
        inputDefaults: { amount: { Float: 5.0 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe(graph(['blur1 = muted(GaussianBlur(amount: 5.0))']));
  });

  it('serializes connections in correct format', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('load', makeNodeInstance({ id: 'load', typeId: 'load_image' }));
    nodes.set('blur', makeNodeInstance({ id: 'blur', typeId: 'gaussian_blur' }));
    const connections: Connection[] = [
      { id: 'c1', fromNode: 'load', fromPort: 'image', toNode: 'blur', toPort: 'image' },
    ];
    const output = serializeGraph(buildInput(nodes, connections));
    expect(output).toBe(graph(['load1 = LoadImage()', 'blur1 = GaussianBlur()', '', 'load1.image -> blur1.image']));
  });

  it('sorts connections deterministically by toHandle|toPort', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-load', makeNodeInstance({ id: 'node-load', typeId: 'load_image' }));
    nodes.set('node-blur', makeNodeInstance({ id: 'node-blur', typeId: 'gaussian_blur' }));
    nodes.set('node-blend', makeNodeInstance({ id: 'node-blend', typeId: 'blend' }));
    const handleMap = new HandleMap();
    handleMap.set('load1', 'node-load');
    handleMap.set('blur1', 'node-blur');
    handleMap.set('blend1', 'node-blend');

    const connections: Connection[] = [
      { id: 'c1', fromNode: 'node-load', fromPort: 'image', toNode: 'node-blend', toPort: 'overlay' },
      { id: 'c2', fromNode: 'node-load', fromPort: 'image', toNode: 'node-blur', toPort: 'image' },
      { id: 'c3', fromNode: 'node-load', fromPort: 'image', toNode: 'node-blend', toPort: 'base' },
    ];
    const output = serializeGraph(buildInput(nodes, connections, handleMap));
    const lines = output.split('\n').map((line) => line.trim()).filter((line) => line.includes('->'));
    expect(lines).toEqual([
      'load1.image -> blend1.base',
      'load1.image -> blend1.overlay',
      'load1.image -> blur1.image',
    ]);
  });

  it('orders nodes topologically with sources before sinks', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('load', makeNodeInstance({ id: 'load', typeId: 'load_image' }));
    nodes.set('blur', makeNodeInstance({ id: 'blur', typeId: 'gaussian_blur' }));
    nodes.set('viewer', makeNodeInstance({ id: 'viewer', typeId: 'viewer' }));
    const connections: Connection[] = [
      { id: 'c1', fromNode: 'load', fromPort: 'image', toNode: 'blur', toPort: 'image' },
      { id: 'c2', fromNode: 'blur', fromPort: 'image', toNode: 'viewer', toPort: 'image' },
    ];
    const output = serializeGraph(buildInput(nodes, connections));
    const nodeLines = graphBodyLines(output).filter((line) => line.includes('='));
    expect(nodeLines).toEqual(['load1 = LoadImage()', 'blur1 = GaussianBlur()', 'viewer1 = Viewer()']);
  });

  it('assigns unique handles for multiple nodes of same type', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('blur-a', makeNodeInstance({ id: 'blur-a', typeId: 'gaussian_blur' }));
    nodes.set('blur-b', makeNodeInstance({ id: 'blur-b', typeId: 'gaussian_blur' }));
    const output = serializeGraph(buildInput(nodes, []));
    expect(graphBodyLines(output)).toEqual(['blur1 = GaussianBlur()', 'blur2 = GaussianBlur()']);
  });

  it('uses inputDefaults for promotable params', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'gaussian_blur',
        params: { amount: { Float: 0.9 } },
        inputDefaults: { amount: { Float: 0.25 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe(graph(['blur1 = GaussianBlur(amount: 0.25)']));
  });

  it('serializes scalar input defaults from node inputs', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'math-node',
      makeNodeInstance({
        id: 'math-node',
        typeId: 'math',
        params: { operation: { Int: 2 } },
        inputDefaults: { a: { Float: 3 }, b: { Float: 7 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe(graph(['math1 = Math(a: 3.0, b: 7.0, operation: "multiply")']));
  });

  it('omits scalar input defaults that match port defaults', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'math-node',
      makeNodeInstance({
        id: 'math-node',
        typeId: 'math',
        inputDefaults: { a: { Float: 0 }, b: { Float: 0 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe(graph(['math1 = Math()']));
  });

  it('omits scalar input defaults for connected inputs', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('load-node', makeNodeInstance({ id: 'load-node', typeId: 'load_image' }));
    nodes.set(
      'math-node',
      makeNodeInstance({
        id: 'math-node',
        typeId: 'math',
        inputDefaults: { a: { Float: 3 }, b: { Float: 7 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, [
      { id: 'c1', fromNode: 'load-node', fromPort: 'image', toNode: 'math-node', toPort: 'a' },
    ]));
    expect(output).toBe(graph([
      'load1 = LoadImage()',
      'math1 = Math(b: 7.0)',
      '',
      'load1.image -> math1.a',
    ]));
  });

  it('prefixes input defaults when an input collides with a param name', () => {
    const collisionSpec: NodeSpec = {
      id: 'collision_node',
      display_name: 'Collision Node',
      category: 'Utility',
      description: 'Has a param and input with the same name',
      inputs: [{ name: 'amount', label: 'Amount Input', ty: 'Float', default: { Float: 0 } }],
      outputs: [],
      params: [{
        key: 'amount',
        label: 'Amount Param',
        ty: 'Float',
        default: { Float: 1 },
        ui_hint: { type: 'NumberInput' },
        promotable: false,
      }],
    };
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'collision-node',
      makeNodeInstance({
        id: 'collision-node',
        typeId: 'collision_node',
        params: { amount: { Float: 2 } },
        inputDefaults: { amount: { Float: 3 } },
      })
    );
    const output = serializeGraph(buildInputWithSpecs(nodes, [], [...mockSpecs, collisionSpec]));
    expect(output).toBe(graph(['collision1 = CollisionNode(input.amount: 3.0, amount: 2.0)']));
  });

  it('does not duplicate input defaults for all_inputs param mirrors', () => {
    const differenceMatteSpec: NodeSpec = {
      id: 'gpu_kernel::difference_matte',
      display_name: 'Difference Matte',
      category: 'Matte',
      description: 'Generate matte from difference between footage and clean plate',
      inputs: [
        { name: 'image', label: 'Image', ty: 'Image' },
        { name: 'clean_plate', label: 'Clean Plate', ty: 'Image' },
        {
          name: 'tolerance',
          label: 'Tolerance',
          ty: 'Float',
          default: { Float: 0.1 },
          min: 0,
          max: 1,
          step: 0.01,
          ui_hint: { type: 'Slider' },
        },
        {
          name: 'softness',
          label: 'Softness',
          ty: 'Float',
          default: { Float: 0.1 },
          min: 0,
          max: 1,
          step: 0.01,
          ui_hint: { type: 'Slider' },
        },
      ],
      outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      params: [
        {
          key: 'tolerance',
          label: 'Tolerance',
          ty: 'Float',
          default: { Float: 0.1 },
          min: 0,
          max: 1,
          step: 0.01,
          ui_hint: { type: 'Slider' },
          promotable: true,
        },
        {
          key: 'softness',
          label: 'Softness',
          ty: 'Float',
          default: { Float: 0.1 },
          min: 0,
          max: 1,
          step: 0.01,
          ui_hint: { type: 'Slider' },
          promotable: true,
        },
      ],
    };
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'difference-node',
      makeNodeInstance({
        id: 'difference-node',
        typeId: 'gpu_kernel::difference_matte',
        params: { tolerance: { Float: 0.65 }, softness: { Float: 0.7 } },
        inputDefaults: { tolerance: { Float: 0.65 }, softness: { Float: 0.7 } },
      })
    );
    const output = serializeGraph(buildInputWithSpecs(nodes, [], [...mockSpecs, differenceMatteSpec]));
    expect(output).toBe(graph(['difference1 = DifferenceMatte(tolerance: 0.65, softness: 0.7)']));
    expect(output).not.toContain('input.tolerance');
    expect(output).not.toContain('input.softness');
  });

  it('does not add blank line when no connections', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'solid_color',
        params: { width: { Int: 1024 } },
        inputDefaults: { width: { Int: 1024 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output.includes('\n\n')).toBe(false);
    expect(output).toBe(graph(['solid1 = SolidColor(width: 1024)']));
  });

  it('formats floats with trailing .0', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'gaussian_blur',
        params: { amount: { Float: 5 } },
        inputDefaults: { amount: { Float: 5 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe(graph(['blur1 = GaussianBlur(amount: 5.0)']));
  });

  it('serializes palette param', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'color_palette',
        params: { colors: { ColorPalette: [[1, 0, 0, 1], [0, 1, 0, 1]] } },
      })
    );
    const handleMap = new HandleMap();
    handleMap.set('palette1', 'node-1');
    const output = serializeGraph(buildInput(nodes, [], handleMap));
    expect(output).toBe(graph(['palette1 = ColorPalette(colors: [rgba(1.0, 0.0, 0.0, 1.0), rgba(0.0, 1.0, 0.0, 1.0)])']));
  });

  it('serializes ramp param', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'color_ramp',
        params: {
          stops: { ColorRamp: [{ position: 0.25, color: [0, 0, 0, 1] }, { position: 0.75, color: [1, 1, 1, 1] }] },
        },
        inputDefaults: {
          stops: { ColorRamp: [{ position: 0.25, color: [0, 0, 0, 1] }, { position: 0.75, color: [1, 1, 1, 1] }] },
        },
      })
    );
    const handleMap = new HandleMap();
    handleMap.set('ramp1', 'node-1');
    const output = serializeGraph(buildInput(nodes, [], handleMap));
    expect(output).toBe(
      graph(['ramp1 = ColorRamp(stops: [0.25: rgba(0.0, 0.0, 0.0, 1.0), 0.75: rgba(1.0, 1.0, 1.0, 1.0)])'])
    );
  });

  it('serializes curve param', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'curves',
        params: { master_curve: { CurvePoints: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] } },
      })
    );
    const handleMap = new HandleMap();
    handleMap.set('curves1', 'node-1');
    const output = serializeGraph(buildInput(nodes, [], handleMap));
    expect(output).toBe(graph(['curves1 = Curves(master_curve: [(0.0, 0.0), (0.5, 0.7), (1.0, 1.0)])']));
  });

  it('omits palette param when value matches default', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'color_palette',
        params: { colors: { ColorPalette: [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]] } },
      })
    );
    const handleMap = new HandleMap();
    handleMap.set('palette1', 'node-1');
    const output = serializeGraph(buildInput(nodes, [], handleMap));
    expect(output).toBe(graph(['palette1 = ColorPalette()']));
  });

  it('serializes dropdown param as snake_case string', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'blend',
        params: { mode: { Int: 2 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe(graph(['blend1 = Blend(mode: "screen")']));
  });

  it('lifts unnamed gpu_script nodes to GpuNode{n} definitions', () => {
    // display_name defaults to "GPU Script" → falls back to GpuNode1
    const manifest = {
      ...buildDefaultGpuScriptManifest('gpu_script::demo'),
      kernel: 'float gain = 1.2;\nreturn vec4(color.rgb * gain, color.a);',
    };
    const specs = [...mockSpecs, buildGpuScriptNodeSpec(manifest)];
    const nodes = new Map<string, NodeInstance>();
    nodes.set('gpu-node', makeNodeInstance({
      id: 'gpu-node',
      typeId: 'gpu_script::demo',
      params: { __script_manifest: { String: JSON.stringify(manifest) } },
    }));

    const output = serializeGraph(buildInputWithSpecs(nodes, [], specs));
    expect(output).toContain('node GpuNode1 = gpu {');
    expect(output).toContain('code """');
    expect(output).toContain('float gain = 1.2;');
    expect(output).toContain('return vec4(color.rgb * gain, color.a);');
    // root graph: handle is 'gpu1', type is 'GpuNode1'
    expect(output).toContain('gpu1 = GpuNode1()');
    expect(output).not.toContain('GpuScript(');
    expect(output).not.toContain('script:');
  });

  it('uses display_name as definition name when set', () => {
    const manifest = {
      ...buildDefaultGpuScriptManifest('gpu_script::demo'),
      display_name: 'Film Glow',
      kernel: 'return color;',
    };
    const nodes = new Map<string, NodeInstance>();
    nodes.set('gpu-node', makeNodeInstance({
      id: 'gpu-node',
      typeId: 'gpu_script::demo',
      params: { __script_manifest: { String: JSON.stringify(manifest) } },
    }));

    const output = serializeGraph(buildInputWithSpecs(nodes, [], mockSpecs));
    expect(output).toContain('node FilmGlow = gpu {');
    expect(output).toContain('film_glow1 = FilmGlow()');
  });

  it('deduplicates gpu_script definition names across multiple instances with the same display name', () => {
    const manifestA = {
      ...buildDefaultGpuScriptManifest('gpu_script::demo-a'),
      display_name: 'Film Glow',
      kernel: 'return color;',
    };
    const manifestB = {
      ...buildDefaultGpuScriptManifest('gpu_script::demo-b'),
      display_name: 'Film Glow',
      kernel: 'return color * 2.0;',
    };
    const nodes = new Map<string, NodeInstance>();
    nodes.set('gpu-a', makeNodeInstance({
      id: 'gpu-a',
      typeId: 'gpu_script::demo-a',
      params: { __script_manifest: { String: JSON.stringify(manifestA) } },
    }));
    nodes.set('gpu-b', makeNodeInstance({
      id: 'gpu-b',
      typeId: 'gpu_script::demo-b',
      params: { __script_manifest: { String: JSON.stringify(manifestB) } },
    }));

    const output = serializeGraph(buildInputWithSpecs(nodes, [], mockSpecs));

    expect(output).toContain('node FilmGlow = gpu {');
    expect(output).toContain('node FilmGlow2 = gpu {');
    expect(output).toContain('film_glow1 = FilmGlow()');
    expect(output).toContain('film_glow2 = FilmGlow2()');
  });

  it('deduplicates gpu_script names against group definition names', () => {
    const manifest = {
      ...buildDefaultGpuScriptManifest('gpu_script::film-glow'),
      display_name: 'Film Glow',
      kernel: 'return color;',
    };
    const specs: NodeSpec[] = [
      ...mockSpecs,
      {
        id: 'group::film_glow',
        display_name: 'Film Glow',
        category: 'User',
        description: 'Imported group',
        inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        params: [],
      },
    ];
    const nodes = new Map<string, NodeInstance>([
      ['group-node', makeNodeInstance({ id: 'group-node', typeId: 'group::film_glow' })],
      ['gpu-node', makeNodeInstance({
        id: 'gpu-node',
        typeId: 'gpu_script::film-glow',
        params: { __script_manifest: { String: JSON.stringify(manifest) } },
      })],
    ]);
    const groupDefinition: SerializableGroupDefinition = {
      id: 'group::film_glow',
      name: 'Film Glow',
      category: 'User',
      description: 'Imported group',
      internal_graph: { nodes: [], connections: [] },
      promotions: [],
      is_builtin: false,
      explicit_inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      explicit_outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    };

    const output = serializeGraph({
      nodes,
      connections: [],
      nodeSpecs: specs,
      handleMap: new HandleMap(),
      groupDefinitions: [groupDefinition],
    });

    expect(output).toContain('node FilmGlow = group {');
    expect(output).toContain('node FilmGlow2 = gpu {');
    expect(output).toContain('film_glow1 = FilmGlow()');
    expect(output).toContain('film_glow2 = FilmGlow2()');
  });

  it('emits non-default scalar params for lifted gpu_script nodes', () => {
    const manifest = {
      ...buildGpuScriptManifest(
        'gpu_script::vignette',
        [
          { name: 'image', label: 'Image', ty: 'Image' },
          { name: 'strength', label: 'Strength', ty: 'Float', default: 0.5, min: 0, max: 2, step: 0.01 },
        ],
        [{ name: 'image', label: 'Image', ty: 'Image' }],
        [],
        'return color;',
      ),
      display_name: 'Vignette',
    };
    const nodes = new Map<string, NodeInstance>();
    nodes.set('vign-node', makeNodeInstance({
      id: 'vign-node',
      typeId: 'gpu_script::vignette',
      params: {
        __script_manifest: { String: JSON.stringify(manifest) },
        strength: { Float: 1.2 },
      },
    }));

    const output = serializeGraph(buildInputWithSpecs(nodes, [], mockSpecs));
    expect(output).toContain('node Vignette = gpu {');
    // non-default strength value appears in root graph
    expect(output).toContain('vignette1 = Vignette(strength: 1.2');
  });

  it('omits default scalar params for lifted gpu_script nodes', () => {
    const manifest = {
      ...buildGpuScriptManifest(
        'gpu_script::vignette',
        [
          { name: 'image', label: 'Image', ty: 'Image' },
          { name: 'strength', label: 'Strength', ty: 'Float', default: 0.5, min: 0, max: 2, step: 0.01 },
        ],
        [{ name: 'image', label: 'Image', ty: 'Image' }],
        [],
        'return color;',
      ),
      display_name: 'Vignette',
    };
    const nodes = new Map<string, NodeInstance>();
    nodes.set('vign-node', makeNodeInstance({
      id: 'vign-node',
      typeId: 'gpu_script::vignette',
      params: {
        __script_manifest: { String: JSON.stringify(manifest) },
        strength: { Float: 0.5 }, // same as default — omitted
      },
    }));

    const output = serializeGraph(buildInputWithSpecs(nodes, [], mockSpecs));
    expect(output).toContain('vignette1 = Vignette()');
  });

  it('serializes default dropdown value (omitted from output)', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'blend',
        params: { mode: { Int: 0 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe(graph(['blend1 = Blend()']));
  });

  it('serializes gradient dropdown as snake_case', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'gradient',
        params: { direction: { Int: 2 } },
        inputDefaults: { direction: { Int: 2 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe(graph(['gradient1 = Gradient(direction: "radial")']));
  });
});

// ---------------------------------------------------------------------------
// Custom definition serialization
// ---------------------------------------------------------------------------

const serPort = (valueType: string, name: string, optional = false, extras: Partial<DslPortDeclaration> = {}): DslPortDeclaration => ({
  valueType, name, optional, line: 1, ...extras,
});

const serParam = (valueType: string, name: string, defaultValue: DslParamValue, extras: Partial<DslParamDeclaration> = {}): DslParamDeclaration => ({
  valueType, name, defaultValue, line: 1, ...extras,
});

const serConn = (fromHandle: string, fromPort: string, toHandle: string, toPort: string): DslConnection => ({
  fromHandle, fromPort, toHandle, toPort, line: 1,
});

const serNode = (
  handle: string,
  nodeType: string,
  nodeTypeId: string,
  params?: Record<string, DslParamValue>,
  inputDefaults?: Record<string, DslParamValue>,
): DslNode => {
  const paramMap = new Map<string, DslParamValue>();
  if (params) for (const [k, v] of Object.entries(params)) paramMap.set(k, v);
  const inputDefaultMap = new Map<string, DslParamValue>();
  if (inputDefaults) for (const [k, v] of Object.entries(inputDefaults)) inputDefaultMap.set(k, v);
  return { handle, nodeType, nodeTypeId, params: paramMap, inputDefaults: inputDefaultMap, muted: false, line: 1 };
};

const minimalGpu = (): DslGpuDefinition => ({
  kind: 'gpu',
  name: 'FilmGlow',
  line: 1,
  inputs: [serPort('image', 'image')],
  outputs: [serPort('image', 'image')],
  code: 'return color;',
});

const minimalGroup = (): DslGroupDefinition => ({
  kind: 'group',
  name: 'SoftBlur',
  line: 1,
  inputs: [serPort('image', 'image')],
  outputs: [serPort('image', 'image')],
  params: [],
  graph: {
    nodes: new Map([['blur', serNode('blur', 'GaussianBlur', 'gaussian_blur')]]),
    connections: [
      serConn('input', 'image', 'blur', 'image'),
      serConn('blur', 'image', 'output', 'image'),
    ],
  },
});

describe('serializeCustomDefinition — GPU', () => {
  it('serializes a minimal GPU definition', () => {
    const output = serializeCustomDefinition(minimalGpu());
    expect(output).toContain('node FilmGlow = gpu {');
    expect(output).toContain('inputs {');
    expect(output).toContain('    image image');
    expect(output).toContain('outputs {');
    expect(output).toContain('code """');
    expect(output).toContain('return color;');
    expect(output).toContain('"""');
  });

  it('serializes optional mask port with ? suffix', () => {
    const def = { ...minimalGpu(), inputs: [serPort('image', 'image'), serPort('mask', 'matte', true)] };
    const output = serializeCustomDefinition(def);
    expect(output).toContain('mask matte?');
  });

  it('serializes scalar input with default value and min/max/step', () => {
    const def = {
      ...minimalGpu(),
      inputs: [
        serPort('image', 'image'),
        serPort('float', 'gain', false, { defaultValue: { type: 'float' as const, value: 1.2 }, min: 0, max: 4, step: 0.01 }),
      ],
    };
    const output = serializeCustomDefinition(def);
    expect(output).toContain('float gain = 1.2 min 0.0 max 4.0 step 0.01');
  });

  it('serializes multiple outputs', () => {
    const def = { ...minimalGpu(), outputs: [serPort('image', 'image'), serPort('mask', 'alpha')] };
    const output = serializeCustomDefinition(def);
    expect(output).toContain('    image image');
    expect(output).toContain('    mask alpha');
  });

  it('omits inputs section when inputs list is empty', () => {
    const def = { ...minimalGpu(), inputs: [] };
    const output = serializeCustomDefinition(def);
    expect(output).not.toContain('inputs {');
    expect(output).toContain('outputs {');
  });

  it('serializes multiline GPU code block preserving indentation', () => {
    const code = 'vec3 glow = color.rgb * gain;\nreturn vec4(glow, color.a);';
    const def = { ...minimalGpu(), code };
    const output = serializeCustomDefinition(def);
    expect(output).toContain('vec3 glow = color.rgb * gain;');
    expect(output).toContain('return vec4(glow, color.a);');
  });

  it('does not include group-only sections (params, graph) in GPU definition', () => {
    const output = serializeCustomDefinition(minimalGpu());
    expect(output).not.toContain('params {');
    expect(output).not.toContain('graph {');
  });
});

describe('serializeCustomDefinition — group', () => {
  it('serializes a minimal group definition', () => {
    const output = serializeCustomDefinition(minimalGroup());
    expect(output).toContain('node SoftBlur = group {');
    expect(output).toContain('inputs {');
    expect(output).toContain('    image image');
    expect(output).toContain('outputs {');
    expect(output).toContain('graph {');
    expect(output).toContain('    blur = GaussianBlur()');
    expect(output).toContain('    input.image -> blur.image');
    expect(output).toContain('    blur.image -> output.image');
  });

  it('serializes params section when params exist', () => {
    const def: DslGroupDefinition = {
      ...minimalGroup(),
      params: [
        serParam('float', 'amount', { type: 'float', value: 1 }, { min: 0, max: 5, step: 0.01 }),
        serParam('bool', 'invert', { type: 'bool', value: false }),
      ],
    };
    const output = serializeCustomDefinition(def);
    expect(output).toContain('params {');
    expect(output).toContain('    float amount = 1.0 min 0.0 max 5.0 step 0.01');
    expect(output).toContain('    bool invert = false');
  });

  it('omits params section when params list is empty', () => {
    const output = serializeCustomDefinition(minimalGroup());
    expect(output).not.toContain('params {');
  });

  it('serializes param.xxx references in internal node params', () => {
    const blurNode = serNode('blur', 'GaussianBlur', 'gaussian_blur', {
      amount: { type: 'ref', value: 'param.amount' },
    });
    const def: DslGroupDefinition = {
      ...minimalGroup(),
      params: [serParam('float', 'amount', { type: 'float', value: 1 })],
      graph: {
        nodes: new Map([['blur', blurNode]]),
        connections: [serConn('input', 'image', 'blur', 'image'), serConn('blur', 'image', 'output', 'image')],
      },
    };
    const output = serializeCustomDefinition(def);
    expect(output).toContain('blur = GaussianBlur(amount: param.amount)');
  });

  it('serializes muted internal nodes', () => {
    const blurNode: DslNode = { ...serNode('blur', 'GaussianBlur', 'gaussian_blur'), muted: true };
    const def: DslGroupDefinition = {
      ...minimalGroup(),
      graph: {
        nodes: new Map([['blur', blurNode]]),
        connections: [serConn('input', 'image', 'blur', 'image'), serConn('blur', 'image', 'output', 'image')],
      },
    };
    const output = serializeCustomDefinition(def);
    expect(output).toContain('blur = muted(GaussianBlur())');
  });

  it('serializes optional input ports', () => {
    const def = { ...minimalGroup(), inputs: [serPort('image', 'plate'), serPort('mask', 'matte', true)] };
    const output = serializeCustomDefinition(def);
    expect(output).toContain('    image plate');
    expect(output).toContain('    mask matte?');
  });

  it('serializes multiple internal nodes in insertion order', () => {
    const def: DslGroupDefinition = {
      ...minimalGroup(),
      graph: {
        nodes: new Map([
          ['blur', serNode('blur', 'GaussianBlur', 'gaussian_blur')],
          ['thresh', serNode('thresh', 'Threshold', 'threshold')],
        ]),
        connections: [
          serConn('input', 'image', 'blur', 'image'),
          serConn('blur', 'image', 'thresh', 'image'),
          serConn('thresh', 'image', 'output', 'image'),
        ],
      },
    };
    const output = serializeCustomDefinition(def);
    const blurIdx = output.indexOf('blur = GaussianBlur()');
    const threshIdx = output.indexOf('thresh = Threshold()');
    expect(blurIdx).toBeLessThan(threshIdx);
  });

  it('omits the graph section when internal graph is empty', () => {
    const def: DslGroupDefinition = {
      ...minimalGroup(),
      graph: { nodes: new Map(), connections: [] },
    };
    const output = serializeCustomDefinition(def);
    expect(output).not.toContain('graph {');
  });

  it('serializes port declarations with min/max/step', () => {
    const def: DslGroupDefinition = {
      ...minimalGroup(),
      inputs: [
        serPort('float', 'strength', false, {
          defaultValue: { type: 'float', value: 0.5 },
          min: 0,
          max: 1,
          step: 0.01,
        }),
      ],
    };
    const output = serializeCustomDefinition(def);
    expect(output).toContain('float strength = 0.5 min 0.0 max 1.0 step 0.01');
  });

  it('serializes bool param default correctly', () => {
    const def: DslGroupDefinition = {
      ...minimalGroup(),
      params: [serParam('bool', 'invert', { type: 'bool', value: true })],
    };
    const output = serializeCustomDefinition(def);
    expect(output).toContain('    bool invert = true');
  });

  it('serializes int param default correctly', () => {
    const def: DslGroupDefinition = {
      ...minimalGroup(),
      params: [serParam('int', 'levels', { type: 'int', value: 4 })],
    };
    const output = serializeCustomDefinition(def);
    expect(output).toContain('    int levels = 4');
  });
});

describe('serializeGraph with customNodes', () => {
  it('prepends custom definitions before the graph block', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-1', makeNodeInstance({ id: 'node-1', typeId: 'viewer' }));
    const input: SerializerInput = {
      nodes,
      connections: [],
      nodeSpecs: mockSpecs,
      handleMap: new HandleMap(),
      customNodes: new Map([['FilmGlow', minimalGpu()]]),
    };
    const output = serializeGraph(input);
    const defIdx = output.indexOf('node FilmGlow = gpu {');
    const graphIdx = output.indexOf('graph {');
    expect(defIdx).toBeGreaterThanOrEqual(0);
    expect(graphIdx).toBeGreaterThan(defIdx);
    // definition and graph block separated by blank line
    expect(output).toContain('}\n\ngraph {');
  });

  it('prepends multiple definitions in map insertion order', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-1', makeNodeInstance({ id: 'node-1', typeId: 'viewer' }));
    const input: SerializerInput = {
      nodes,
      connections: [],
      nodeSpecs: mockSpecs,
      handleMap: new HandleMap(),
      customNodes: new Map<string, DslGpuDefinition | DslGroupDefinition>([
        ['FilmGlow', minimalGpu()],
        ['SoftBlur', minimalGroup()],
      ]),
    };
    const output = serializeGraph(input);
    const gpuIdx = output.indexOf('node FilmGlow = gpu {');
    const groupIdx = output.indexOf('node SoftBlur = group {');
    const graphIdx = output.indexOf('graph {');
    expect(gpuIdx).toBeLessThan(groupIdx);
    expect(groupIdx).toBeLessThan(graphIdx);
  });

  it('produces just the graph block when customNodes is undefined', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-1', makeNodeInstance({ id: 'node-1', typeId: 'viewer' }));
    const input: SerializerInput = {
      nodes,
      connections: [],
      nodeSpecs: mockSpecs,
      handleMap: new HandleMap(),
    };
    const output = serializeGraph(input);
    expect(output.startsWith('graph {')).toBe(true);
    expect(output).not.toContain('node ');
  });

  it('produces just the graph block when customNodes is empty', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-1', makeNodeInstance({ id: 'node-1', typeId: 'viewer' }));
    const input: SerializerInput = {
      nodes,
      connections: [],
      nodeSpecs: mockSpecs,
      handleMap: new HandleMap(),
      customNodes: new Map(),
    };
    const output = serializeGraph(input);
    expect(output.startsWith('graph {')).toBe(true);
  });

  it('prunes stale group definitions after a DSL group rename', () => {
    const activeGroup = minimalGroup();
    activeGroup.name = 'CurvesGroup';
    const staleGroup = minimalGroup();
    staleGroup.name = 'NodeGroup';

    const runtimeActive: SerializableGroupDefinition = {
      id: 'group::curves_group',
      name: 'Curves Group',
      category: 'Custom',
      description: 'Active renamed group',
      internal_graph: {
        nodes: [
          { id: 'curves1', type_id: 'curves', params: {}, input_defaults: {}, position: [0, 0] },
          { id: 'input', type_id: 'group_input', params: {}, input_defaults: {}, position: [0, 0] },
          { id: 'output', type_id: 'group_output', params: {}, input_defaults: {}, position: [0, 0] },
        ],
        connections: [
          { from_node: 'input', from_port: 'image', to_node: 'curves1', to_port: 'image' },
          { from_node: 'curves1', from_port: 'image', to_node: 'output', to_port: 'image' },
        ],
      },
      promotions: [],
      is_builtin: false,
      explicit_inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      explicit_outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    };
    const runtimeStale: SerializableGroupDefinition = {
      ...runtimeActive,
      id: 'group::user_old',
      name: 'Node Group',
      description: 'Stale pre-rename group',
    };
    const nodes = new Map<string, NodeInstance>([
      ['group-node', makeNodeInstance({ id: 'group-node', typeId: 'group::curves_group' })],
    ]);
    const output = serializeGraph({
      nodes,
      connections: [],
      nodeSpecs: mockSpecs,
      handleMap: new HandleMap(),
      groupDefinitions: [runtimeStale, runtimeActive],
      customNodes: new Map([
        ['NodeGroup', staleGroup],
        ['CurvesGroup', activeGroup],
      ]),
      customDefinitionNames: [{ runtimeId: 'group::user_old', name: 'NodeGroup' }],
      pruneUnusedCustomDefinitions: true,
    });

    expect(output).toContain('node CurvesGroup = group {');
    expect(output).toContain('curves_group1 = CurvesGroup()');
    expect(output).not.toContain('node NodeGroup = group');
    expect(output).not.toContain('node NodeGroup2 = group');
  });

  it('uses the custom group definition name for instance handles when the runtime spec is still generic', () => {
    const runtimeGroup: SerializableGroupDefinition = {
      id: 'group::user_123',
      name: 'Node Group',
      category: 'Custom',
      description: 'Runtime group with a shadow name',
      internal_graph: {
        nodes: [
          { id: 'curves1', type_id: 'curves', params: {}, input_defaults: {}, position: [0, 0] },
          { id: 'input', type_id: 'group_input', params: {}, input_defaults: {}, position: [0, 0] },
          { id: 'output', type_id: 'group_output', params: {}, input_defaults: {}, position: [0, 0] },
        ],
        connections: [
          { from_node: 'input', from_port: 'image', to_node: 'curves1', to_port: 'image' },
          { from_node: 'curves1', from_port: 'image', to_node: 'output', to_port: 'image' },
        ],
      },
      promotions: [],
      is_builtin: false,
      explicit_inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      explicit_outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    };
    const staleRuntimeSpec: NodeSpec = {
      id: 'group::user_123',
      display_name: 'Node Group',
      category: 'Custom',
      description: 'Runtime group with a shadow name',
      inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      params: [],
    };
    const nodes = new Map<string, NodeInstance>([
      ['group-node', makeNodeInstance({ id: 'group-node', typeId: 'group::user_123' })],
    ]);

    const output = serializeGraph({
      nodes,
      connections: [],
      nodeSpecs: [...mockSpecs, staleRuntimeSpec],
      handleMap: new HandleMap(),
      groupDefinitions: [runtimeGroup],
      customDefinitionNames: [{ runtimeId: 'group::user_123', name: 'CloudyAdjustment' }],
      pruneUnusedCustomDefinitions: true,
    });

    expect(output).toContain('node CloudyAdjustment = group {');
    expect(output).toContain('cloudy_adjustment1 = CloudyAdjustment()');
    expect(output).not.toContain('node_group1 = CloudyAdjustment()');
  });

  it('keeps nested group definitions that are referenced by a reachable group', () => {
    const child: SerializableGroupDefinition = {
      id: 'group::child_group',
      name: 'Child Group',
      category: 'Custom',
      description: 'Nested group',
      internal_graph: {
        nodes: [
          { id: 'curves1', type_id: 'curves', params: {}, input_defaults: {}, position: [0, 0] },
          { id: 'input', type_id: 'group_input', params: {}, input_defaults: {}, position: [0, 0] },
          { id: 'output', type_id: 'group_output', params: {}, input_defaults: {}, position: [0, 0] },
        ],
        connections: [
          { from_node: 'input', from_port: 'image', to_node: 'curves1', to_port: 'image' },
          { from_node: 'curves1', from_port: 'image', to_node: 'output', to_port: 'image' },
        ],
      },
      promotions: [],
      is_builtin: false,
      explicit_inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      explicit_outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    };
    const parent: SerializableGroupDefinition = {
      ...child,
      id: 'group::parent_group',
      name: 'Parent Group',
      description: 'Reachable parent group',
      internal_graph: {
        nodes: [
          { id: 'child1', type_id: 'group::child_group', params: {}, input_defaults: {}, position: [0, 0] },
          { id: 'input', type_id: 'group_input', params: {}, input_defaults: {}, position: [0, 0] },
          { id: 'output', type_id: 'group_output', params: {}, input_defaults: {}, position: [0, 0] },
        ],
        connections: [
          { from_node: 'input', from_port: 'image', to_node: 'child1', to_port: 'image' },
          { from_node: 'child1', from_port: 'image', to_node: 'output', to_port: 'image' },
        ],
      },
    };
    const nodes = new Map<string, NodeInstance>([
      ['group-node', makeNodeInstance({ id: 'group-node', typeId: 'group::parent_group' })],
    ]);
    const output = serializeGraph({
      nodes,
      connections: [],
      nodeSpecs: mockSpecs,
      handleMap: new HandleMap(),
      groupDefinitions: [child, parent],
      pruneUnusedCustomDefinitions: true,
    });

    expect(output).toContain('node ChildGroup = group {');
    expect(output).toContain('node ParentGroup = group {');
    expect(output).toContain('child1 = ChildGroup()');
    expect(output).toContain('parent_group1 = ParentGroup()');
  });
});

describe('serializeCustomDefinition round-trip via parseDsl', () => {
  it('round-trips a GPU definition through parse → serialize → re-parse', async () => {
    const { parseDsl } = await import('../parser');
    const original: DslGpuDefinition = {
      kind: 'gpu',
      name: 'FilmGlow',
      line: 1,
      inputs: [
        serPort('image', 'image'),
        serPort('mask', 'matte', true),
        serPort('float', 'gain', false, { defaultValue: { type: 'float', value: 1.2 }, min: 0, max: 4, step: 0.01 }),
      ],
      outputs: [serPort('image', 'image')],
      code: 'vec3 g = color.rgb * gain;\nreturn vec4(g, color.a);',
    };
    const serialized = serializeCustomDefinition(original);
    const dsl = `${serialized}\n\ngraph {\n  v = Viewer()\n}`;
    const result = parseDsl(dsl, mockSpecs);
    expect(result.errors).toHaveLength(0);
    const def = result.ast?.customNodes?.get('FilmGlow');
    expect(def?.kind).toBe('gpu');
    if (def?.kind !== 'gpu') throw new Error('expected gpu');
    expect(def.inputs).toMatchObject([
      { valueType: 'image', name: 'image', optional: false },
      { valueType: 'mask', name: 'matte', optional: true },
      { valueType: 'float', name: 'gain', defaultValue: { type: 'float', value: 1.2 }, min: 0, max: 4, step: 0.01 },
    ]);
    expect(def.code).toContain('vec3 g = color.rgb * gain;');
  });

  it('round-trips a group definition through parse → serialize → re-parse', async () => {
    const { parseDsl } = await import('../parser');
    const blurNode = serNode('blur', 'GaussianBlur', 'gaussian_blur', {
      amount: { type: 'ref', value: 'param.amount' },
    });
    const original: DslGroupDefinition = {
      kind: 'group',
      name: 'SoftBlur',
      line: 1,
      inputs: [serPort('image', 'image')],
      outputs: [serPort('image', 'image')],
      params: [serParam('float', 'amount', { type: 'float', value: 1 }, { min: 0, max: 5, step: 0.01 })],
      graph: {
        nodes: new Map([['blur', blurNode]]),
        connections: [
          serConn('input', 'image', 'blur', 'image'),
          serConn('blur', 'image', 'output', 'image'),
        ],
      },
    };
    const serialized = serializeCustomDefinition(original);
    const dsl = `${serialized}\n\ngraph {\n  sb = SoftBlur(amount: 2.0)\n}`;
    const result = parseDsl(dsl, mockSpecs);
    expect(result.errors).toHaveLength(0);
    const def = result.ast?.customNodes?.get('SoftBlur');
    expect(def?.kind).toBe('group');
    if (def?.kind !== 'group') throw new Error('expected group');
    expect(def.params).toMatchObject([
      { valueType: 'float', name: 'amount', defaultValue: { type: 'float', value: 1 }, min: 0, max: 5, step: 0.01 },
    ]);
    expect(def.graph.nodes.get('blur')?.params.get('amount')).toEqual({ type: 'ref', value: 'param.amount' });
    expect(result.ast?.nodes.get('sb')?.nodeTypeId).toBe('group::soft_blur');
  });
});
