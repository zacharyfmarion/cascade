import { describe, expect, it } from 'vitest';

import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react';

import { findClosestEdge, findEdgeInsertionPlan } from './edgeInsertion';
import type { Connection, NodeInstance, NodeSpec, PortSpec } from '../store/types';

const makeFlowNode = (
  id: string,
  x: number,
  y: number,
  width = 160,
  height = 80,
): FlowNode => ({
  id,
  position: { x, y },
  data: {},
  measured: { width, height },
} as FlowNode);

const makeEdge = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string): FlowEdge => ({
  id,
  source,
  sourceHandle,
  target,
  targetHandle,
} as FlowEdge);

const input = (name: string, ty: PortSpec['ty']): PortSpec => ({
  name,
  label: name,
  ty,
});

const output = (name: string, ty: PortSpec['ty']): PortSpec => ({
  name,
  label: name,
  ty,
});

const makeSpec = (id: string, inputs: PortSpec[], outputs: PortSpec[]): NodeSpec => ({
  id,
  display_name: id,
  category: 'Test',
  description: id,
  inputs,
  outputs,
  params: [],
});

const TYPES_COMPATIBLE = (fromType: string, toType: string) =>
  fromType === toType || toType === 'Any';

describe('findClosestEdge', () => {
  it('returns the nearest edge within hit slop', () => {
    const nodes = [
      makeFlowNode('source', 100, 100),
      makeFlowNode('target', 400, 100),
      makeFlowNode('other-source', 100, 260),
      makeFlowNode('other-target', 400, 260),
    ];
    const edges = [
      makeEdge('primary', 'source', 'image', 'target', 'image'),
      makeEdge('secondary', 'other-source', 'image', 'other-target', 'image'),
    ];

    const closest = findClosestEdge({ x: 280, y: 140 }, edges, nodes);

    expect(closest?.id).toBe('primary');
  });

  it('returns null when no edge is close enough', () => {
    const nodes = [
      makeFlowNode('source', 100, 100),
      makeFlowNode('target', 400, 100),
    ];
    const edges = [makeEdge('primary', 'source', 'image', 'target', 'image')];

    const closest = findClosestEdge({ x: 280, y: 260 }, edges, nodes);

    expect(closest).toBeNull();
  });
});

describe('findEdgeInsertionPlan', () => {
  it('finds compatible ports for inserting a node into an edge', () => {
    const graphNodes = new Map<string, NodeInstance>([
      ['source', { id: 'source', typeId: 'sourceNode', params: {}, inputDefaults: {}, position: { x: 0, y: 0 }, muted: false }],
      ['target', { id: 'target', typeId: 'targetNode', params: {}, inputDefaults: {}, position: { x: 0, y: 0 }, muted: false }],
    ]);
    const nodeSpecs = [
      makeSpec('sourceNode', [], [output('image', 'Image')]),
      makeSpec('targetNode', [input('image', 'Image')], []),
    ];
    const insertedSpec = makeSpec('blurNode', [input('image', 'Image')], [output('image', 'Image')]);

    const plan = findEdgeInsertionPlan({
      edge: makeEdge('edge-1', 'source', 'image', 'target', 'image'),
      nodeSpec: insertedSpec,
      graphNodes,
      nodeSpecs,
      connections: [],
      typesCompatible: TYPES_COMPATIBLE,
    });

    expect(plan).toMatchObject({
      edge: { id: 'edge-1' },
      inputPort: { name: 'image' },
      outputPort: { name: 'image' },
    });
  });

  it('returns the replaced incoming connection for an existing dragged node input', () => {
    const graphNodes = new Map<string, NodeInstance>([
      ['source', { id: 'source', typeId: 'sourceNode', params: {}, inputDefaults: {}, position: { x: 0, y: 0 }, muted: false }],
      ['target', { id: 'target', typeId: 'targetNode', params: {}, inputDefaults: {}, position: { x: 0, y: 0 }, muted: false }],
      ['dragged', { id: 'dragged', typeId: 'blurNode', params: {}, inputDefaults: {}, position: { x: 0, y: 0 }, muted: false }],
      ['previous', { id: 'previous', typeId: 'sourceNode', params: {}, inputDefaults: {}, position: { x: 0, y: 0 }, muted: false }],
    ]);
    const nodeSpecs = [
      makeSpec('sourceNode', [], [output('image', 'Image')]),
      makeSpec('targetNode', [input('image', 'Image')], []),
      makeSpec('blurNode', [input('image', 'Image')], [output('image', 'Image')]),
    ];
    const connections: Connection[] = [
      { id: 'existing-input', fromNode: 'previous', fromPort: 'image', toNode: 'dragged', toPort: 'image' },
    ];

    const plan = findEdgeInsertionPlan({
      edge: makeEdge('edge-1', 'source', 'image', 'target', 'image'),
      nodeSpec: nodeSpecs[2],
      graphNodes,
      nodeSpecs,
      connections,
      typesCompatible: TYPES_COMPATIBLE,
      draggedNodeId: 'dragged',
    });

    expect(plan?.replacedIncomingConnectionId).toBe('existing-input');
  });

  it('rejects an insertion that would create a cycle for an existing node', () => {
    const graphNodes = new Map<string, NodeInstance>([
      ['source', { id: 'source', typeId: 'sourceNode', params: {}, inputDefaults: {}, position: { x: 0, y: 0 }, muted: false }],
      ['target', { id: 'target', typeId: 'targetNode', params: {}, inputDefaults: {}, position: { x: 0, y: 0 }, muted: false }],
      ['dragged', { id: 'dragged', typeId: 'blurNode', params: {}, inputDefaults: {}, position: { x: 0, y: 0 }, muted: false }],
    ]);
    const nodeSpecs = [
      makeSpec('sourceNode', [input('image', 'Image')], [output('image', 'Image')]),
      makeSpec('targetNode', [input('image', 'Image')], [output('image', 'Image')]),
      makeSpec('blurNode', [input('image', 'Image')], [output('image', 'Image')]),
    ];
    const connections: Connection[] = [
      { id: 'dragged-to-source', fromNode: 'dragged', fromPort: 'image', toNode: 'source', toPort: 'image' },
    ];

    const plan = findEdgeInsertionPlan({
      edge: makeEdge('edge-1', 'source', 'image', 'target', 'image'),
      nodeSpec: nodeSpecs[2],
      graphNodes,
      nodeSpecs,
      connections,
      typesCompatible: TYPES_COMPATIBLE,
      draggedNodeId: 'dragged',
    });

    expect(plan).toBeNull();
  });
});
