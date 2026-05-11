import { describe, expect, it } from 'vitest';
import type { Connection, NodeInstance } from '../../../types';
import {
  resolveMediaIteratorForViewer,
  type MediaIteratorInfo,
} from '../mediaIteratorSlice';

const node = (id: string, typeId: string): NodeInstance => ({
  id,
  typeId,
  position: { x: 0, y: 0 },
  params: {},
  inputDefaults: {},
  muted: false,
});

const connect = (fromNode: string, toNode: string, id = `${fromNode}->${toNode}`): Connection => ({
  id,
  fromNode,
  fromPort: 'image',
  toNode,
  toPort: 'value',
});

const iterator = (sourceNodeId: string, count = 3): MediaIteratorInfo => ({
  sourceNodeId,
  kind: 'batch',
  label: sourceNodeId,
  startFrame: 0,
  endFrame: count - 1,
  count,
  itemLabels: [],
  supportsRandomAccess: true,
});

const nodeMap = (...items: NodeInstance[]) => new Map(items.map(item => [item.id, item]));

describe('resolveMediaIteratorForViewer', () => {
  it('returns null for an unconnected viewer', () => {
    expect(resolveMediaIteratorForViewer(
      nodeMap(node('viewer1', 'viewer'), node('batch1', 'load_image_batch')),
      [],
      new Map([['batch1', iterator('batch1')]]),
      'viewer1',
    )).toBeNull();
  });

  it('returns the only loaded batch upstream of a viewer', () => {
    const info = iterator('batch1');

    expect(resolveMediaIteratorForViewer(
      nodeMap(node('viewer1', 'viewer'), node('batch1', 'load_image_batch')),
      [connect('batch1', 'viewer1')],
      new Map([['batch1', info]]),
      'viewer1',
    )).toBe(info);
  });

  it('ignores loaded batches that are not upstream of the viewer', () => {
    const upstreamInfo = iterator('batch1');

    expect(resolveMediaIteratorForViewer(
      nodeMap(
        node('viewer1', 'viewer'),
        node('batch1', 'load_image_batch'),
        node('batch2', 'load_image_batch'),
      ),
      [connect('batch1', 'viewer1')],
      new Map([
        ['batch1', upstreamInfo],
        ['batch2', iterator('batch2')],
      ]),
      'viewer1',
    )).toBe(upstreamInfo);
  });

  it('returns null after the upstream batch is disconnected', () => {
    expect(resolveMediaIteratorForViewer(
      nodeMap(node('viewer1', 'viewer'), node('batch1', 'load_image_batch')),
      [],
      new Map([['batch1', iterator('batch1')]]),
      'viewer1',
    )).toBeNull();
  });

  it('returns null when multiple loaded media sources are upstream', () => {
    expect(resolveMediaIteratorForViewer(
      nodeMap(
        node('viewer1', 'viewer'),
        node('batch1', 'load_image_batch'),
        node('batch2', 'load_image_batch'),
        node('blend1', 'blend'),
      ),
      [
        connect('batch1', 'blend1', 'c1'),
        connect('batch2', 'blend1', 'c2'),
        connect('blend1', 'viewer1', 'c3'),
      ],
      new Map([
        ['batch1', iterator('batch1')],
        ['batch2', iterator('batch2')],
      ]),
      'viewer1',
    )).toBeNull();
  });
});
