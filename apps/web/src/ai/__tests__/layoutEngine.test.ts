import { describe, it, expect } from 'vitest';
import {
  layoutGraph,
  assignLayers,
  buildLayerArrays,
  countCrossings,
  reduceCrossings,
  assignCoordinates,
  compactVertically,
  findComponents,
} from '../layoutEngine';
import type { LayoutNode, LayoutEdge, NodeSize } from '../layoutEngine';

// ── Helpers ─────────────────────────────────────────────────────

function nodes(...ids: string[]): LayoutNode[] {
  return ids.map(id => ({ id }));
}

function edge(from: string, to: string): LayoutEdge {
  return { from, to };
}

function sizes(entries: Record<string, [number, number]>): Map<string, NodeSize> {
  const map = new Map<string, NodeSize>();
  for (const [id, [width, height]] of Object.entries(entries)) {
    map.set(id, { width, height });
  }
  return map;
}

function uniformSizes(ids: string[], w: number, h: number): Map<string, NodeSize> {
  const map = new Map<string, NodeSize>();
  for (const id of ids) map.set(id, { width: w, height: h });
  return map;
}

function nodesDoNotOverlap(
  positions: Map<string, { x: number; y: number }>,
  nodeSizes: Map<string, NodeSize>,
  defaultSize: NodeSize = { width: 200, height: 100 },
): boolean {
  const entries = Array.from(positions.entries());
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA, posA] = entries[i];
      const [idB, posB] = entries[j];
      const sizeA = nodeSizes.get(idA) ?? defaultSize;
      const sizeB = nodeSizes.get(idB) ?? defaultSize;

      const overlapX = posA.x < posB.x + sizeB.width && posA.x + sizeA.width > posB.x;
      const overlapY = posA.y < posB.y + sizeB.height && posA.y + sizeA.height > posB.y;

      if (overlapX && overlapY) return false;
    }
  }
  return true;
}

function flowsLeftToRight(
  positions: Map<string, { x: number; y: number }>,
  edges: LayoutEdge[],
): boolean {
  for (const e of edges) {
    const from = positions.get(e.from);
    const to = positions.get(e.to);
    if (from && to && from.x >= to.x) return false;
  }
  return true;
}

// ── Empty / trivial graphs ──────────────────────────────────────

describe('layoutGraph: trivial cases', () => {
  it('returns empty positions for empty graph', () => {
    const result = layoutGraph([], [], new Map());
    expect(result.positions.size).toBe(0);
  });

  it('places a single node at the origin', () => {
    const result = layoutGraph(nodes('a'), [], new Map(), { originX: 50, originY: 50 });
    expect(result.positions.get('a')).toEqual({ x: 50, y: 50 });
  });

  it('places two disconnected nodes without overlapping', () => {
    const ns = nodes('a', 'b');
    const sz = uniformSizes(['a', 'b'], 200, 100);
    const result = layoutGraph(ns, [], sz);
    expect(result.positions.size).toBe(2);
    expect(nodesDoNotOverlap(result.positions, sz)).toBe(true);
  });
});

// ── Linear chain (A → B → C) ───────────────────────────────────

describe('layoutGraph: linear chain', () => {
  const ns = nodes('a', 'b', 'c');
  const es = [edge('a', 'b'), edge('b', 'c')];
  const sz = uniformSizes(['a', 'b', 'c'], 200, 100);

  it('flows left to right', () => {
    const result = layoutGraph(ns, es, sz);
    expect(flowsLeftToRight(result.positions, es)).toBe(true);
  });

  it('assigns each node to a different column', () => {
    const result = layoutGraph(ns, es, sz);
    const xs = Array.from(result.positions.values()).map(p => p.x);
    expect(new Set(xs).size).toBe(3);
  });

  it('does not overlap', () => {
    const result = layoutGraph(ns, es, sz);
    expect(nodesDoNotOverlap(result.positions, sz)).toBe(true);
  });
});

// ── Fan-out (A → B, A → C, A → D) ──────────────────────────────

describe('layoutGraph: fan-out', () => {
  const ns = nodes('a', 'b', 'c', 'd');
  const es = [edge('a', 'b'), edge('a', 'c'), edge('a', 'd')];
  const sz = uniformSizes(['a', 'b', 'c', 'd'], 200, 100);

  it('places source in column 0, targets in column 1', () => {
    const result = layoutGraph(ns, es, sz);
    const posA = result.positions.get('a')!;
    const posB = result.positions.get('b')!;
    const posC = result.positions.get('c')!;
    const posD = result.positions.get('d')!;

    expect(posA.x).toBeLessThan(posB.x);
    expect(posB.x).toBe(posC.x);
    expect(posC.x).toBe(posD.x);
  });

  it('does not overlap targets', () => {
    const result = layoutGraph(ns, es, sz);
    expect(nodesDoNotOverlap(result.positions, sz)).toBe(true);
  });
});

