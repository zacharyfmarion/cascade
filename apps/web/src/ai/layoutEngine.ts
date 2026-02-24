/**
 * Sugiyama-style layered graph layout engine for DAG node editors.
 *
 * Produces left-to-right layouts with:
 *  - Longest-path layer assignment
 *  - Barycenter crossing reduction
 *  - Height-aware coordinate assignment (no overlaps)
 *  - Disconnected component stacking
 *
 * The layout function is pure and fully unit-testable.
 */

// ── Public types ────────────────────────────────────────────────

export interface LayoutNode {
  id: string;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface NodeSize {
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** Horizontal gap between columns (left edge of one column to left edge of the next). */
  columnSpacing?: number;
  /** Vertical gap between adjacent nodes within a column. */
  rowSpacing?: number;
  /** Gap between disconnected components stacked vertically. */
  componentSpacing?: number;
  /** Default node width when size is unknown. */
  defaultWidth?: number;
  /** Default node height when size is unknown. */
  defaultHeight?: number;
  /** Top-left origin x. */
  originX?: number;
  /** Top-left origin y. */
  originY?: number;
  /** Number of barycenter crossing-reduction sweeps (forward + backward = 1 iteration). */
  crossingReductionPasses?: number;
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
}

// ── Defaults ────────────────────────────────────────────────────

const DEFAULTS: Required<LayoutOptions> = {
  columnSpacing: 300,
  rowSpacing: 40,
  componentSpacing: 80,
  defaultWidth: 200,
  defaultHeight: 100,
  originX: 100,
  originY: 100,
  crossingReductionPasses: 4,
};

// ── Helpers ─────────────────────────────────────────────────────

/** Build adjacency lists and collect node ids from edges. */
function buildAdjacency(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): {
  nodeIds: Set<string>;
  downstream: Map<string, string[]>;
  upstream: Map<string, string[]>;
} {
  const nodeIds = new Set(nodes.map(n => n.id));
  const downstream = new Map<string, string[]>();
  const upstream = new Map<string, string[]>();

  for (const id of nodeIds) {
    downstream.set(id, []);
    upstream.set(id, []);
  }

  for (const edge of edges) {
    // Skip edges referencing unknown nodes.
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    downstream.get(edge.from)!.push(edge.to);
    upstream.get(edge.to)!.push(edge.from);
  }

  return { nodeIds, downstream, upstream };
}

// ── Phase 0: Decompose into connected components ────────────────

/**
 * Find connected components treating the graph as undirected.
 * Returns array of node-id sets, one per component.
 */
export function findComponents(
  nodeIds: Set<string>,
  downstream: Map<string, string[]>,
  upstream: Map<string, string[]>,
): Set<string>[] {
  const visited = new Set<string>();
  const components: Set<string>[] = [];

  for (const start of nodeIds) {
    if (visited.has(start)) continue;
    const component = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      component.add(id);
      for (const next of downstream.get(id) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
      for (const prev of upstream.get(id) ?? []) {
        if (!visited.has(prev)) queue.push(prev);
      }
    }
    components.push(component);
  }

  return components;
}

// ── Phase 1: Layer assignment (longest-path from sources) ───────

/**
 * Assign each node to a layer (column index) using a longest-path
 * algorithm from source nodes. This pushes nodes as far right as
 * their dependencies allow, producing a compact left-to-right flow.
 *
 * If cycles exist, back-edges are ignored for layering purposes.
 */
export function assignLayers(
  nodeIds: Set<string>,
  downstream: Map<string, string[]>,
  upstream: Map<string, string[]>,
): Map<string, number> {
  const layerMap = new Map<string, number>();
  const inDegree = new Map<string, number>();

  for (const id of nodeIds) {
    // Count only edges from within this component.
    const ups = (upstream.get(id) ?? []).filter(u => nodeIds.has(u));
    inDegree.set(id, ups.length);
  }

  // Kahn's algorithm — also handles cycles by processing what we can.
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const parentLayers = (upstream.get(id) ?? [])
      .filter(u => nodeIds.has(u) && layerMap.has(u))
      .map(u => layerMap.get(u)!);
    const layer = parentLayers.length > 0 ? Math.max(...parentLayers) + 1 : 0;
    layerMap.set(id, layer);

    for (const next of downstream.get(id) ?? []) {
      if (!nodeIds.has(next)) continue;
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  // Any unplaced nodes (from cycles) go into the last layer + 1.
  let maxLayer = 0;
  for (const layer of layerMap.values()) {
    if (layer > maxLayer) maxLayer = layer;
  }
  for (const id of nodeIds) {
    if (!layerMap.has(id)) {
      layerMap.set(id, maxLayer + 1);
    }
  }

  return layerMap;
}

/**
 * Build layers array from layer map: layers[i] = list of node ids in column i.
 */
export function buildLayerArrays(layerMap: Map<string, number>): string[][] {
  let maxLayer = 0;
  for (const layer of layerMap.values()) {
    if (layer > maxLayer) maxLayer = layer;
  }

  const layers: string[][] = [];
  for (let i = 0; i <= maxLayer; i++) {
    layers.push([]);
  }
  for (const [id, layer] of layerMap) {
    layers[layer].push(id);
  }
  return layers;
}

// ── Phase 2: Crossing reduction (barycenter heuristic) ──────────

/**
 * Count the number of edge crossings between two adjacent layers.
 * An edge crossing occurs when edge (a→c) and (b→d) cross, which
 * happens when a is above b in layer L but c is below d in layer L+1
 * (or vice-versa).
 */
export function countCrossings(
  leftLayer: string[],
  rightLayer: string[],
  downstream: Map<string, string[]>,
): number {
  const rightPos = new Map<string, number>();
  rightLayer.forEach((id, i) => rightPos.set(id, i));

  // Build sorted edge list: for each left node, collect positions of connected right nodes.
  const edgePositions: [number, number][] = [];
  for (let li = 0; li < leftLayer.length; li++) {
    for (const target of downstream.get(leftLayer[li]) ?? []) {
      const ri = rightPos.get(target);
      if (ri !== undefined) {
        edgePositions.push([li, ri]);
      }
    }
  }

  // Count inversions: O(n²) is fine for ≤30 nodes.
  let crossings = 0;
  for (let i = 0; i < edgePositions.length; i++) {
    for (let j = i + 1; j < edgePositions.length; j++) {
      const [a1, b1] = edgePositions[i];
      const [a2, b2] = edgePositions[j];
      if ((a1 < a2 && b1 > b2) || (a1 > a2 && b1 < b2)) {
        crossings++;
      }
    }
  }
  return crossings;
}

/**
 * Compute the barycenter (average position) of a node's neighbors
 * in the adjacent layer. Used to reorder nodes to reduce crossings.
 */
function barycenter(
  nodeId: string,
  neighborPositions: Map<string, number>,
  getNeighbors: (id: string) => string[],
): number | null {
  const neighbors = getNeighbors(nodeId).filter(n => neighborPositions.has(n));
  if (neighbors.length === 0) return null;
  const sum = neighbors.reduce((acc, n) => acc + neighborPositions.get(n)!, 0);
  return sum / neighbors.length;
}

/**
 * Perform one forward or backward sweep of barycenter ordering.
 * Returns the layers with nodes reordered to reduce crossings.
 */
function barycentricSweep(
  layers: string[][],
  downstream: Map<string, string[]>,
  upstream: Map<string, string[]>,
  direction: 'forward' | 'backward',
): string[][] {
  const result = layers.map(layer => [...layer]);

  const range = direction === 'forward'
    ? Array.from({ length: layers.length - 1 }, (_, i) => i + 1)
    : Array.from({ length: layers.length - 1 }, (_, i) => layers.length - 2 - i);

  for (const li of range) {
    const fixedLayer = direction === 'forward' ? result[li - 1] : result[li + 1];
    const freeLayer = result[li];

    // Build position map of fixed layer.
    const fixedPos = new Map<string, number>();
    fixedLayer.forEach((id, i) => fixedPos.set(id, i));

    // Compute barycenters for free layer nodes.
    const getNeighbors = direction === 'forward'
      ? (id: string) => (upstream.get(id) ?? [])
      : (id: string) => (downstream.get(id) ?? []);

    const barycenters = new Map<string, number>();
    for (const id of freeLayer) {
      const bc = barycenter(id, fixedPos, getNeighbors);
      if (bc !== null) {
        barycenters.set(id, bc);
      }
    }

    // Sort free layer by barycenter. Nodes without a barycenter keep their
    // relative position (stable sort).
    const indexed = freeLayer.map((id, i) => ({ id, originalIndex: i }));
    indexed.sort((a, b) => {
      const bcA = barycenters.get(a.id);
      const bcB = barycenters.get(b.id);
      if (bcA !== undefined && bcB !== undefined) return bcA - bcB;
      if (bcA !== undefined) return -1;
      if (bcB !== undefined) return 1;
      return a.originalIndex - b.originalIndex;
    });

    result[li] = indexed.map(e => e.id);
  }

  return result;
}

/**
 * Total crossings across all adjacent layer pairs.
 */
function totalCrossings(
  layers: string[][],
  downstream: Map<string, string[]>,
): number {
  let total = 0;
  for (let i = 0; i < layers.length - 1; i++) {
    total += countCrossings(layers[i], layers[i + 1], downstream);
  }
  return total;
}

/**
 * Reduce edge crossings using multiple barycenter sweeps.
 * Returns the best ordering found.
 */
export function reduceCrossings(
  layers: string[][],
  downstream: Map<string, string[]>,
  upstream: Map<string, string[]>,
  passes: number,
): string[][] {
  let best = layers.map(l => [...l]);
  let bestCount = totalCrossings(best, downstream);

  let current = best;

  for (let pass = 0; pass < passes; pass++) {
    // Forward sweep.
    current = barycentricSweep(current, downstream, upstream, 'forward');
    const fwdCount = totalCrossings(current, downstream);
    if (fwdCount < bestCount) {
      best = current.map(l => [...l]);
      bestCount = fwdCount;
    }

    // Backward sweep.
    current = barycentricSweep(current, downstream, upstream, 'backward');
    const bwdCount = totalCrossings(current, downstream);
    if (bwdCount < bestCount) {
      best = current.map(l => [...l]);
      bestCount = bwdCount;
    }

    // Early termination if we hit zero crossings.
    if (bestCount === 0) break;
  }

  return best;
}

// ── Phase 3: Coordinate assignment ──────────────────────────────

/**
 * Assign x,y coordinates to nodes. Nodes are placed left-to-right by layer,
 * top-to-bottom within each layer. Each layer is vertically centered around
 * the global vertical midpoint so edges are more horizontal.
 *
 * For each node, the position is the top-left corner (matching React Flow's convention).
 */
export function assignCoordinates(
  layers: string[][],
  nodeSizes: Map<string, NodeSize>,
  opts: Required<LayoutOptions>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  const getSize = (id: string): NodeSize => nodeSizes.get(id) ?? {
    width: opts.defaultWidth,
    height: opts.defaultHeight,
  };

  // First pass: compute the total height of each layer (sum of node heights + gaps).
  const layerHeights: number[] = [];
  for (const layer of layers) {
    let h = 0;
    for (let i = 0; i < layer.length; i++) {
      h += getSize(layer[i]).height;
      if (i < layer.length - 1) h += opts.rowSpacing;
    }
    layerHeights.push(h);
  }

  // The tallest layer determines the vertical centering baseline.
  const maxHeight = Math.max(...layerHeights, 0);
  const globalCenterY = opts.originY + maxHeight / 2;

  // Second pass: assign positions.
  let x = opts.originX;
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const layerHeight = layerHeights[li];

    // Center this layer vertically around the global center.
    let y = globalCenterY - layerHeight / 2;

    // Compute the widest node in this layer for column spacing.
    let maxWidth = 0;
    for (const id of layer) {
      const w = getSize(id).width;
      if (w > maxWidth) maxWidth = w;
    }

    for (const id of layer) {
      positions.set(id, { x, y });
      y += getSize(id).height + opts.rowSpacing;
    }

    x += Math.max(maxWidth, opts.defaultWidth) + (opts.columnSpacing - opts.defaultWidth);
  }

  return positions;
}

// ── Phase 4: Vertical compaction — pull children toward parents ──

/**
 * After initial coordinate assignment, adjust node positions within each layer
 * to reduce the total vertical distance of edges. For each node, compute the
 * ideal y (the center of its connected neighbors) and shift it toward that
 * ideal, constrained to avoid overlapping adjacent nodes in the same layer.
 *
 * This produces tighter, more readable layouts where a parent's children are
 * clustered vertically near it rather than spread across the full layer height.
 */
export function compactVertically(
  layers: string[][],
  positions: Map<string, { x: number; y: number }>,
  nodeSizes: Map<string, NodeSize>,
  downstream: Map<string, string[]>,
  upstream: Map<string, string[]>,
  opts: Required<LayoutOptions>,
): Map<string, { x: number; y: number }> {
  const result = new Map(positions);

  const getHeight = (id: string): number =>
    (nodeSizes.get(id)?.height ?? opts.defaultHeight);

  const centerY = (id: string): number => {
    const pos = result.get(id)!;
    return pos.y + getHeight(id) / 2;
  };

  // Multiple passes: forward then backward, to propagate improvements.
  for (let pass = 0; pass < 2; pass++) {
    // Forward pass: adjust each layer based on upstream neighbors.
    for (let li = 1; li < layers.length; li++) {
      const layer = layers[li];
      // Compute ideal center for each node based on upstream neighbors.
      const ideals = new Map<string, number>();
      for (const id of layer) {
        const ups = (upstream.get(id) ?? []).filter(u => result.has(u));
        if (ups.length > 0) {
          const avgCenter = ups.reduce((sum, u) => sum + centerY(u), 0) / ups.length;
          ideals.set(id, avgCenter);
        }
      }

      // Attempt to shift nodes toward their ideal, respecting order & no-overlap.
      shiftLayerTowardIdeals(layer, ideals, result, nodeSizes, opts);
    }

    // Backward pass: adjust each layer based on downstream neighbors.
    for (let li = layers.length - 2; li >= 0; li--) {
      const layer = layers[li];
      const ideals = new Map<string, number>();
      for (const id of layer) {
        const downs = (downstream.get(id) ?? []).filter(d => result.has(d));
        if (downs.length > 0) {
          const avgCenter = downs.reduce((sum, d) => sum + centerY(d), 0) / downs.length;
          ideals.set(id, avgCenter);
        }
      }
      shiftLayerTowardIdeals(layer, ideals, result, nodeSizes, opts);
    }
  }

  return result;
}

/**
 * Shift nodes in a single layer toward their ideal center positions,
 * preserving ordering and preventing overlaps.
 */
function shiftLayerTowardIdeals(
  layer: string[],
  ideals: Map<string, number>,
  positions: Map<string, { x: number; y: number }>,
  nodeSizes: Map<string, NodeSize>,
  opts: Required<LayoutOptions>,
): void {
  const getHeight = (id: string): number =>
    (nodeSizes.get(id)?.height ?? opts.defaultHeight);

  // For each node, compute target y (top-left) from ideal center.
  for (const id of layer) {
    const ideal = ideals.get(id);
    if (ideal === undefined) continue;
    const targetY = ideal - getHeight(id) / 2;
    positions.get(id)!.y = targetY;
  }

  // Fix overlaps: enforce top-to-bottom order with minimum spacing.
  for (let i = 1; i < layer.length; i++) {
    const prev = layer[i - 1];
    const curr = layer[i];
    const prevBottom = positions.get(prev)!.y + getHeight(prev) + opts.rowSpacing;
    if (positions.get(curr)!.y < prevBottom) {
      positions.get(curr)!.y = prevBottom;
    }
  }

  // Also enforce from bottom-up to allow upward shifting.
  for (let i = layer.length - 2; i >= 0; i--) {
    const curr = layer[i];
    const next = layer[i + 1];
    const maxY = positions.get(next)!.y - getHeight(curr) - opts.rowSpacing;
    if (positions.get(curr)!.y > maxY) {
      positions.get(curr)!.y = maxY;
    }
  }
}

// ── Main entry point ────────────────────────────────────────────

/**
 * Lay out a DAG left-to-right using a Sugiyama-style layered approach.
 *
 * Pure function — no side effects, fully unit-testable.
 *
 * @param nodes  List of nodes (only id is required).
 * @param edges  Directed edges (from → to).
 * @param nodeSizes  Measured node dimensions keyed by node id.
 * @param options  Spacing and origin configuration.
 * @returns Map of node id → { x, y } positions (top-left corner).
 */
export function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  nodeSizes: Map<string, NodeSize>,
  options?: LayoutOptions,
): LayoutResult {
  if (nodes.length === 0) {
    return { positions: new Map() };
  }

  const opts = { ...DEFAULTS, ...options };
  const { nodeIds, downstream, upstream } = buildAdjacency(nodes, edges);

  // Single-node shortcut.
  if (nodes.length === 1) {
    const id = nodes[0].id;
    return { positions: new Map([[id, { x: opts.originX, y: opts.originY }]]) };
  }

  // Decompose into connected components and layout each independently.
  const components = findComponents(nodeIds, downstream, upstream);

  // Sort components: larger components first, then by earliest node id for stability.
  components.sort((a, b) => {
    if (a.size !== b.size) return b.size - a.size;
    const minA = Math.min(...Array.from(a).map(id => nodes.findIndex(n => n.id === id)));
    const minB = Math.min(...Array.from(b).map(id => nodes.findIndex(n => n.id === id)));
    return minA - minB;
  });

  const allPositions = new Map<string, { x: number; y: number }>();
  let componentOffsetY = opts.originY;

  for (const component of components) {
    const compNodes = nodes.filter(n => component.has(n.id));
    const compEdges = edges.filter(e => component.has(e.from) && component.has(e.to));

    const compResult = layoutComponent(compNodes, compEdges, nodeSizes, downstream, upstream, opts);

    // Find the bounding box of this component's layout.
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [id, pos] of compResult) {
      const h = nodeSizes.get(id)?.height ?? opts.defaultHeight;
      if (pos.y < minY) minY = pos.y;
      if (pos.y + h > maxY) maxY = pos.y + h;
    }

    // Shift this component so it starts at componentOffsetY.
    const shiftY = componentOffsetY - minY;
    for (const [id, pos] of compResult) {
      allPositions.set(id, { x: pos.x, y: pos.y + shiftY });
    }

    const componentHeight = maxY - minY;
    componentOffsetY += componentHeight + opts.componentSpacing;
  }

  return { positions: allPositions };
}

