import { useGraphStore } from '../store/graphStore';
import type { NodeSpec, ParamValue } from '../store/types';
import type { GraphSnapshot, GraphSnapshotNode } from './types';

const isNonDefaultParam = (current: ParamValue | undefined, spec: NodeSpec['params'][number]): boolean => {
  if (!current) return false;
  return JSON.stringify(current) !== JSON.stringify(spec.default);
};

export const buildGraphSnapshot = (): GraphSnapshot => {
  const { nodes, connections, nodeSpecs, renderResults } = useGraphStore.getState();

  const snapshotNodes: GraphSnapshotNode[] = [];
  const viewerNodes: string[] = [];

  for (const [id, node] of nodes) {
    const spec = nodeSpecs.find(s => s.id === node.typeId);
    const nonDefaultParams: Record<string, ParamValue> = {};

    if (spec) {
      for (const paramSpec of spec.params) {
        const current = node.params[paramSpec.key];
        if (isNonDefaultParam(current, paramSpec)) {
          nonDefaultParams[paramSpec.key] = current;
        }
      }
    } else {
      for (const [key, value] of Object.entries(node.params)) {
        nonDefaultParams[key] = value;
      }
    }

    const connectedInputs: Record<string, { fromNode: string; fromPort: string }> = {};
    for (const conn of connections) {
      if (conn.toNode === id) {
        connectedInputs[conn.toPort] = { fromNode: conn.fromNode, fromPort: conn.fromPort };
      }
    }

    snapshotNodes.push({
      id,
      typeId: node.typeId,
      displayName: spec?.display_name ?? node.typeId,
      category: spec?.category ?? 'Unknown',
      params: nonDefaultParams,
      inputDefaults: node.inputDefaults,
      muted: node.muted,
      connectedInputs,
    });

    if (node.typeId === 'viewer') viewerNodes.push(id);
  }

  let renderDimensions: { width: number; height: number } | undefined;
  for (const viewerId of viewerNodes) {
    const result = renderResults.get(viewerId);
    if (result) {
      renderDimensions = { width: result.width, height: result.height };
      break;
    }
  }

  return {
    nodes: snapshotNodes,
    connections: connections.map(conn => ({
      fromNode: conn.fromNode,
      fromPort: conn.fromPort,
      toNode: conn.toNode,
      toPort: conn.toPort,
    })),
    viewerNodes,
    renderDimensions,
  };
};
