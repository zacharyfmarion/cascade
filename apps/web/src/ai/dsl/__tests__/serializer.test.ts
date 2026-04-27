import { describe, it, expect } from 'vitest';
import { serializeGraph, serializeCustomDefinition, type SerializerInput } from '../serializer';
import { HandleMap } from '../handleMap';
import type { Connection, NodeInstance, NodeSpec } from '../../../store/types';
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

  it('lifts gpu_script nodes to top-level gpu definitions', () => {
    const manifest = {
      ...buildDefaultGpuScriptManifest('gpu_script::demo'),
      kernel: 'float gain = 1.2;\nreturn vec4(color.rgb * gain, color.a);',
    };
    const specs = [...mockSpecs, buildGpuScriptNodeSpec(manifest)];
    const nodes = new Map<string, NodeInstance>();
    nodes.set('gpu-node', makeNodeInstance({
      id: 'gpu-node',
      typeId: 'gpu_script::demo',
      params: {
        __script_manifest: { String: JSON.stringify(manifest) },
      },
    }));
    const handleMap = new HandleMap();
    handleMap.set('gpu1', 'gpu-node');

    const output = serializeGraph(buildInputWithSpecs(nodes, [], specs, handleMap));
    // definition block comes first
    expect(output).toContain('node Gpu1 = gpu {');
    expect(output).toContain('code """');
    expect(output).toContain('float gain = 1.2;');
    expect(output).toContain('return vec4(color.rgb * gain, color.a);');
    // root graph references by type name, no inline script
    expect(output).toContain('gpu1 = Gpu1()');
    expect(output).not.toContain('GpuScript(');
    expect(output).not.toContain('script:');
  });

  it('emits non-default scalar params for lifted gpu_script nodes', () => {
    const manifest = buildGpuScriptManifest(
      'gpu_script::vignette',
      [
        { name: 'image', label: 'Image', ty: 'Image' },
        { name: 'strength', label: 'Strength', ty: 'Float', default: 0.5, min: 0, max: 2, step: 0.01 },
      ],
      [{ name: 'image', label: 'Image', ty: 'Image' }],
      [],
      'return color;',
    );
    const nodes = new Map<string, NodeInstance>();
    nodes.set('vign-node', makeNodeInstance({
      id: 'vign-node',
      typeId: 'gpu_script::vignette',
      params: {
        __script_manifest: { String: JSON.stringify(manifest) },
        strength: { Float: 1.2 },
      },
    }));
    const handleMap = new HandleMap();
    handleMap.set('vign1', 'vign-node');

    const output = serializeGraph(buildInputWithSpecs(nodes, [], mockSpecs, handleMap));
    expect(output).toContain('node Vign1 = gpu {');
    // non-default strength value should appear in root graph
    expect(output).toContain('vign1 = Vign1(strength: 1.2');
  });

  it('omits default scalar params for lifted gpu_script nodes', () => {
    const manifest = buildGpuScriptManifest(
      'gpu_script::vignette',
      [
        { name: 'image', label: 'Image', ty: 'Image' },
        { name: 'strength', label: 'Strength', ty: 'Float', default: 0.5, min: 0, max: 2, step: 0.01 },
      ],
      [{ name: 'image', label: 'Image', ty: 'Image' }],
      [],
      'return color;',
    );
    const nodes = new Map<string, NodeInstance>();
    nodes.set('vign-node', makeNodeInstance({
      id: 'vign-node',
      typeId: 'gpu_script::vignette',
      params: {
        __script_manifest: { String: JSON.stringify(manifest) },
        strength: { Float: 0.5 }, // same as default
      },
    }));
    const handleMap = new HandleMap();
    handleMap.set('vign1', 'vign-node');

    const output = serializeGraph(buildInputWithSpecs(nodes, [], mockSpecs, handleMap));
    // default value should be omitted
    expect(output).toContain('vign1 = Vign1()');
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

const serNode = (handle: string, nodeType: string, nodeTypeId: string, params?: Record<string, DslParamValue>): DslNode => {
  const paramMap = new Map<string, DslParamValue>();
  if (params) for (const [k, v] of Object.entries(params)) paramMap.set(k, v);
  return { handle, nodeType, nodeTypeId, params: paramMap, muted: false, line: 1 };
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
