import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react';

import type { Connection, NodeInstance, NodeSpec, PortSpec } from '../store/types';

export const EDGE_INSERT_HIT_SLOP = 50;

export interface EdgeInsertionPlan {
  edge: FlowEdge;
  inputPort: PortSpec;
  outputPort: PortSpec;
  replacedIncomingConnectionId?: string;
}

interface FindEdgeInsertionPlanArgs {
  edge: FlowEdge | null;
  nodeSpec: NodeSpec | null;
  graphNodes: Map<string, NodeInstance>;
  nodeSpecs: NodeSpec[];
  connections: Connection[];
  typesCompatible: (fromType: string, toType: string) => boolean;
  draggedNodeId?: string;
}

const findNodeSpec = (
  nodeId: string,
  graphNodes: Map<string, NodeInstance>,
  nodeSpecs: NodeSpec[],
): NodeSpec | null => {
  const graphNode = graphNodes.get(nodeId);
  if (!graphNode) return null;
  return nodeSpecs.find(spec => spec.id === graphNode.typeId) ?? null;
};

const hasPath = (
  connections: Connection[],
  fromNode: string,
  toNode: string,
  excludedConnectionIds: Set<string>,
): boolean => {
  if (fromNode === toNode) return true;

  const visited = new Set<string>([fromNode]);
  const queue = [fromNode];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    for (const connection of connections) {
      if (excludedConnectionIds.has(connection.id)) continue;
      if (connection.fromNode !== current) continue;
      if (connection.toNode === toNode) return true;
      if (visited.has(connection.toNode)) continue;
      visited.add(connection.toNode);
      queue.push(connection.toNode);
    }
  }

  return false;
};

export function findClosestEdge(
  position: { x: number; y: number },
  edges: FlowEdge[],
  nodes: FlowNode[],
  hitSlop = EDGE_INSERT_HIT_SLOP,
): FlowEdge | null {
  let closestEdge: FlowEdge | null = null;
  let minDistance = hitSlop;

  for (const edge of edges) {
    const sourceNode = nodes.find(node => node.id === edge.source);
    const targetNode = nodes.find(node => node.id === edge.target);
    if (!sourceNode || !targetNode) continue;

    const sourceWidth = sourceNode.measured?.width ?? 150;
    const sourceHeight = sourceNode.measured?.height ?? 50;
    const targetHeight = targetNode.measured?.height ?? 50;
    const sourceX = sourceNode.position.x + sourceWidth;
    const sourceY = sourceNode.position.y + sourceHeight / 2;
    const targetX = targetNode.position.x;
    const targetY = targetNode.position.y + targetHeight / 2;

    const ax = position.x - sourceX;
    const ay = position.y - sourceY;
    const bx = targetX - sourceX;
    const by = targetY - sourceY;
    const dot = ax * bx + ay * by;
    const lenSq = bx * bx + by * by;

    let projection = -1;
    if (lenSq !== 0) {
      projection = dot / lenSq;
    }

    let nearestX: number;
    let nearestY: number;
    if (projection < 0) {
      nearestX = sourceX;
      nearestY = sourceY;
    } else if (projection > 1) {
      nearestX = targetX;
      nearestY = targetY;
    } else {
      nearestX = sourceX + projection * bx;
      nearestY = sourceY + projection * by;
    }

    const dx = position.x - nearestX;
    const dy = position.y - nearestY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < minDistance) {
      minDistance = distance;
      closestEdge = edge;
    }
  }

  return closestEdge;
}

export function findEdgeInsertionPlan({
  edge,
  nodeSpec,
  graphNodes,
  nodeSpecs,
  connections,
  typesCompatible,
  draggedNodeId,
}: FindEdgeInsertionPlanArgs): EdgeInsertionPlan | null {
  if (!edge || !nodeSpec || !edge.sourceHandle || !edge.targetHandle) return null;
  if (draggedNodeId && (edge.source === draggedNodeId || edge.target === draggedNodeId)) {
    return null;
  }

  const sourceSpec = findNodeSpec(edge.source, graphNodes, nodeSpecs);
  const targetSpec = findNodeSpec(edge.target, graphNodes, nodeSpecs);
  if (!sourceSpec || !targetSpec) return null;

  const sourceOutput = sourceSpec.outputs.find(output => output.name === edge.sourceHandle);
  const targetInput = targetSpec.inputs.find(input => input.name === edge.targetHandle);
  if (!sourceOutput || !targetInput) return null;

  const matchingInput = nodeSpec.inputs.find(input => typesCompatible(sourceOutput.ty, input.ty));
  const matchingOutput = nodeSpec.outputs.find(output => typesCompatible(output.ty, targetInput.ty));
  if (!matchingInput || !matchingOutput) return null;

  const replacedIncomingConnection = draggedNodeId
    ? connections.find(connection => connection.toNode === draggedNodeId && connection.toPort === matchingInput.name)
    : undefined;

  if (draggedNodeId) {
    const excludedConnectionIds = new Set<string>([edge.id]);
    if (replacedIncomingConnection) {
      excludedConnectionIds.add(replacedIncomingConnection.id);
    }

    if (hasPath(connections, draggedNodeId, edge.source, excludedConnectionIds)) {
      return null;
    }
    if (hasPath(connections, edge.target, draggedNodeId, excludedConnectionIds)) {
      return null;
    }
  }

  return {
    edge,
    inputPort: matchingInput,
    outputPort: matchingOutput,
    replacedIncomingConnectionId: replacedIncomingConnection?.id,
  };
}
