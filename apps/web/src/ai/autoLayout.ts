import { useGraphStore } from '../store/graphStore';
import { layoutGraph } from './layoutEngine';
import type { LayoutNode, LayoutEdge, NodeSize } from './layoutEngine';

export type NodeSizeProvider = () => Map<string, { width: number; height: number }>;

let registeredSizeProvider: NodeSizeProvider | null = null;

export const registerNodeSizeProvider = (provider: NodeSizeProvider): void => {
  registeredSizeProvider = provider;
};

export const unregisterNodeSizeProvider = (): void => {
  registeredSizeProvider = null;
};

export const autoLayoutGraph = (
  measuredSizes?: Map<string, { width: number; height: number }>,
): void => {
  const { nodes, connections, setPosition } = useGraphStore.getState();

  if (nodes.size === 0) return;

  const layoutNodes: LayoutNode[] = [];
  for (const [id] of nodes) {
    layoutNodes.push({ id });
  }

  const layoutEdges: LayoutEdge[] = [];
  for (const conn of connections) {
    if (!nodes.has(conn.fromNode) || !nodes.has(conn.toNode)) continue;
    layoutEdges.push({ from: conn.fromNode, to: conn.toNode });
  }

  const sizes = measuredSizes ?? registeredSizeProvider?.() ?? new Map();
  const nodeSizes = new Map<string, NodeSize>();
  for (const [id, size] of sizes) {
    nodeSizes.set(id, size);
  }

  const result = layoutGraph(layoutNodes, layoutEdges, nodeSizes);

  for (const [id, pos] of result.positions) {
    setPosition(id, pos);
  }
};
