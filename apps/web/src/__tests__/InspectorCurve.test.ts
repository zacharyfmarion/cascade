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

vi.mock('../components/nodes/CurveEditor', () => ({
  CurveEditor: ({ points }: { points: CurvePoint[] }) => React.createElement(
    'pre',
    { 'data-testid': 'curve-editor' },
    JSON.stringify(points),
  ),
}));

vi.mock('../components/ScriptNodeEditor', () => ({
  ScriptNodeEditor: () => null,
}));

type GraphStore = typeof import('../store/graphStore')['useGraphStore'];
type DraftStoreModule = typeof import('../store/graphStore/nodeDraftStore');
type NodeInspectorParamsComponent = typeof import('../components/Inspector')['NodeInspectorParams'];

let useGraphStore: GraphStore;
let setDraftParam: DraftStoreModule['setDraftParam'];
let clearDraft: DraftStoreModule['clearDraft'];
let removeDraftStore: DraftStoreModule['removeDraftStore'];
let NodeInspectorParams: NodeInspectorParamsComponent;

const NODE_ID = 'node-curves';
const DEFAULT_POINTS: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
const LIVE_POINTS: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 0.33, y: 0.7 },
  { x: 1, y: 1 },
];

const CURVE_PARAM_SPEC = {
  key: 'master_curve',
  label: 'Master',
  ty: 'Float',
  default: { CurvePoints: DEFAULT_POINTS },
  ui_hint: { type: 'CurveEditor' },
  promotable: true,
} as const;

const CURVES_SPEC: NodeSpec = {
  id: 'curves',
  display_name: 'Curves',
  category: 'Color',
  description: 'Adjust tonal curves',
  inputs: [],
  outputs: [],
  params: [CURVE_PARAM_SPEC as never],
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
    },
    inputDefaults: {},
  };
}

function extractRenderedPoints(markup: string): CurvePoint[] {
  const match = markup.match(/<pre data-testid="curve-editor">([\s\S]+?)<\/pre>/);
  if (!match) {
    throw new Error(`CurveEditor output not found in rendered markup:\n${markup}`);
  }
  return JSON.parse(match[1].replaceAll('&quot;', '"')) as CurvePoint[];
}

beforeEach(async () => {
  vi.resetModules();

  const graphStoreMod = await import('../store/graphStore');
  const draftStoreMod = await import('../store/graphStore/nodeDraftStore');

  useGraphStore = graphStoreMod.useGraphStore;
  setDraftParam = draftStoreMod.setDraftParam;
  clearDraft = draftStoreMod.clearDraft;
  removeDraftStore = draftStoreMod.removeDraftStore;

  useGraphStore.setState({
    nodes: new Map([[NODE_ID, createCurvesNode(DEFAULT_POINTS)]]),
  });
  clearDraft(NODE_ID);

  const inspectorMod = await import('../components/Inspector');
  NodeInspectorParams = inspectorMod.NodeInspectorParams;
});

afterEach(() => {
  clearDraft(NODE_ID);
  removeDraftStore(NODE_ID);
});

describe('Inspector curve params', () => {
  it('renders live draft curve points while editing', () => {
    const committedParams = createCurvesNode(DEFAULT_POINTS).params;

    const initialMarkup = renderToStaticMarkup(React.createElement(NodeInspectorParams, {
      nodeId: NODE_ID,
      spec: CURVES_SPEC,
      committedParams,
    }));
    expect(extractRenderedPoints(initialMarkup)).toEqual(DEFAULT_POINTS);

    setDraftParam(NODE_ID, 'master_curve', createCurveParam(LIVE_POINTS));

    const updatedMarkup = renderToStaticMarkup(React.createElement(NodeInspectorParams, {
      nodeId: NODE_ID,
      spec: CURVES_SPEC,
      committedParams,
    }));
    expect(extractRenderedPoints(updatedMarkup)).toEqual(LIVE_POINTS);
  });
});