// ── Fan-in (A → D, B → D, C → D) ──────────────────────────────

describe('layoutGraph: fan-in', () => {
  const ns = nodes('a', 'b', 'c', 'd');
  const es = [edge('a', 'd'), edge('b', 'd'), edge('c', 'd')];
  const sz = uniformSizes(['a', 'b', 'c', 'd'], 200, 100);

  it('places sources in column 0, target in column 1', () => {
    const result = layoutGraph(ns, es, sz);
    const posD = result.positions.get('d')!;
    for (const id of ['a', 'b', 'c']) {
      expect(result.positions.get(id)!.x).toBeLessThan(posD.x);
    }
  });

  it('does not overlap', () => {
    const result = layoutGraph(ns, es, sz);
    expect(nodesDoNotOverlap(result.positions, sz)).toBe(true);
  });
});

// ── Diamond (A → B, A → C, B → D, C → D) ──────────────────────

describe('layoutGraph: diamond', () => {
  const ns = nodes('a', 'b', 'c', 'd');
  const es = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
  const sz = uniformSizes(['a', 'b', 'c', 'd'], 200, 100);

  it('assigns 3 layers: [a], [b,c], [d]', () => {
    const result = layoutGraph(ns, es, sz);
    const posA = result.positions.get('a')!;
    const posB = result.positions.get('b')!;
    const posC = result.positions.get('c')!;
    const posD = result.positions.get('d')!;

    expect(posA.x).toBeLessThan(posB.x);
    expect(posB.x).toBe(posC.x);
    expect(posB.x).toBeLessThan(posD.x);
  });

  it('flows left to right and does not overlap', () => {
    const result = layoutGraph(ns, es, sz);
    expect(flowsLeftToRight(result.positions, es)).toBe(true);
    expect(nodesDoNotOverlap(result.positions, sz)).toBe(true);
  });
});

// ── Variable node heights ───────────────────────────────────────

describe('layoutGraph: variable heights', () => {
  const ns = nodes('a', 'b', 'c');
  const es = [edge('a', 'b'), edge('a', 'c')];
  const sz = sizes({ a: [200, 80], b: [200, 300], c: [200, 80] });

  it('does not overlap despite very tall node B', () => {
    const result = layoutGraph(ns, es, sz);
    expect(nodesDoNotOverlap(result.positions, sz)).toBe(true);
  });

  it('tall node gets enough vertical space', () => {
    const result = layoutGraph(ns, es, sz);
    const posB = result.positions.get('b')!;
    const posC = result.positions.get('c')!;
    // B (300px tall) and C (80px tall) should not overlap vertically
    expect(posB.y + 300 <= posC.y || posC.y + 80 <= posB.y).toBe(true);
  });
});

// ── Disconnected components ─────────────────────────────────────

describe('layoutGraph: disconnected components', () => {
  it('stacks disconnected components vertically', () => {
    const ns = nodes('a', 'b', 'c', 'd');
    const es = [edge('a', 'b'), edge('c', 'd')];
    const sz = uniformSizes(['a', 'b', 'c', 'd'], 200, 100);

    const result = layoutGraph(ns, es, sz);
    expect(result.positions.size).toBe(4);
    expect(nodesDoNotOverlap(result.positions, sz)).toBe(true);
  });

  it('handles fully isolated nodes', () => {
    const ns = nodes('x', 'y', 'z');
    const sz = uniformSizes(['x', 'y', 'z'], 200, 100);
    const result = layoutGraph(ns, [], sz);
    expect(result.positions.size).toBe(3);
    expect(nodesDoNotOverlap(result.positions, sz)).toBe(true);
  });
});

// ── Crossing reduction ──────────────────────────────────────────

