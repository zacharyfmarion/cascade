import { describe, expect, it } from 'vitest';
import type { Connection, NodeInstance } from '../../../store/types';
import { HandleMap } from '../handleMap';
import { parseDsl } from '../parser';
import { serializeGraph } from '../serializer';
import { validateAst } from '../validator';
import { makeNodeInstance, mockSpecs } from './helpers';

const graph = (body: string): string => `graph {\n${body}\n}`;

const serialize = (nodes: Map<string, NodeInstance>, connections: Connection[] = []): string =>
  serializeGraph({
    nodes,
    connections,
    nodeSpecs: mockSpecs,
    handleMap: new HandleMap(),
  });

describe('resize in Cascade DSL', () => {
  it('parses and validates fit-within resize params', () => {
    const parsed = parseDsl(
      graph('  resize1 = Resize(mode: "fit_within", width: 1600, height: 1600, allow_upscale: true)'),
      mockSpecs,
    );

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.ast?.nodes.get('resize1')?.params.get('mode')).toEqual({
      type: 'dropdown',
      value: 'fit_within',
      index: 1,
    });
    expect(parsed.ast?.nodes.get('resize1')?.params.get('allow_upscale')).toEqual({
      type: 'bool',
      value: true,
    });

    const validation = validateAst(parsed.ast!, mockSpecs);
    expect(validation.errors).toHaveLength(0);
    expect(validation.valid).toBe(true);
  });

  it('serializes default exact mode without a mode param', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('resize-node', makeNodeInstance({
      id: 'resize-node',
      typeId: 'resize',
      params: {
        mode: { Int: 0 },
        width: { Int: 1600 },
        height: { Int: 900 },
        allow_upscale: { Bool: false },
      },
    }));

    expect(serialize(nodes)).toBe(graph('  resize1 = Resize(width: 1600, height: 900)'));
  });

  it('round-trips cover resize mode', () => {
    const parsed = parseDsl(
      graph('  resize1 = Resize(mode: "cover", width: 1080, height: 1350, allow_upscale: true)'),
      mockSpecs,
    );

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.ast?.nodes.get('resize1')?.params.get('mode')).toEqual({
      type: 'dropdown',
      value: 'cover',
      index: 2,
    });
    expect(validateAst(parsed.ast!, mockSpecs).valid).toBe(true);

    const nodes = new Map<string, NodeInstance>();
    nodes.set('resize-node', makeNodeInstance({
      id: 'resize-node',
      typeId: 'resize',
      params: {
        mode: { Int: 2 },
        width: { Int: 1080 },
        height: { Int: 1350 },
        allow_upscale: { Bool: true },
      },
    }));
    expect(serialize(nodes)).toBe(
      graph('  resize1 = Resize(mode: "cover", width: 1080, height: 1350, allow_upscale: true)'),
    );
  });

  it('round-trips legacy exact-mode resize DSL unchanged', () => {
    const source = graph('  resize1 = Resize(width: 1600, height: 900)');
    const parsed = parseDsl(source, mockSpecs);

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.ast?.nodes.get('resize1')?.params.has('mode')).toBe(false);
    expect(validateAst(parsed.ast!, mockSpecs).valid).toBe(true);

    const nodes = new Map<string, NodeInstance>();
    nodes.set('resize-node', makeNodeInstance({
      id: 'resize-node',
      typeId: 'resize',
      params: {
        width: { Int: 1600 },
        height: { Int: 900 },
      },
    }));
    expect(serialize(nodes)).toBe(source);
  });
});
