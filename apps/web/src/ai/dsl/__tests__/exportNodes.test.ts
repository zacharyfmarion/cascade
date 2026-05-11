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

describe('export nodes in Cascade DSL', () => {
  it('parses and validates ExportImageBatch with default params', () => {
    const parsed = parseDsl(graph('  export1 = ExportImageBatch()'), mockSpecs);

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.ast?.nodes.get('export1')?.nodeTypeId).toBe('export_image_batch');
    expect(parsed.ast?.nodes.get('export1')?.params.size).toBe(0);

    const validation = validateAst(parsed.ast!, mockSpecs);
    expect(validation.errors).toHaveLength(0);
    expect(validation.valid).toBe(true);
  });

  it('round-trips ExportImageBatch output_dir and filename_template as strings', () => {
    const parsed = parseDsl(
      graph('  export1 = ExportImageBatch(output_dir: "/tmp/out", filename_template: "{index1}_{name}")'),
      mockSpecs,
    );

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.ast?.nodes.get('export1')?.params.get('output_dir')).toEqual({
      type: 'string',
      value: '/tmp/out',
    });
    expect(parsed.ast?.nodes.get('export1')?.params.get('filename_template')).toEqual({
      type: 'string',
      value: '{index1}_{name}',
    });

    const validation = validateAst(parsed.ast!, mockSpecs);
    expect(validation.errors).toHaveLength(0);

    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-export', makeNodeInstance({
      id: 'node-export',
      typeId: 'export_image_batch',
      params: {
        output_dir: { String: '/tmp/out' },
        filename_template: { String: '{index1}_{name}' },
      },
    }));

    const serialized = serialize(nodes);
    expect(serialized).toContain('ExportImageBatch(output_dir: "/tmp/out", filename_template: "{index1}_{name}")');

    const reparsed = parseDsl(serialized, mockSpecs);
    expect(reparsed.errors).toHaveLength(0);
    expect(validateAst(reparsed.ast!, mockSpecs).valid).toBe(true);
  });

  it('omits default empty output_dir from serialized ExportImageBatch DSL', () => {
    const nodes = new Map<string, NodeInstance>();
    nodes.set('node-export', makeNodeInstance({
      id: 'node-export',
      typeId: 'export_image_batch',
      params: {
        output_dir: { String: '' },
        filename_template: { String: '{name}' },
      },
    }));

    expect(serialize(nodes)).toBe(graph('  export1 = ExportImageBatch()'));
  });
});

