import { describe, expect, it } from 'vitest';
import { levenshteinDistance, validateAst } from '../validator';
import type { DslAst, DslConnection, DslNode, DslParamValue } from '../types';
import type { NodeSpec } from '../../../store/types';
import { mockSpecs } from './helpers';

function makeNode(
  handle: string,
  nodeType: string,
  nodeTypeId: string,
  params?: Record<string, DslParamValue>,
  muted?: boolean
): DslNode {
  const paramMap = new Map<string, DslParamValue>();
  if (params) for (const [k, v] of Object.entries(params)) paramMap.set(k, v);
  return { handle, nodeType, nodeTypeId, params: paramMap, muted: muted ?? false, line: 1 };
}

function makeAst(nodes: DslNode[], connections: DslConnection[]): DslAst {
  const nodeMap = new Map<string, DslNode>();
  for (const n of nodes) nodeMap.set(n.handle, n);
  return { nodes: nodeMap, connections };
}

describe('validator', () => {
  it('computes levenshtein distance for common example', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  it('computes levenshtein distance with empty string', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
  });

  it('computes levenshtein distance for identical strings', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
  });

  it('reports unknown node types', () => {
    const node = makeNode('a', 'MysteryNode', 'mystery_node');
    const result = validateAst(makeAst([node], []), mockSpecs);

    expect(result.errors[0]?.message).toContain('Unknown node type "MysteryNode"');
  });

  it('suggests close matches for unknown node types', () => {
    const node = makeNode('a', 'GausianBlur', 'gausian_blur');
    const result = validateAst(makeAst([node], []), mockSpecs);

    expect(result.errors[0]?.message).toContain('Did you mean "GaussianBlur"');
  });

  it('accepts valid node types without errors', () => {
    const load = makeNode('load', 'LoadImage', 'load_image');
    const blur = makeNode('blur', 'GaussianBlur', 'gaussian_blur');
    const result = validateAst(makeAst([load, blur], []), mockSpecs);

    expect(result.errors).toHaveLength(0);
  });

  it('reports unknown param keys with valid list', () => {
    const node = makeNode('blur', 'GaussianBlur', 'gaussian_blur', {
      sigme: { type: 'float', value: 1 },
    });
    const result = validateAst(makeAst([node], []), mockSpecs);

    expect(result.errors[0]?.message).toContain('Unknown param "sigme"');
    expect(result.errors[0]?.message).toContain('Valid params: sigma');
  });

  it('reports param type mismatches', () => {
    const node = makeNode('blur', 'GaussianBlur', 'gaussian_blur', {
      sigma: { type: 'string', value: 'nope' },
    });
    const result = validateAst(makeAst([node], []), mockSpecs);

    expect(result.errors[0]?.message).toContain('Param "sigma" expects number');
  });

  it('reports param values out of range', () => {
    const node = makeNode('blur', 'GaussianBlur', 'gaussian_blur', {
      sigma: { type: 'float', value: 200 },
    });
    const result = validateAst(makeAst([node], []), mockSpecs);

    expect(result.errors[0]?.message).toContain('must be between 0 and 100');
  });

  it('accepts valid params', () => {
    const node = makeNode('blur', 'GaussianBlur', 'gaussian_blur', {
      sigma: { type: 'float', value: 2 },
    });
    const result = validateAst(makeAst([node], []), mockSpecs);

    expect(result.errors).toHaveLength(0);
  });

  it('reports connections to unknown handles with suggestions', () => {
    const a = makeNode('a', 'LoadImage', 'load_image');
    const b = makeNode('b', 'Viewer', 'viewer');
    const connection: DslConnection = {
      fromHandle: 'aa',
      fromPort: 'image',
      toHandle: 'b',
      toPort: 'image',
      line: 3,
    };
    const result = validateAst(makeAst([a, b], [connection]), mockSpecs);

    expect(result.errors[0]?.message).toContain('Unknown node "aa"');
    expect(result.errors[0]?.message).toContain('Did you mean "a"');
  });

  it('reports unknown output ports with valid outputs', () => {
    const a = makeNode('a', 'LoadImage', 'load_image');
    const b = makeNode('b', 'Viewer', 'viewer');
    const connection: DslConnection = {
      fromHandle: 'a',
      fromPort: 'color',
      toHandle: 'b',
      toPort: 'image',
      line: 2,
    };
    const result = validateAst(makeAst([a, b], [connection]), mockSpecs);

    expect(result.errors[0]?.message).toContain('has no output port "color"');
    expect(result.errors[0]?.message).toContain('Valid outputs: image');
  });

  it('reports unknown input ports with valid inputs', () => {
    const a = makeNode('a', 'LoadImage', 'load_image');
    const b = makeNode('b', 'Viewer', 'viewer');
    const connection: DslConnection = {
      fromHandle: 'a',
      fromPort: 'image',
      toHandle: 'b',
      toPort: 'nope',
      line: 2,
    };
    const result = validateAst(makeAst([a, b], [connection]), mockSpecs);

    expect(result.errors[0]?.message).toContain('has no input port "nope"');
    expect(result.errors[0]?.message).toContain('Valid inputs: image');
  });

  it('reports duplicate input connections', () => {
    const a = makeNode('a', 'LoadImage', 'load_image');
    const b = makeNode('b', 'LoadImage', 'load_image');
    const viewer = makeNode('v', 'Viewer', 'viewer');
    const conn1: DslConnection = {
      fromHandle: 'a',
      fromPort: 'image',
      toHandle: 'v',
      toPort: 'image',
      line: 1,
    };
    const conn2: DslConnection = {
      fromHandle: 'b',
      fromPort: 'image',
      toHandle: 'v',
      toPort: 'image',
      line: 2,
    };
    const result = validateAst(makeAst([a, b, viewer], [conn1, conn2]), mockSpecs);

    expect(result.errors[0]?.message).toContain('already connected');
  });

  it('reports connection type mismatches', () => {
    const floatSourceSpec: NodeSpec = {
      id: 'float_source',
      display_name: 'Float Source',
      category: 'Utility',
      description: 'Outputs float',
      inputs: [],
      outputs: [{ name: 'value', label: 'Value', ty: 'Float' }],
      params: [],
    };
    const specs = [...mockSpecs, floatSourceSpec];
    const source = makeNode('s', 'FloatSource', 'float_source');
    const viewer = makeNode('v', 'Viewer', 'viewer');
    const conn: DslConnection = {
      fromHandle: 's',
      fromPort: 'value',
      toHandle: 'v',
      toPort: 'image',
      line: 4,
    };
    const result = validateAst(makeAst([source, viewer], [conn]), specs);

    expect(result.errors[0]?.message).toContain('Cannot connect Float output to Image input');
  });

  it('detects direct cycles', () => {
    const a = makeNode('a', 'GaussianBlur', 'gaussian_blur');
    const b = makeNode('b', 'Invert', 'invert');
    const conn1: DslConnection = {
      fromHandle: 'a',
      fromPort: 'image',
      toHandle: 'b',
      toPort: 'image',
      line: 1,
    };
    const conn2: DslConnection = {
      fromHandle: 'b',
      fromPort: 'image',
      toHandle: 'a',
      toPort: 'image',
      line: 2,
    };
    const result = validateAst(makeAst([a, b], [conn1, conn2]), mockSpecs);

    expect(result.errors[0]?.message).toContain('cycle');
  });

  it('detects indirect cycles', () => {
    const a = makeNode('a', 'GaussianBlur', 'gaussian_blur');
    const b = makeNode('b', 'Invert', 'invert');
    const c = makeNode('c', 'BrightnessContrast', 'brightness_contrast');
    const conn1: DslConnection = {
      fromHandle: 'a',
      fromPort: 'image',
      toHandle: 'b',
      toPort: 'image',
      line: 1,
    };
    const conn2: DslConnection = {
      fromHandle: 'b',
      fromPort: 'image',
      toHandle: 'c',
      toPort: 'image',
      line: 2,
    };
    const conn3: DslConnection = {
      fromHandle: 'c',
      fromPort: 'image',
      toHandle: 'a',
      toPort: 'image',
      line: 3,
    };
    const result = validateAst(makeAst([a, b, c], [conn1, conn2, conn3]), mockSpecs);

    expect(result.errors[0]?.message).toContain('cycle');
  });

  it('does not report cycles for valid graphs', () => {
    const load = makeNode('load', 'LoadImage', 'load_image');
    const blur = makeNode('blur', 'GaussianBlur', 'gaussian_blur');
    const viewer = makeNode('viewer', 'Viewer', 'viewer');
    const conn1: DslConnection = {
      fromHandle: 'load',
      fromPort: 'image',
      toHandle: 'blur',
      toPort: 'image',
      line: 1,
    };
    const conn2: DslConnection = {
      fromHandle: 'blur',
      fromPort: 'image',
      toHandle: 'viewer',
      toPort: 'image',
      line: 2,
    };
    const result = validateAst(makeAst([load, blur, viewer], [conn1, conn2]), mockSpecs);

    expect(result.errors).toHaveLength(0);
  });

  it('warns about unconnected nodes', () => {
    const node = makeNode('orphan', 'Invert', 'invert');
    const result = validateAst(makeAst([node], []), mockSpecs);

    expect(result.warnings[0]?.message).toBe('Node orphan has no connections');
  });

  it('warns when there is no viewer in graph', () => {
    const node = makeNode('load', 'LoadImage', 'load_image');
    const result = validateAst(makeAst([node], []), mockSpecs);

    expect(result.warnings.some(warning => warning.message === 'No viewer node in graph')).toBe(true);
  });

  it('does not warn about missing viewer when viewer exists', () => {
    const load = makeNode('load', 'LoadImage', 'load_image');
    const viewer = makeNode('viewer', 'Viewer', 'viewer');
    const conn: DslConnection = {
      fromHandle: 'load',
      fromPort: 'image',
      toHandle: 'viewer',
      toPort: 'image',
      line: 1,
    };
    const result = validateAst(makeAst([load, viewer], [conn]), mockSpecs);

    expect(result.warnings).toHaveLength(0);
  });
});