/**
 * Layout a single connected component.
 */
function layoutComponent(
  nodes: LayoutNode[],
  _edges: LayoutEdge[],
  nodeSizes: Map<string, NodeSize>,
  downstream: Map<string, string[]>,
  upstream: Map<string, string[]>,
  opts: Required<LayoutOptions>,
): Map<string, { x: number; y: number }> {
  const componentIds = new Set(nodes.map(n => n.id));

  // Build component-local adjacency (filter to only edges within this component).
  const localDownstream = new Map<string, string[]>();
  const localUpstream = new Map<string, string[]>();
  for (const id of componentIds) {
    localDownstream.set(id, (downstream.get(id) ?? []).filter(d => componentIds.has(d)));
    localUpstream.set(id, (upstream.get(id) ?? []).filter(u => componentIds.has(u)));
  }

  // Phase 1: Layer assignment.
  const layerMap = assignLayers(componentIds, localDownstream, localUpstream);

  // Phase 2: Build layer arrays and reduce crossings.
  let layers = buildLayerArrays(layerMap);
  layers = reduceCrossings(layers, localDownstream, localUpstream, opts.crossingReductionPasses);

  // Phase 3: Coordinate assignment.
  let positions = assignCoordinates(layers, nodeSizes, opts);

  // Phase 4: Vertical compaction — pull children toward parents.
  positions = compactVertically(layers, positions, nodeSizes, localDownstream, localUpstream, opts);

  return positions;
}