describe('crossing reduction', () => {
  it('reduces crossings on a simple X-pattern', () => {
    // A→D, B→C creates an X-crossing if order is [A,B] → [C,D].
    // Optimal is [A,B] → [D,C] (or [B,A] → [C,D]).
    const downstream = new Map<string, string[]>();
    downstream.set('a', ['d']);
    downstream.set('b', ['c']);
    downstream.set('c', []);
    downstream.set('d', []);

    const upstream = new Map<string, string[]>();
    upstream.set('a', []);
    upstream.set('b', []);
    upstream.set('c', ['b']);
    upstream.set('d', ['a']);

    const crossingsBefore = countCrossings(['a', 'b'], ['c', 'd'], downstream);
    expect(crossingsBefore).toBe(1);

    const layers = [['a', 'b'], ['c', 'd']];
    const reduced = reduceCrossings(layers, downstream, upstream, 4);
    const crossingsAfter = countCrossings(reduced[0], reduced[1], downstream);
    expect(crossingsAfter).toBe(0);
  });

  it('countCrossings returns 0 for parallel edges', () => {
    const downstream = new Map<string, string[]>();
    downstream.set('a', ['c']);
    downstream.set('b', ['d']);

    const crossings = countCrossings(['a', 'b'], ['c', 'd'], downstream);
    expect(crossings).toBe(0);
  });

  it('countCrossings detects crossing in reversed order', () => {
    const downstream = new Map<string, string[]>();
    downstream.set('a', ['d']);
    downstream.set('b', ['c']);

    const crossings = countCrossings(['a', 'b'], ['c', 'd'], downstream);
    expect(crossings).toBe(1);
  });
});

// ── Layer assignment ────────────────────────────────────────────

describe('assignLayers', () => {
  it('assigns source nodes to layer 0', () => {
    const ids = new Set(['a', 'b', 'c']);
    const downstream = new Map([['a', ['b']], ['b', ['c']], ['c', []]]);
    const upstream = new Map([['a', []], ['b', ['a']], ['c', ['b']]]);

    const layers = assignLayers(ids, downstream, upstream);
    expect(layers.get('a')).toBe(0);
    expect(layers.get('b')).toBe(1);
    expect(layers.get('c')).toBe(2);
  });

  it('handles multiple roots', () => {
    const ids = new Set(['a', 'b', 'c']);
    const downstream = new Map([['a', ['c']], ['b', ['c']], ['c', []]]);
    const upstream = new Map([['a', []], ['b', []], ['c', ['a', 'b']]]);

    const layers = assignLayers(ids, downstream, upstream);
    expect(layers.get('a')).toBe(0);
    expect(layers.get('b')).toBe(0);
    expect(layers.get('c')).toBe(1);
  });

  it('pushes nodes to deepest possible layer', () => {
    // a → b → d, a → c → d
    const ids = new Set(['a', 'b', 'c', 'd']);
    const downstream = new Map([['a', ['b', 'c']], ['b', ['d']], ['c', ['d']], ['d', []]]);
    const upstream = new Map([['a', []], ['b', ['a']], ['c', ['a']], ['d', ['b', 'c']]]);

    const layers = assignLayers(ids, downstream, upstream);
    expect(layers.get('a')).toBe(0);
    expect(layers.get('b')).toBe(1);
    expect(layers.get('c')).toBe(1);
    expect(layers.get('d')).toBe(2);
  });
});

// ── buildLayerArrays ────────────────────────────────────────────

describe('buildLayerArrays', () => {
  it('groups nodes by layer', () => {
    const layerMap = new Map([['a', 0], ['b', 1], ['c', 1], ['d', 2]]);
    const arrays = buildLayerArrays(layerMap);
    expect(arrays.length).toBe(3);
    expect(arrays[0]).toContain('a');
    expect(arrays[1]).toContain('b');
    expect(arrays[1]).toContain('c');
    expect(arrays[2]).toContain('d');
  });
});

// ── findComponents ──────────────────────────────────────────────

describe('findComponents', () => {
  it('finds single component in connected graph', () => {
    const ids = new Set(['a', 'b', 'c']);
    const downstream = new Map([['a', ['b']], ['b', ['c']], ['c', []]]);
    const upstream = new Map([['a', []], ['b', ['a']], ['c', ['b']]]);

    const comps = findComponents(ids, downstream, upstream);
    expect(comps.length).toBe(1);
    expect(comps[0].size).toBe(3);
  });

  it('finds two components', () => {
    const ids = new Set(['a', 'b', 'c', 'd']);
    const downstream = new Map([['a', ['b']], ['b', []], ['c', ['d']], ['d', []]]);
    const upstream = new Map([['a', []], ['b', ['a']], ['c', []], ['d', ['c']]]);

    const comps = findComponents(ids, downstream, upstream);
    expect(comps.length).toBe(2);
  });

  it('treats isolated nodes as individual components', () => {
    const ids = new Set(['a', 'b', 'c']);
    const downstream = new Map([['a', []], ['b', []], ['c', []]]);
    const upstream = new Map([['a', []], ['b', []], ['c', []]]);

    const comps = findComponents(ids, downstream, upstream);
    expect(comps.length).toBe(3);
  });
});

