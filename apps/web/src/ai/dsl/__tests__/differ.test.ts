import { describe, expect, it } from 'vitest';
import { diffAst, connectionKey } from '../differ';
import type { DslAst, DslConnection, DslNode, DslParamValue, GraphMutation } from '../types';
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

const findSpec = (id: string) => mockSpecs.find(spec => spec.id === id);

describe('differ', () => {
  it('returns no mutations for identical ASTs', () => {
    const node = makeNode('a', 'GaussianBlur', 'gaussian_blur', { sigma: { type: 'float', value: 2 } });
    const ast = makeAst([node], []);

    expect(diffAst(ast, ast)).toEqual([]);
  });

  it('adds a node with correct fields', () => {
    const newNode = makeNode('b', 'GaussianBlur', 'gaussian_blur', { sigma: { type: 'float', value: 3 } });
    const mutations = diffAst(makeAst([], []), makeAst([newNode], []));

    expect(mutations).toHaveLength(1);
    const mutation = mutations[0] as Extract<GraphMutation, { type: 'addNode' }>;
    expect(mutation).toMatchObject({ type: 'addNode', handle: 'b', typeId: 'gaussian_blur', muted: false });
    expect(mutation.params.get('sigma')).toEqual({ type: 'float', value: 3 });
  });

  it('adds node before connect mutation when new connection exists', () => {
    const existing = makeNode('a', 'LoadImage', 'load_image');
    const added = makeNode('b', 'GaussianBlur', 'gaussian_blur');
    const connection: DslConnection = {
      fromHandle: 'a',
      fromPort: 'image',
      toHandle: 'b',
      toPort: 'image',
      line: 1,
    };
    const mutations = diffAst(makeAst([existing], []), makeAst([existing, added], [connection]));

    expect(mutations.map(m => m.type)).toEqual(['addNode', 'connect']);
  });

  it('removes a node', () => {
    const oldNode = makeNode('a', 'Viewer', 'viewer');
    const mutations = diffAst(makeAst([oldNode], []), makeAst([], []));

    expect(mutations).toEqual([{ type: 'removeNode', handle: 'a' }]);
  });

  it('disconnects before removing a node with connections', () => {
    const a = makeNode('a', 'LoadImage', 'load_image');
    const b = makeNode('b', 'Viewer', 'viewer');
    const connection: DslConnection = {
      fromHandle: 'a',
      fromPort: 'image',
      toHandle: 'b',
      toPort: 'image',
      line: 1,
    };
    const mutations = diffAst(makeAst([a, b], [connection]), makeAst([a], []));

    expect(mutations.map(m => m.type)).toEqual(['disconnect', 'removeNode']);
  });

  it('updates a changed param', () => {
    const oldNode = makeNode('a', 'GaussianBlur', 'gaussian_blur', { sigma: { type: 'float', value: 1 } });
    const newNode = makeNode('a', 'GaussianBlur', 'gaussian_blur', { sigma: { type: 'float', value: 2 } });
    const mutations = diffAst(makeAst([oldNode], []), makeAst([newNode], []));

    expect(mutations).toEqual([
      { type: 'setParam', handle: 'a', paramKey: 'sigma', value: { type: 'float', value: 2 } },
    ]);
  });

  it('detects palette param change', () => {
    const oldNode = makeNode('a', 'ColorPalette', 'color_palette', {
      colors: { type: 'palette', value: [[1, 0, 0, 1], [0, 1, 0, 1]] },
    });
    const newNode = makeNode('a', 'ColorPalette', 'color_palette', {
      colors: { type: 'palette', value: [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]] },
    });
    const mutations = diffAst(makeAst([oldNode], []), makeAst([newNode], []));

    expect(mutations).toEqual([
      {
        type: 'setParam',
        handle: 'a',
        paramKey: 'colors',
        value: { type: 'palette', value: [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]] },
      },
    ]);
  });

  it('detects ramp param change', () => {
    const oldNode = makeNode('a', 'ColorRamp', 'color_ramp', {
      stops: { type: 'ramp', value: [{ position: 0, color: [0, 0, 0, 1] }] },
    });
    const newNode = makeNode('a', 'ColorRamp', 'color_ramp', {
      stops: {
        type: 'ramp',
        value: [
          { position: 0, color: [0, 0, 0, 1] },
          { position: 1, color: [1, 1, 1, 1] },
        ],
      },
    });
    const mutations = diffAst(makeAst([oldNode], []), makeAst([newNode], []));

    expect(mutations).toEqual([
      {
        type: 'setParam',
        handle: 'a',
        paramKey: 'stops',
        value: {
          type: 'ramp',
          value: [
            { position: 0, color: [0, 0, 0, 1] },
            { position: 1, color: [1, 1, 1, 1] },
          ],
        },
      },
    ]);
  });

  it('detects curve param change', () => {
    const oldNode = makeNode('a', 'Curves', 'curves', {
      master_curve: { type: 'curve', value: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    });
    const newNode = makeNode('a', 'Curves', 'curves', {
      master_curve: { type: 'curve', value: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] },
    });
    const mutations = diffAst(makeAst([oldNode], []), makeAst([newNode], []));

    expect(mutations).toEqual([
      {
        type: 'setParam',
        handle: 'a',
        paramKey: 'master_curve',
        value: {
          type: 'curve',
          value: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.7 },
            { x: 1, y: 1 },
          ],
        },
      },
    ]);
  });

  it('adds a param when previously unset', () => {
    const oldNode = makeNode('a', 'GaussianBlur', 'gaussian_blur');
    const newNode = makeNode('a', 'GaussianBlur', 'gaussian_blur', { sigma: { type: 'float', value: 0.5 } });
    const mutations = diffAst(makeAst([oldNode], []), makeAst([newNode], []));

    expect(mutations).toEqual([
      { type: 'setParam', handle: 'a', paramKey: 'sigma', value: { type: 'float', value: 0.5 } },
    ]);
  });

  it('updates multiple params when both changed', () => {
    const oldNode = makeNode('a', 'BrightnessContrast', 'brightness_contrast', {
      brightness: { type: 'float', value: 0 },
      contrast: { type: 'float', value: 0 },
    });
    const newNode = makeNode('a', 'BrightnessContrast', 'brightness_contrast', {
      brightness: { type: 'float', value: 0.2 },
      contrast: { type: 'float', value: -0.3 },
    });
    const mutations = diffAst(makeAst([oldNode], []), makeAst([newNode], []));

    expect(mutations).toHaveLength(2);
    expect(mutations).toEqual([
      { type: 'setParam', handle: 'a', paramKey: 'brightness', value: { type: 'float', value: 0.2 } },
      { type: 'setParam', handle: 'a', paramKey: 'contrast', value: { type: 'float', value: -0.3 } },
    ]);
  });

  it('adds a connection', () => {
    const a = makeNode('a', 'LoadImage', 'load_image');
    const b = makeNode('b', 'Viewer', 'viewer');
    const connection: DslConnection = {
      fromHandle: 'a',
      fromPort: 'image',
      toHandle: 'b',
      toPort: 'image',
      line: 1,
    };
    const mutations = diffAst(makeAst([a, b], []), makeAst([a, b], [connection]));

    expect(mutations).toEqual([
      { type: 'connect', fromHandle: 'a', fromPort: 'image', toHandle: 'b', toPort: 'image' },
    ]);
  });

  it('removes a connection', () => {
    const a = makeNode('a', 'LoadImage', 'load_image');
    const b = makeNode('b', 'Viewer', 'viewer');
    const connection: DslConnection = {
      fromHandle: 'a',
      fromPort: 'image',
      toHandle: 'b',
      toPort: 'image',
      line: 1,
    };
    const mutations = diffAst(makeAst([a, b], [connection]), makeAst([a, b], []));

    expect(mutations).toEqual([{ type: 'disconnect', toHandle: 'b', toPort: 'image' }]);
  });

  it('rewires connections as disconnect then connect', () => {
    const a = makeNode('a', 'LoadImage', 'load_image');
    const b = makeNode('b', 'GaussianBlur', 'gaussian_blur');
    const c = makeNode('c', 'Viewer', 'viewer');
    const oldConn: DslConnection = {
      fromHandle: 'a',
      fromPort: 'image',
      toHandle: 'b',
      toPort: 'image',
      line: 1,
    };
    const newConn: DslConnection = {
      fromHandle: 'a',
      fromPort: 'image',
      toHandle: 'c',
      toPort: 'image',
      line: 1,
    };

    const mutations = diffAst(makeAst([a, b, c], [oldConn]), makeAst([a, b, c], [newConn]));

    expect(mutations.map(m => m.type)).toEqual(['disconnect', 'connect']);
  });

  it('orders mutations by disconnects, removes, adds, params, connects, muted', () => {
    const aOld = makeNode('a', 'GaussianBlur', 'gaussian_blur', { sigma: { type: 'float', value: 1 } }, false);
    const bOld = makeNode('b', 'Viewer', 'viewer', {}, false);
    const cOld = makeNode('c', 'LoadImage', 'load_image');
    const oldConn: DslConnection = {
      fromHandle: 'c',
      fromPort: 'image',
      toHandle: 'b',
      toPort: 'image',
      line: 1,
    };

    const aNew = makeNode('a', 'GaussianBlur', 'gaussian_blur', { sigma: { type: 'float', value: 2 } }, true);
    const dNew = makeNode('d', 'SolidColor', 'solid_color');
    const newConn: DslConnection = {
      fromHandle: 'd',
      fromPort: 'image',
      toHandle: 'a',
      toPort: 'image',
      line: 1,
    };

    const mutations = diffAst(
      makeAst([aOld, bOld, cOld], [oldConn]),
      makeAst([aNew, dNew], [newConn])
    );

    expect(mutations.map(m => m.type)).toEqual([
      'disconnect',
      'removeNode',
      'removeNode',
      'addNode',
      'setParam',
      'connect',
      'setMuted',
    ]);
  });

  it('handles complex ordering with remove, add, and rewire', () => {
    const a = makeNode('a', 'LoadImage', 'load_image');
    const bOld = makeNode('b', 'GaussianBlur', 'gaussian_blur');
    const cOld = makeNode('c', 'Viewer', 'viewer');
    const oldConn: DslConnection = {
      fromHandle: 'a',
      fromPort: 'image',
      toHandle: 'b',
      toPort: 'image',
      line: 1,
    };
    const dNew = makeNode('d', 'Invert', 'invert');
    const newConn: DslConnection = {
      fromHandle: 'a',
      fromPort: 'image',
      toHandle: 'd',
      toPort: 'image',
      line: 1,
    };

    const mutations = diffAst(makeAst([a, bOld, cOld], [oldConn]), makeAst([a, dNew], [newConn]));
    expect(mutations.map(m => m.type)).toEqual(['disconnect', 'removeNode', 'removeNode', 'addNode', 'connect']);
  });

  it('mutes a node', () => {
    const oldNode = makeNode('a', 'GaussianBlur', 'gaussian_blur', undefined, false);
    const newNode = makeNode('a', 'GaussianBlur', 'gaussian_blur', undefined, true);
    const mutations = diffAst(makeAst([oldNode], []), makeAst([newNode], []));

    expect(mutations).toEqual([{ type: 'setMuted', handle: 'a', muted: true }]);
  });

  it('unmutes a node', () => {
    const oldNode = makeNode('a', 'GaussianBlur', 'gaussian_blur', undefined, true);
    const newNode = makeNode('a', 'GaussianBlur', 'gaussian_blur', undefined, false);
    const mutations = diffAst(makeAst([oldNode], []), makeAst([newNode], []));

    expect(mutations).toEqual([{ type: 'setMuted', handle: 'a', muted: false }]);
  });

  it('ignores node order changes when content is identical', () => {
    const a = makeNode('a', 'GaussianBlur', 'gaussian_blur', { sigma: { type: 'float', value: 1 } });
    const b = makeNode('b', 'Viewer', 'viewer');
    const oldAst = makeAst([a, b], []);
    const newAst = makeAst([b, a], []);

    expect(diffAst(oldAst, newAst)).toEqual([]);
  });

  it('treats handle change as remove + add', () => {
    const oldNode = makeNode('a', 'GaussianBlur', 'gaussian_blur');
    const newNode = makeNode('b', 'GaussianBlur', 'gaussian_blur');
    const mutations = diffAst(makeAst([oldNode], []), makeAst([newNode], []));

    expect(mutations.map(m => m.type)).toEqual(['removeNode', 'addNode']);
  });

  it('computes connectionKey correctly', () => {
    const connection: DslConnection = {
      fromHandle: 'a',
      fromPort: 'image',
      toHandle: 'b',
      toPort: 'image',
      line: 1,
    };

    expect(connectionKey(connection)).toBe('a.image->b.image');
  });

  it('keeps params maps when adding node without specs', () => {
    const spec = findSpec('solid_color');
    const params: Record<string, DslParamValue> = spec
      ? {
          color: { type: 'color', value: [0, 0, 0, 1] },
          width: { type: 'int', value: 512 },
          height: { type: 'int', value: 256 },
        }
      : {};
    const node = makeNode('color', 'SolidColor', 'solid_color', params);
    const mutations = diffAst(makeAst([], []), makeAst([node], []));

    const mutation = mutations[0] as Extract<GraphMutation, { type: 'addNode' }>;
    expect(mutation.params.get('height')).toEqual({ type: 'int', value: 256 });
  });
});
