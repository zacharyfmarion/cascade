import { useGraphStore } from '../store/graphStore';

const COLUMN_SPACING = 300;
const ROW_SPACING = 150;
const START_X = 100;
const START_Y = 300;

export const autoLayoutGraph = (): void => {
  const { nodes, connections, setPosition } = useGraphStore.getState();

  const inDegree = new Map<string, number>();
  const downstream = new Map<string, string[]>();

  for (const [id] of nodes) {
    inDegree.set(id, 0);
    downstream.set(id, []);
  }

  for (const conn of connections) {
    if (!inDegree.has(conn.fromNode) || !inDegree.has(conn.toNode)) continue;
    const next = downstream.get(conn.fromNode);
    if (next) next.push(conn.toNode);
    inDegree.set(conn.toNode, (inDegree.get(conn.toNode) ?? 0) + 1);
  }

  const layers: string[][] = [];
  const nodeLayer = new Map<string, number>();
  const queue: string[] = [];

  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const layer = nodeLayer.get(current) ?? 0;
    while (layers.length <= layer) layers.push([]);
    layers[layer].push(current);
    nodeLayer.set(current, layer);

    for (const next of downstream.get(current) ?? []) {
      const nextLayer = Math.max(nodeLayer.get(next) ?? 0, layer + 1);
      nodeLayer.set(next, nextLayer);
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  const unplaced: string[] = [];
  for (const [id] of nodes) {
    if (!nodeLayer.has(id)) unplaced.push(id);
  }
  if (unplaced.length > 0) layers.push(unplaced);

  for (let col = 0; col < layers.length; col++) {
    const layer = layers[col];
    const x = START_X + col * COLUMN_SPACING;
    const totalHeight = (layer.length - 1) * ROW_SPACING;
    const topY = START_Y - totalHeight / 2;

    for (let row = 0; row < layer.length; row++) {
      const y = topY + row * ROW_SPACING;
      setPosition(layer[row], { x, y });
    }
  }
};
