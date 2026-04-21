import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurvePoint, NodeInstance, NodeSpec, ParamValue } from '../store/types';

if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true });
}

vi.mock('../engine/wasmEngine', () => ({
  initWasmEngine: vi.fn(),
  wasmEngine: null,
}));

vi.mock('../components/nodes/BaseNode', () => ({
  BaseNode: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
}));

vi.mock('../components/nodes/CurveEditor', () => ({
  CurveEditor: ({ points }: { points: CurvePoint[] }) => React.createElement(
    'pre',
    { 'data-testid': 'curve-editor' },
    JSON.stringify(points),
  ),
}));

vi.mock('../components/nodes/nodeIcons', () => ({
  getNodeIcon: () => null,
}));

type GraphStore = typeof import('../store/graphStore')['useGraphStore'];
type DraftStoreModule = typeof import('../store/graphStore/nodeDraftStore');
type CurvesNodeComponent = typeof import('../components/nodes/CurvesNode')['CurvesNode'];

let useGraphStore: GraphStore;
let setDraftParam: DraftStoreModule['setDraftParam'];
let clearDraft: DraftStoreModule['clearDraft'];
let removeDraftStore: DraftStoreModule['removeDraftStore'];
let CurvesNode: CurvesNodeComponent;

const NODE_ID = 'node-curves';
const DEFAULT_POINTS: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
const LIVE_POINTS: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 0.4, y: 0.65 },
  { x: 1, y: 1 },
];

const CURVES_SPEC: NodeSpec = {
  id: 'curves',
  display_name: 'Curves',
  category: 'Color',
  description: 'Adjust tonal curves',
  inputs: [],
  outputs: [],
  params: [],
};

function createCurveParam(points: CurvePoint[]): ParamValue {
  return { CurvePoints: points };
}

function createCurvesNode(points: CurvePoint[]): NodeInstance {
  return {
    id: NODE_ID,
    typeId: 'curves',
    position: { x: 0, y: 0 },
    muted: false,
    params: {
      master_curve: createCurveParam(points),
      red_curve: createCurveParam(DEFAULT_POINTS),
      green_curve: createCurveParam(DEFAULT_POINTS),
      blue_curve: createCurveParam(DEFAULT_POINTS),
    },
    inputDefaults: {},
  } as unknown as NodeInstance;
}

function renderCurvesNode(committedNode: NodeInstance): string {
  return renderToStaticMarkup(React.createElement(CurvesNode, {
    id: NODE_ID,
    data: {
      label: 'Curves',
      spec: CURVES_SPEC,
      params: committedNode.params,
    },
  } as never));
}

function extractRenderedPoints(markup: string): CurvePoint[] {
  const match = markup.match(/<pre data-testid="curve-editor">(.+)<\/pre>/);
  if (!match) {
    throw new Error('CurveEditor output not found in rendered markup');
  }
  return JSON.parse(match[1].replaceAll('&quot;', '"')) as CurvePoint[];
}

beforeEach(async () => {
  vi.resetModules();

  const graphStoreMod = await import('../store/graphStore');
  const draftStoreMod = await import('../store/graphStore/nodeDraftStore');
  const curvesNodeMod = await import('../components/nodes/CurvesNode');

  useGraphStore = graphStoreMod.useGraphStore;
  setDraftParam = draftStoreMod.setDraftParam;
  clearDraft = draftStoreMod.clearDraft;
  removeDraftStore = draftStoreMod.removeDraftStore;
  CurvesNode = curvesNodeMod.CurvesNode;

  useGraphStore.setState({
    nodes: new Map([[NODE_ID, createCurvesNode(DEFAULT_POINTS)]]),
    connections: [],
    nodeTimings: new Map(),
    nodeErrors: new Map(),
  });
  clearDraft(NODE_ID);
});

afterEach(() => {
  clearDraft(NODE_ID);
  removeDraftStore(NODE_ID);
});

describe('CurvesNode', () => {
  it('renders live draft points while curve edits are in progress', () => {
    const committedNode = createCurvesNode(DEFAULT_POINTS);

    const initialMarkup = renderCurvesNode(committedNode);
    expect(extractRenderedPoints(initialMarkup)).toEqual(DEFAULT_POINTS);

    setDraftParam(NODE_ID, 'master_curve', createCurveParam(LIVE_POINTS));

    const updatedMarkup = renderCurvesNode(committedNode);
    expect(extractRenderedPoints(updatedMarkup)).toEqual(LIVE_POINTS);
  });
});
