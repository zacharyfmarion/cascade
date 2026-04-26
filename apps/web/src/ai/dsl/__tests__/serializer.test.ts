import { describe, it, expect } from 'vitest';
import { serializeGraph, type SerializerInput } from '../serializer';
import { HandleMap } from '../handleMap';
import type { Connection, NodeInstance, NodeSpec } from '../../../store/types';
import { makeNodeInstance, mockSpecs } from './helpers';
import { buildDefaultGpuScriptManifest, buildGpuScriptNodeSpec } from '../../gpuScript';

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

  it('serializes gpu script source as a multiline string', () => {
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
    expect(output).toContain('gpu1 = GpuScript(');
    expect(output).toContain('script: """');
    expect(output).toContain('float gain = 1.2;');
    expect(output).toContain('return vec4(color.rgb * gain, color.a);');
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