// ── Coordinate assignment with variable heights ─────────────────

describe('assignCoordinates', () => {
  const opts = {
    columnSpacing: 300,
    rowSpacing: 40,
    componentSpacing: 80,
    defaultWidth: 200,
    defaultHeight: 100,
    originX: 0,
    originY: 0,
    crossingReductionPasses: 4,
  } as const;

  it('spaces columns by columnSpacing', () => {
    const layers = [['a'], ['b']];
    const sz = uniformSizes(['a', 'b'], 200, 100);
    const positions = assignCoordinates(layers, sz, opts);
    expect(positions.get('a')!.x).toBe(0);
    expect(positions.get('b')!.x).toBe(300);
  });

  it('stacks nodes within a layer with rowSpacing', () => {
    const layers = [['a', 'b']];
    const sz = uniformSizes(['a', 'b'], 200, 100);
    const positions = assignCoordinates(layers, sz, opts);

    const posA = positions.get('a')!;
    const posB = positions.get('b')!;
    expect(posB.y - (posA.y + 100)).toBe(40);
  });

  it('handles variable heights without overlap', () => {
    const layers = [['a', 'b', 'c']];
    const sz = sizes({ a: [200, 80], b: [200, 300], c: [200, 80] });
    const positions = assignCoordinates(layers, sz, opts);

    const posA = positions.get('a')!;
    const posB = positions.get('b')!;
    const posC = positions.get('c')!;

    expect(posB.y).toBeGreaterThanOrEqual(posA.y + 80 + 40);
    expect(posC.y).toBeGreaterThanOrEqual(posB.y + 300 + 40);
  });
});

// ── Vertical compaction ─────────────────────────────────────────

describe('compactVertically', () => {
  const opts = {
    columnSpacing: 300,
    rowSpacing: 40,
    componentSpacing: 80,
    defaultWidth: 200,
    defaultHeight: 100,
    originX: 0,
    originY: 0,
    crossingReductionPasses: 4,
  } as const;

  it('pulls children toward parent vertical center', () => {
    // Parent A at center, children B,C,D spread out.
    // After compaction, children should cluster around A's center.
    const layers = [['a'], ['b', 'c', 'd']];
    const sz = uniformSizes(['a', 'b', 'c', 'd'], 200, 100);
    const downstream = new Map([['a', ['b', 'c', 'd']], ['b', []], ['c', []], ['d', []]]);
    const upstream = new Map([['a', []], ['b', ['a']], ['c', ['a']], ['d', ['a']]]);

    const initial = assignCoordinates(layers, sz, opts);
    const compacted = compactVertically(layers, initial, sz, downstream, upstream, opts);

    const parentCenter = compacted.get('a')!.y + 50;
    const childCenters = ['b', 'c', 'd'].map(id => compacted.get(id)!.y + 50);
    const avgChildCenter = childCenters.reduce((s, c) => s + c, 0) / 3;

    // Average child center should be close to parent center.
    expect(Math.abs(avgChildCenter - parentCenter)).toBeLessThan(200);
  });

  it('preserves no-overlap after compaction', () => {
    const layers = [['a'], ['b', 'c']];
    const sz = sizes({ a: [200, 80], b: [200, 200], c: [200, 80] });
    const downstream = new Map([['a', ['b', 'c']], ['b', []], ['c', []]]);
    const upstream = new Map([['a', []], ['b', ['a']], ['c', ['a']]]);

    const initial = assignCoordinates(layers, sz, opts);
    const compacted = compactVertically(layers, initial, sz, downstream, upstream, opts);

    expect(nodesDoNotOverlap(compacted, sz)).toBe(true);
  });
});

// ── Realistic Cascade graph ─────────────────────────────────────

