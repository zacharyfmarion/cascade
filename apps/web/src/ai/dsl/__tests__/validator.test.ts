import { describe, expect, it } from 'vitest';
import { levenshteinDistance, validateAst } from '../validator';
import type {
  DslAst,
  DslConnection,
  DslGroupDefinition,
  DslGpuDefinition,
  DslNode,
  DslParamDeclaration,
  DslParamValue,
  DslPortDeclaration,
} from '../types';
import { mockSpecs } from './helpers';
import type { NodeSpec } from '../../../store/types';

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
      amoun: { type: 'float', value: 1 },
    });
    const result = validateAst(makeAst([node], []), mockSpecs);

    expect(result.errors[0]?.message).toContain('Unknown param "amoun"');
    expect(result.errors[0]?.message).toContain('Valid params: amount');
  });

  it('reports param type mismatches', () => {
    const node = makeNode('blur', 'GaussianBlur', 'gaussian_blur', {
      amount: { type: 'string', value: 'nope' },
    });
    const result = validateAst(makeAst([node], []), mockSpecs);

    expect(result.errors[0]?.message).toContain('Param "amount" expects number');
  });

  it('reports param values out of range', () => {
    const node = makeNode('blur', 'GaussianBlur', 'gaussian_blur', {
      amount: { type: 'float', value: 200 },
    });
    const result = validateAst(makeAst([node], []), mockSpecs);

    expect(result.errors[0]?.message).toContain('must be between 0 and 5');
  });

  it('accepts valid params', () => {
    const node = makeNode('blur', 'GaussianBlur', 'gaussian_blur', {
      amount: { type: 'float', value: 2 },
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

  // Port existence, type compatibility, and cycle detection are handled by
  // Rust via validate_edits() (see semanticValidator.ts). The JS validator
  // intentionally does not duplicate those checks.

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
    const node = makeNode('orphan', 'Curves', 'curves');
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

// ---------------------------------------------------------------------------
// Custom definition validation
// ---------------------------------------------------------------------------

const port = (valueType: string, name: string, optional = false, line = 1): DslPortDeclaration => ({
  valueType, name, optional, line,
});

const paramDecl = (valueType: string, name: string, defaultValue: DslParamValue, line = 1): DslParamDeclaration => ({
  valueType, name, defaultValue, line,
});

const internalConn = (fromHandle: string, fromPort: string, toHandle: string, toPort: string, line = 1): DslConnection => ({
  fromHandle, fromPort, toHandle, toPort, line,
});

const makeGpuDef = (overrides: Partial<DslGpuDefinition> = {}): DslGpuDefinition => ({
  kind: 'gpu',
  name: 'TestGpu',
  line: 1,
  inputs: [port('image', 'image')],
  outputs: [port('image', 'image')],
  code: 'return color;',
  ...overrides,
});

const makeGroupDef = (overrides: Partial<DslGroupDefinition> = {}): DslGroupDefinition => ({
  kind: 'group',
  name: 'TestGroup',
  line: 1,
  inputs: [port('image', 'image')],
  outputs: [port('image', 'image')],
  params: [],
  graph: {
    nodes: new Map([
      ['blur', makeNode('blur', 'GaussianBlur', 'gaussian_blur')],
    ]),
    connections: [
      internalConn('input', 'image', 'blur', 'image'),
      internalConn('blur', 'image', 'output', 'image'),
    ],
  },
  ...overrides,
});

const invertSpec: NodeSpec = {
  id: 'gpu_kernel::invert',
  display_name: 'Invert',
  category: 'Color',
  description: 'Invert colors',
  inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  params: [],
};

const withCustom = (definitions: (DslGpuDefinition | DslGroupDefinition)[]): DslAst => ({
  nodes: new Map(),
  connections: [],
  customNodes: new Map(definitions.map(d => [d.name, d])),
});

describe('validateAst — GPU custom definitions', () => {
  it('passes a well-formed GPU definition without errors', () => {
    const result = validateAst(withCustom([makeGpuDef()]), mockSpecs);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects GPU definitions that collide with a built-in node name', () => {
    const result = validateAst(withCustom([makeGpuDef({ name: 'Invert' })]), [...mockSpecs, invertSpec]);

    expect(result.errors.some(e =>
      e.message.includes('Custom node "Invert" conflicts with a built-in node type')
      && e.message.includes('InvertImage')
    )).toBe(true);
  });

  it('accepts GPU definitions with distinct names near built-in node names', () => {
    const result = validateAst(withCustom([makeGpuDef({ name: 'InvertImage' })]), [...mockSpecs, invertSpec]);

    expect(result.errors).toHaveLength(0);
  });

  it('errors when GPU definition has no outputs', () => {
    const result = validateAst(withCustom([makeGpuDef({ outputs: [] })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('at least one output'))).toBe(true);
  });

  it('errors when GPU code block is empty', () => {
    const result = validateAst(withCustom([makeGpuDef({ code: '' })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('empty code block'))).toBe(true);
  });

  it('errors when GPU code block is whitespace only', () => {
    const result = validateAst(withCustom([makeGpuDef({ code: '   \n  ' })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('empty code block'))).toBe(true);
  });

  it('errors on duplicate GPU input port names', () => {
    const result = validateAst(withCustom([makeGpuDef({
      inputs: [port('image', 'image'), port('image', 'image')],
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('Duplicate input "image"'))).toBe(true);
  });

  it('errors on duplicate GPU output port names', () => {
    const result = validateAst(withCustom([makeGpuDef({
      outputs: [port('image', 'image'), port('image', 'image')],
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('Duplicate output "image"'))).toBe(true);
  });

  it('does not error on same name used in inputs vs outputs on GPU def', () => {
    const result = validateAst(withCustom([makeGpuDef({
      inputs: [port('image', 'image')],
      outputs: [port('image', 'image')],
    })]), mockSpecs);
    expect(result.errors).toHaveLength(0);
  });

  it('warns when GPU definition has no image or mask inputs', () => {
    const result = validateAst(withCustom([makeGpuDef({
      inputs: [port('float', 'gain')],
    })]), mockSpecs);
    expect(result.warnings.some(w => w.message.includes('no image or mask inputs'))).toBe(true);
  });

  it('does not warn about missing image inputs when inputs list is empty', () => {
    const result = validateAst(withCustom([makeGpuDef({ inputs: [] })]), mockSpecs);
    expect(result.warnings.some(w => w.message.includes('no image or mask inputs'))).toBe(false);
  });

  it('accepts mask inputs without warning', () => {
    const result = validateAst(withCustom([makeGpuDef({
      inputs: [port('mask', 'matte'), port('float', 'gain')],
    })]), mockSpecs);
    expect(result.warnings.some(w => w.message.includes('no image or mask inputs'))).toBe(false);
  });
});

describe('validateAst — group custom definitions', () => {
  it('passes a well-formed group definition without errors', () => {
    const result = validateAst(withCustom([makeGroupDef()]), mockSpecs);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects group definitions that collide with a built-in node name', () => {
    const result = validateAst(withCustom([makeGroupDef({ name: 'Invert' })]), [...mockSpecs, invertSpec]);

    expect(result.errors.some(e =>
      e.message.includes('Custom node "Invert" conflicts with a built-in node type')
    )).toBe(true);
  });

  it('errors when group has no outputs', () => {
    const result = validateAst(withCustom([makeGroupDef({ outputs: [] })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('at least one output'))).toBe(true);
  });

  it('errors on duplicate group input port names', () => {
    const result = validateAst(withCustom([makeGroupDef({
      inputs: [port('image', 'plate'), port('image', 'plate')],
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('Duplicate input "plate"'))).toBe(true);
  });

  it('errors on duplicate group output port names', () => {
    const result = validateAst(withCustom([makeGroupDef({
      outputs: [port('image', 'image'), port('image', 'image')],
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('Duplicate output "image"'))).toBe(true);
  });

  it('errors on duplicate param names', () => {
    const result = validateAst(withCustom([makeGroupDef({
      params: [
        paramDecl('float', 'amount', { type: 'float', value: 1 }),
        paramDecl('float', 'amount', { type: 'float', value: 2 }),
      ],
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('Duplicate param "amount"'))).toBe(true);
  });

  it('errors when param name conflicts with an input port name', () => {
    const result = validateAst(withCustom([makeGroupDef({
      inputs: [port('image', 'image')],
      params: [paramDecl('float', 'image', { type: 'float', value: 1 })],
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('conflicts with a port'))).toBe(true);
  });

  it('errors when param name conflicts with an output port name', () => {
    const result = validateAst(withCustom([makeGroupDef({
      outputs: [port('image', 'out')],
      params: [paramDecl('float', 'out', { type: 'float', value: 1 })],
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('conflicts with a port'))).toBe(true);
  });

  it('errors when internal node uses reserved handle "input"', () => {
    const internalNodes = new Map([
      ['input', makeNode('input', 'GaussianBlur', 'gaussian_blur')],
    ]);
    const result = validateAst(withCustom([makeGroupDef({
      graph: { nodes: internalNodes, connections: [] },
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('"input" is reserved'))).toBe(true);
  });

  it('errors when internal node uses reserved handle "output"', () => {
    const internalNodes = new Map([
      ['output', makeNode('output', 'GaussianBlur', 'gaussian_blur')],
    ]);
    const result = validateAst(withCustom([makeGroupDef({
      graph: { nodes: internalNodes, connections: [] },
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('"output" is reserved'))).toBe(true);
  });

  it('passes a group with two distinct internal nodes (no duplicate handles)', () => {
    const internalNodes = new Map([
      ['blur', makeNode('blur', 'GaussianBlur', 'gaussian_blur')],
      ['thresh', makeNode('thresh', 'Threshold', 'threshold')],
    ]);
    const result = validateAst(withCustom([makeGroupDef({
      graph: {
        nodes: internalNodes,
        connections: [
          internalConn('input', 'image', 'blur', 'image'),
          internalConn('blur', 'image', 'thresh', 'image'),
          internalConn('thresh', 'image', 'output', 'image'),
        ],
      },
    })]), mockSpecs);
    expect(result.errors).toHaveLength(0);
  });

  it('errors when internal node type is unknown', () => {
    const internalNodes = new Map([
      ['mystery', makeNode('mystery', 'MysteryNode', 'mystery_node')],
    ]);
    const result = validateAst(withCustom([makeGroupDef({
      graph: {
        nodes: internalNodes,
        connections: [internalConn('input', 'image', 'mystery', 'image'), internalConn('mystery', 'image', 'output', 'image')],
      },
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('Unknown node type "MysteryNode"') && e.message.includes('internal graph'))).toBe(true);
  });

  it('suggests close match for unknown internal node type', () => {
    const internalNodes = new Map([
      ['blur', makeNode('blur', 'GausianBlur', 'gausian_blur')],
    ]);
    const result = validateAst(withCustom([makeGroupDef({
      graph: {
        nodes: internalNodes,
        connections: [internalConn('input', 'image', 'blur', 'image'), internalConn('blur', 'image', 'output', 'image')],
      },
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('Did you mean "GaussianBlur"'))).toBe(true);
  });

  it('errors on connection from undeclared input port', () => {
    const result = validateAst(withCustom([makeGroupDef({
      inputs: [port('image', 'image')],
      graph: {
        nodes: new Map([['blur', makeNode('blur', 'GaussianBlur', 'gaussian_blur')]]),
        connections: [
          internalConn('input', 'nonexistent', 'blur', 'image'),
          internalConn('blur', 'image', 'output', 'image'),
        ],
      },
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('undeclared input port "nonexistent"'))).toBe(true);
  });

  it('errors on connection to undeclared output port', () => {
    const result = validateAst(withCustom([makeGroupDef({
      graph: {
        nodes: new Map([['blur', makeNode('blur', 'GaussianBlur', 'gaussian_blur')]]),
        connections: [
          internalConn('input', 'image', 'blur', 'image'),
          internalConn('blur', 'image', 'output', 'nonexistent'),
        ],
      },
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('undeclared output port "nonexistent"'))).toBe(true);
  });

  it('errors on connection FROM the "output" virtual handle', () => {
    const result = validateAst(withCustom([makeGroupDef({
      graph: {
        nodes: new Map([['blur', makeNode('blur', 'GaussianBlur', 'gaussian_blur')]]),
        connections: [
          internalConn('output', 'image', 'blur', 'image'),
        ],
      },
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('Cannot connect FROM "output"'))).toBe(true);
  });

  it('errors on connection TO the "input" virtual handle', () => {
    const result = validateAst(withCustom([makeGroupDef({
      graph: {
        nodes: new Map([['blur', makeNode('blur', 'GaussianBlur', 'gaussian_blur')]]),
        connections: [
          internalConn('blur', 'image', 'input', 'image'),
        ],
      },
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('Cannot connect TO "input"'))).toBe(true);
  });

  it('errors on connection from unknown internal node handle', () => {
    const result = validateAst(withCustom([makeGroupDef({
      graph: {
        nodes: new Map([['blur', makeNode('blur', 'GaussianBlur', 'gaussian_blur')]]),
        connections: [
          internalConn('ghost', 'image', 'blur', 'image'),
          internalConn('blur', 'image', 'output', 'image'),
        ],
      },
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('Unknown source "ghost"'))).toBe(true);
  });

  it('errors on connection to unknown internal node handle', () => {
    const result = validateAst(withCustom([makeGroupDef({
      graph: {
        nodes: new Map([['blur', makeNode('blur', 'GaussianBlur', 'gaussian_blur')]]),
        connections: [
          internalConn('input', 'image', 'ghost', 'image'),
          internalConn('blur', 'image', 'output', 'image'),
        ],
      },
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('Unknown destination "ghost"'))).toBe(true);
  });

  it('errors when param.xxx reference points to undeclared param', () => {
    const params = new Map<string, DslParamValue>([
      ['amount', { type: 'ref', value: 'param.nonexistent' }],
    ]);
    const internalNode = { ...makeNode('blur', 'GaussianBlur', 'gaussian_blur'), params };
    const result = validateAst(withCustom([makeGroupDef({
      params: [],
      graph: {
        nodes: new Map([['blur', internalNode]]),
        connections: [
          internalConn('input', 'image', 'blur', 'image'),
          internalConn('blur', 'image', 'output', 'image'),
        ],
      },
    })]), mockSpecs);
    expect(result.errors.some(e => e.message.includes('"param.nonexistent"') && e.message.includes('undeclared param'))).toBe(true);
  });

  it('passes when param.xxx reference matches a declared param', () => {
    const params = new Map<string, DslParamValue>([
      ['amount', { type: 'ref', value: 'param.radius' }],
    ]);
    const internalNode = { ...makeNode('blur', 'GaussianBlur', 'gaussian_blur'), params };
    const result = validateAst(withCustom([makeGroupDef({
      params: [paramDecl('float', 'radius', { type: 'float', value: 1 })],
      graph: {
        nodes: new Map([['blur', internalNode]]),
        connections: [
          internalConn('input', 'image', 'blur', 'image'),
          internalConn('blur', 'image', 'output', 'image'),
        ],
      },
    })]), mockSpecs);
    expect(result.errors).toHaveLength(0);
  });

  it('warns when a declared output port is never connected internally', () => {
    const result = validateAst(withCustom([makeGroupDef({
      outputs: [port('image', 'image'), port('image', 'debug')],
      graph: {
        nodes: new Map([['blur', makeNode('blur', 'GaussianBlur', 'gaussian_blur')]]),
        connections: [
          internalConn('input', 'image', 'blur', 'image'),
          internalConn('blur', 'image', 'output', 'image'),
          // 'debug' output is never connected
        ],
      },
    })]), mockSpecs);
    expect(result.warnings.some(w => w.message.includes('Output port "debug"') && w.message.includes('never connected internally'))).toBe(true);
    expect(result.warnings.some(w => w.message.includes('Output port "image"'))).toBe(false);
  });

  it('does not warn about output ports when all are connected', () => {
    const result = validateAst(withCustom([makeGroupDef()]), mockSpecs);
    expect(result.warnings.some(w => w.message.includes('never connected internally'))).toBe(false);
  });

  it('validates multiple definitions independently', () => {
    const goodGpu = makeGpuDef({ name: 'GoodGpu' });
    const badGpu = makeGpuDef({ name: 'BadGpu', outputs: [] });
    const result = validateAst({
      nodes: new Map(),
      connections: [],
      customNodes: new Map([['GoodGpu', goodGpu], ['BadGpu', badGpu]]),
    }, mockSpecs);
    expect(result.errors.some(e => e.message.includes('"BadGpu"'))).toBe(true);
    expect(result.errors.some(e => e.message.includes('"GoodGpu"'))).toBe(false);
  });

  it('validates group with multiple params and multiple internal nodes', () => {
    const params = [
      paramDecl('float', 'amount', { type: 'float', value: 1 }),
      paramDecl('bool', 'invert', { type: 'bool', value: false }),
    ];
    const blurParams = new Map<string, DslParamValue>([
      ['amount', { type: 'ref', value: 'param.amount' }],
    ]);
    const blurNode = { ...makeNode('blur', 'GaussianBlur', 'gaussian_blur'), params: blurParams };
    const threshNode = { ...makeNode('thresh', 'Threshold', 'threshold') };
    const def = makeGroupDef({
      inputs: [port('image', 'image')],
      outputs: [port('image', 'image')],
      params,
      graph: {
        nodes: new Map([['blur', blurNode], ['thresh', threshNode]]),
        connections: [
          internalConn('input', 'image', 'blur', 'image'),
          internalConn('blur', 'image', 'thresh', 'image'),
          internalConn('thresh', 'image', 'output', 'image'),
        ],
      },
    });
    const result = validateAst(withCustom([def]), mockSpecs);
    expect(result.errors).toHaveLength(0);
  });
});
