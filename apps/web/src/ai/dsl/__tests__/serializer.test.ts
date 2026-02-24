import { describe, it, expect } from 'vitest';
import { serializeGraph, type SerializerInput } from '../serializer';
import { HandleMap } from '../handleMap';
import type { Connection, NodeInstance } from '../../../store/types';
import { makeNodeInstance, mockSpecs } from './helpers';

const buildInput = (nodes: Map<string, NodeInstance>, connections: Connection[], handleMap = new HandleMap()): SerializerInput => ({
  nodes,
  connections,
  nodeSpecs: mockSpecs,
  handleMap,
});

describe('serializeGraph', () => {
  it('serializes empty graph to empty string', () => {
    const input = buildInput(new Map(), []);
    expect(serializeGraph(input)).toBe('');
  });

  it('serializes single node without params', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-1', makeNodeInstance({ id: 'node-1', typeId: 'viewer' }));
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe('viewer1 = Viewer()');
  });

  it('serializes single node with non-default param', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'gaussian_blur',
        params: { sigma: { Float: 5.0 } },
        inputDefaults: { sigma: { Float: 5.0 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe('blur1 = GaussianBlur(sigma: 5.0)');
  });

  it('omits params when value matches default', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'gaussian_blur',
        params: { sigma: { Float: 1.0 } },
        inputDefaults: { sigma: { Float: 1.0 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe('blur1 = GaussianBlur()');
  });

  it('serializes muted nodes with prefix', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'gaussian_blur',
        muted: true,
        params: { sigma: { Float: 5.0 } },
        inputDefaults: { sigma: { Float: 5.0 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe('@muted blur1 = GaussianBlur(sigma: 5.0)');
  });

  it('serializes connections in correct format', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('load', makeNodeInstance({ id: 'load', typeId: 'load_image' }));
    nodes.set('blur', makeNodeInstance({ id: 'blur', typeId: 'gaussian_blur' }));
    const connections: Connection[] = [
      { id: 'c1', fromNode: 'load', fromPort: 'image', toNode: 'blur', toPort: 'image' },
    ];
    const output = serializeGraph(buildInput(nodes, connections));
    expect(output).toBe(['load1 = LoadImage()', 'blur1 = GaussianBlur()', '', 'blur1.image <- load1.image'].join('\n'));
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
    const lines = output.split('\n').filter((line) => line.includes('<-'));
    expect(lines).toEqual([
      'blend1.base <- load1.image',
      'blend1.overlay <- load1.image',
      'blur1.image <- load1.image',
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
    const nodeLines = output.split('\n').slice(0, 3);
    expect(nodeLines).toEqual(['load1 = LoadImage()', 'blur1 = GaussianBlur()', 'viewer1 = Viewer()']);
  });

  it('assigns unique handles for multiple nodes of same type', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('blur-a', makeNodeInstance({ id: 'blur-a', typeId: 'gaussian_blur' }));
    nodes.set('blur-b', makeNodeInstance({ id: 'blur-b', typeId: 'gaussian_blur' }));
    const output = serializeGraph(buildInput(nodes, []));
    expect(output.split('\n')).toEqual(['blur1 = GaussianBlur()', 'blur2 = GaussianBlur()']);
  });

  it('uses inputDefaults for promotable params', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'gaussian_blur',
        params: { sigma: { Float: 0.9 } },
        inputDefaults: { sigma: { Float: 0.25 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe('blur1 = GaussianBlur(sigma: 0.25)');
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
    expect(output).toBe('solid1 = SolidColor(width: 1024)');
  });

  it('formats floats with trailing .0', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-1',
      makeNodeInstance({
        id: 'node-1',
        typeId: 'gaussian_blur',
        params: { sigma: { Float: 5 } },
        inputDefaults: { sigma: { Float: 5 } },
      })
    );
    const output = serializeGraph(buildInput(nodes, []));
    expect(output).toBe('blur1 = GaussianBlur(sigma: 5.0)');
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
    expect(output).toBe('palette1 = ColorPalette(colors: [rgba(1.0, 0.0, 0.0, 1.0), rgba(0.0, 1.0, 0.0, 1.0)])');
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
      'ramp1 = ColorRamp(stops: [0.25: rgba(0.0, 0.0, 0.0, 1.0), 0.75: rgba(1.0, 1.0, 1.0, 1.0)])'
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
    expect(output).toBe('curves1 = Curves(master_curve: [(0.0, 0.0), (0.5, 0.7), (1.0, 1.0)])');
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
    expect(output).toBe('palette1 = ColorPalette()');
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
    expect(output).toBe('blend1 = Blend(mode: "screen")');
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
    expect(output).toBe('blend1 = Blend()');
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
    expect(output).toBe('gradient1 = Gradient(direction: "radial")');
  });
});