describe('layoutGraph: realistic Cascade pipeline', () => {
  // LoadImage → Blur → BrightnessContrast → Viewer
  //                  → Sharpen → Blend → Viewer
  //                                ↑
  // LoadImage2 ────────────────────┘
  const ns = nodes('load1', 'blur', 'bc', 'sharpen', 'blend', 'viewer', 'load2');
  const es = [
    edge('load1', 'blur'),
    edge('blur', 'bc'),
    edge('blur', 'sharpen'),
    edge('bc', 'viewer'),
    edge('sharpen', 'blend'),
    edge('load2', 'blend'),
    edge('blend', 'viewer'),
  ];
  const sz = sizes({
    load1: [200, 120],
    blur: [200, 100],
    bc: [200, 140],
    sharpen: [200, 100],
    blend: [200, 120],
    viewer: [200, 200],
    load2: [200, 120],
  });

  it('positions all nodes', () => {
    const result = layoutGraph(ns, es, sz);
    expect(result.positions.size).toBe(7);
  });

  it('flows left to right', () => {
    const result = layoutGraph(ns, es, sz);
    expect(flowsLeftToRight(result.positions, es)).toBe(true);
  });

  it('does not overlap', () => {
    const result = layoutGraph(ns, es, sz);
    expect(nodesDoNotOverlap(result.positions, sz)).toBe(true);
  });

  it('places load nodes in leftmost columns', () => {
    const result = layoutGraph(ns, es, sz);
    const load1X = result.positions.get('load1')!.x;
    const load2X = result.positions.get('load2')!.x;
    const viewerX = result.positions.get('viewer')!.x;
    expect(load1X).toBeLessThan(viewerX);
    expect(load2X).toBeLessThan(viewerX);
  });
});

// ── Edge case: nodes with no size data ──────────────────────────

describe('layoutGraph: missing size data', () => {
  it('uses defaults when nodeSizes is empty', () => {
    const ns = nodes('a', 'b', 'c');
    const es = [edge('a', 'b'), edge('b', 'c')];
    const result = layoutGraph(ns, es, new Map());
    expect(result.positions.size).toBe(3);
    expect(flowsLeftToRight(result.positions, es)).toBe(true);
  });
});

// ── Edge case: edges referencing unknown nodes ──────────────────

describe('layoutGraph: orphan edges', () => {
  it('ignores edges to unknown nodes', () => {
    const ns = nodes('a', 'b');
    const es = [edge('a', 'b'), edge('a', 'nonexistent')];
    const sz = uniformSizes(['a', 'b'], 200, 100);
    const result = layoutGraph(ns, es, sz);
    expect(result.positions.size).toBe(2);
  });
});

// ── Large graph stress test ─────────────────────────────────────

describe('layoutGraph: performance', () => {
  it('handles 30-node chain in <100ms', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `n${i}`);
    const ns = nodes(...ids);
    const es = ids.slice(1).map((id, i) => edge(ids[i], id));
    const sz = uniformSizes(ids, 200, 100);

    const start = performance.now();
    const result = layoutGraph(ns, es, sz);
    const elapsed = performance.now() - start;

    expect(result.positions.size).toBe(30);
    expect(elapsed).toBeLessThan(100);
    expect(flowsLeftToRight(result.positions, es)).toBe(true);
    expect(nodesDoNotOverlap(result.positions, sz)).toBe(true);
  });

  it('handles 30-node wide fan-out in <100ms', () => {
    const root = 'root';
    const children = Array.from({ length: 29 }, (_, i) => `c${i}`);
    const ns = nodes(root, ...children);
    const es = children.map(c => edge(root, c));
    const sz = uniformSizes([root, ...children], 200, 100);

    const start = performance.now();
    const result = layoutGraph(ns, es, sz);
    const elapsed = performance.now() - start;

    expect(result.positions.size).toBe(30);
    expect(elapsed).toBeLessThan(100);
    expect(nodesDoNotOverlap(result.positions, sz)).toBe(true);
  });
});

// ── Custom options ──────────────────────────────────────────────

describe('layoutGraph: custom options', () => {
  it('respects custom columnSpacing', () => {
    const ns = nodes('a', 'b');
    const es = [edge('a', 'b')];
    const sz = uniformSizes(['a', 'b'], 200, 100);

    const result = layoutGraph(ns, es, sz, { columnSpacing: 500 });
    const posA = result.positions.get('a')!;
    const posB = result.positions.get('b')!;
    expect(posB.x - posA.x).toBe(500);
  });

  it('respects custom origin', () => {
    const ns = nodes('a');
    const result = layoutGraph(ns, [], new Map(), { originX: 200, originY: 300 });
    expect(result.positions.get('a')).toEqual({ x: 200, y: 300 });
  });
});
