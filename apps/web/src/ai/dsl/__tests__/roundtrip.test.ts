import { describe, it, expect } from 'vitest';
import { parseDsl } from '../parser';
import { serializeGraph } from '../serializer';
import { HandleMap } from '../handleMap';
import { diffAst } from '../differ';
import type { Connection, NodeInstance } from '../../../store/types';
import { makeNodeInstance, mockSpecs } from './helpers';

const buildGraph = (nodes: Map<string, NodeInstance>, connections: Connection[], handleMap = new HandleMap()): string =>
  serializeGraph({ nodes, connections, nodeSpecs: mockSpecs, handleMap });

describe('DSL roundtrip', () => {
  it('serialize -> parse -> diff -> 0 mutations', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-blur',
      makeNodeInstance({
        id: 'node-blur',
        typeId: 'gaussian_blur',
        params: { sigma: { Float: 2.5 } },
        inputDefaults: { sigma: { Float: 2.5 } },
      })
    );
    const text = buildGraph(nodes, []);
    const parsed = parseDsl(text, mockSpecs);
    expect(parsed.errors).toHaveLength(0);
    const mutations = diffAst(parsed.ast!, parsed.ast!);
    expect(mutations).toHaveLength(0);
  });

  it('roundtrips scalar input defaults', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-math',
      makeNodeInstance({
        id: 'node-math',
        typeId: 'math',
        params: { operation: { Int: 2 } },
        inputDefaults: { a: { Float: 3 }, b: { Float: 7 } },
      })
    );
    const text = buildGraph(nodes, []);
    expect(text).toContain('Math(a: 3.0, b: 7.0, operation: "multiply")');
    const parsed = parseDsl(text, mockSpecs);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.ast?.nodes.get('math1')?.inputDefaults.get('a')).toEqual({ type: 'float', value: 3 });
    expect(parsed.ast?.nodes.get('math1')?.inputDefaults.get('b')).toEqual({ type: 'float', value: 7 });
    expect(diffAst(parsed.ast!, parseDsl(text, mockSpecs).ast!)).toHaveLength(0);
  });

  it('roundtrips color palette', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-palette',
      makeNodeInstance({
        id: 'node-palette',
        typeId: 'color_palette',
        params: { colors: { ColorPalette: [[1, 0, 0, 1], [0, 1, 0, 1]] } },
      })
    );
    const text = buildGraph(nodes, []);
    const parsed = parseDsl(text, mockSpecs);
    expect(parsed.errors).toHaveLength(0);
    const mutations = diffAst(parsed.ast!, parseDsl(text, mockSpecs).ast!);
    expect(mutations).toHaveLength(0);
  });

  it('roundtrips color ramp', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-ramp',
      makeNodeInstance({
        id: 'node-ramp',
        typeId: 'color_ramp',
        params: {
          stops: { ColorRamp: [{ position: 0.25, color: [0, 0, 0, 1] }, { position: 0.75, color: [1, 1, 1, 1] }] },
        },
        inputDefaults: {
          stops: { ColorRamp: [{ position: 0.25, color: [0, 0, 0, 1] }, { position: 0.75, color: [1, 1, 1, 1] }] },
        },
      })
    );
    const text = buildGraph(nodes, []);
    const parsed = parseDsl(text, mockSpecs);
    expect(parsed.errors).toHaveLength(0);
    const mutations = diffAst(parsed.ast!, parseDsl(text, mockSpecs).ast!);
    expect(mutations).toHaveLength(0);
  });

  it('roundtrips curves', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-curves',
      makeNodeInstance({
        id: 'node-curves',
        typeId: 'curves',
        params: { master_curve: { CurvePoints: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] } },
      })
    );
    const text = buildGraph(nodes, []);
    const parsed = parseDsl(text, mockSpecs);
    expect(parsed.errors).toHaveLength(0);
    const mutations = diffAst(parsed.ast!, parseDsl(text, mockSpecs).ast!);
    expect(mutations).toHaveLength(0);
  });

  it('serialize -> parse -> re-serialize -> identical output', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-viewer', makeNodeInstance({ id: 'node-viewer', typeId: 'viewer' }));
    const text = buildGraph(nodes, []);
    const parsed = parseDsl(text, mockSpecs);
    expect(parsed.errors).toHaveLength(0);
    const textAgain = buildGraph(nodes, []);
    expect(textAgain).toBe(text);
  });

  it('multiple round-trips remain stable', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-load',
      makeNodeInstance({
        id: 'node-load',
        typeId: 'load_image',
        params: { path: { String: '/img/photo.jpg' } },
      })
    );
    const handleMap = new HandleMap();
    const text = buildGraph(nodes, [], handleMap);
    let current = text;
    for (let i = 0; i < 3; i += 1) {
      const parsed = parseDsl(current, mockSpecs);
      expect(parsed.errors).toHaveLength(0);
      current = buildGraph(nodes, [], handleMap);
    }
    expect(current).toBe(text);
  });

  it('roundtrips graph with every param type', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-blur',
      makeNodeInstance({
        id: 'node-blur',
        typeId: 'gaussian_blur',
        params: { amount: { Float: 4.25 } },
        inputDefaults: { amount: { Float: 4.25 } },
      })
    );
    nodes.set(
      'node-solid',
      makeNodeInstance({
        id: 'node-solid',
        typeId: 'solid_color',
        params: { color: { Color: [0.1, 0.2, 0.3, 1] }, width: { Int: 1024 } },
        inputDefaults: { color: { Color: [0.1, 0.2, 0.3, 1] } },
      })
    );
    nodes.set(
      'node-load',
      makeNodeInstance({
        id: 'node-load',
        typeId: 'load_image',
        params: { path: { String: '/img/a.png' } },
      })
    );
    nodes.set(
      'node-thresh',
      makeNodeInstance({
        id: 'node-thresh',
        typeId: 'threshold',
        params: { invert: { Bool: true } },
        inputDefaults: { invert: { Bool: true } },
      })
    );
    nodes.set(
      'node-palette',
      makeNodeInstance({
        id: 'node-palette',
        typeId: 'color_palette',
        params: { colors: { ColorPalette: [[1, 0, 0, 1], [0, 1, 0, 1]] } },
      })
    );
    nodes.set(
      'node-ramp',
      makeNodeInstance({
        id: 'node-ramp',
        typeId: 'color_ramp',
        params: {
          stops: { ColorRamp: [{ position: 0.25, color: [0, 0, 0, 1] }, { position: 0.75, color: [1, 1, 1, 1] }] },
        },
        inputDefaults: {
          stops: { ColorRamp: [{ position: 0.25, color: [0, 0, 0, 1] }, { position: 0.75, color: [1, 1, 1, 1] }] },
        },
      })
    );
    nodes.set(
      'node-curves',
      makeNodeInstance({
        id: 'node-curves',
        typeId: 'curves',
        params: { master_curve: { CurvePoints: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] } },
      })
    );
    const handleMap = new HandleMap();
    handleMap.set('thresh1', 'node-thresh');
    handleMap.set('palette1', 'node-palette');
    handleMap.set('ramp1', 'node-ramp');
    handleMap.set('curves1', 'node-curves');
    const text = buildGraph(nodes, [], handleMap);
    const parsed = parseDsl(text, mockSpecs);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.ast?.nodes.get('blur1')?.params.get('amount')).toEqual({ type: 'float', value: 4.25 });
    expect(parsed.ast?.nodes.get('solid1')?.params.get('width')).toEqual({ type: 'int', value: 1024 });
    expect(parsed.ast?.nodes.get('load1')?.params.get('path')).toEqual({ type: 'string', value: '/img/a.png' });
    expect(parsed.ast?.nodes.get('thresh1')?.params.get('invert')).toEqual({ type: 'bool', value: true });
    expect(parsed.ast?.nodes.get('solid1')?.params.get('color')).toEqual({ type: 'color', value: [0.1, 0.2, 0.3, 1] });
    expect(parsed.ast?.nodes.get('palette1')?.params.get('colors')).toEqual({
      type: 'palette',
      value: [
        [1, 0, 0, 1],
        [0, 1, 0, 1],
      ],
    });
    expect(parsed.ast?.nodes.get('ramp1')?.params.get('stops')).toEqual({
      type: 'ramp',
      value: [
        { position: 0.25, color: [0, 0, 0, 1] },
        { position: 0.75, color: [1, 1, 1, 1] },
      ],
    });
    expect(parsed.ast?.nodes.get('curves1')?.params.get('master_curve')).toEqual({
      type: 'curve',
      value: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.7 },
        { x: 1, y: 1 },
      ],
    });
  });

  it('roundtrips muted nodes', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-blur',
      makeNodeInstance({
        id: 'node-blur',
        typeId: 'gaussian_blur',
        muted: true,
        params: { sigma: { Float: 3 } },
        inputDefaults: { sigma: { Float: 3 } },
      })
    );
    const text = buildGraph(nodes, []);
    const parsed = parseDsl(text, mockSpecs);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.ast?.nodes.get('blur1')?.muted).toBe(true);
  });

  it('roundtrips complex graph with connections', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-load', makeNodeInstance({ id: 'node-load', typeId: 'load_image' }));
    nodes.set('node-blur', makeNodeInstance({ id: 'node-blur', typeId: 'gaussian_blur' }));
    nodes.set('node-viewer', makeNodeInstance({ id: 'node-viewer', typeId: 'viewer' }));
    nodes.set('node-solid', makeNodeInstance({ id: 'node-solid', typeId: 'solid_color' }));
    nodes.set('node-blend', makeNodeInstance({ id: 'node-blend', typeId: 'blend' }));

    const connections: Connection[] = [
      { id: 'c1', fromNode: 'node-load', fromPort: 'image', toNode: 'node-blur', toPort: 'image' },
      { id: 'c2', fromNode: 'node-blur', fromPort: 'image', toNode: 'node-viewer', toPort: 'image' },
      { id: 'c3', fromNode: 'node-solid', fromPort: 'image', toNode: 'node-blend', toPort: 'overlay' },
      { id: 'c4', fromNode: 'node-load', fromPort: 'image', toNode: 'node-blend', toPort: 'base' },
    ];

    const handleMap = new HandleMap();
    handleMap.set('load1', 'node-load');
    handleMap.set('blur1', 'node-blur');
    handleMap.set('viewer1', 'node-viewer');
    handleMap.set('solid1', 'node-solid');
    handleMap.set('blend1', 'node-blend');

    const text = buildGraph(nodes, connections, handleMap);
    const parsed = parseDsl(text, mockSpecs);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.ast?.connections).toHaveLength(4);
    expect(parsed.ast?.connections.map((c) => `${c.fromHandle}.${c.fromPort} -> ${c.toHandle}.${c.toPort}`)).toContain(
      'load1.image -> blend1.base'
    );
  });

  it('roundtrips dropdown param', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-blend',
      makeNodeInstance({
        id: 'node-blend',
        typeId: 'blend',
        params: { mode: { Int: 2 } },
      })
    );
    const handleMap = new HandleMap();
    handleMap.set('blend1', 'node-blend');
    const text = buildGraph(nodes, [], handleMap);
    expect(text).toContain('mode: "screen"');
    const parsed = parseDsl(text, mockSpecs);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.ast?.nodes.get('blend1')?.params.get('mode')).toEqual({
      type: 'dropdown', value: 'screen', index: 2,
    });
  });

  it('roundtrips gradient dropdown param', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set(
      'node-grad',
      makeNodeInstance({
        id: 'node-grad',
        typeId: 'gradient',
        params: { direction: { Int: 3 } },
        inputDefaults: { direction: { Int: 3 } },
      })
    );
    const handleMap = new HandleMap();
    handleMap.set('grad1', 'node-grad');
    const text = buildGraph(nodes, [], handleMap);
    expect(text).toContain('direction: "angular"');
    const parsed = parseDsl(text, mockSpecs);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.ast?.nodes.get('grad1')?.params.get('direction')).toEqual({
      type: 'dropdown', value: 'angular', index: 3,
    });
  });
});
