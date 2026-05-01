import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, NodeInstance, NodeSpec, ParamValue, SerializableGroupDefinition, ViewerResult } from '../../../store/types';
import { isConnectableParam } from '../../../store/types';
import type { EngineBridge } from '../../../engine/bridge';
import { createMockEngine, resetNodeCounter } from '../../../__tests__/engineMock';
import { HandleMap } from '../handleMap';
import { customDefinitionToNodeSpec, parseDsl } from '../parser';
import { validateAst } from '../validator';
import { serializeGraph } from '../serializer';
import { semanticEquivalenceFixtures, type SemanticEquivalenceFixture } from './fixtures/semanticEquivalence';

if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true });
}

let mockEngine = createMockEngine();

vi.mock('../../../engine/wasmEngine', () => ({
  initWasmEngine: vi.fn(),
  get wasmEngine() {
    return mockEngine;
  },
}));

type GraphStore = typeof import('../../../store/graphStore')['useGraphStore'];
type ApplyDsl = typeof import('../executor')['applyDsl'];
type GraphState = ReturnType<GraphStore['getState']>;

let useGraphStore: GraphStore;
let applyDsl: ApplyDsl;
let activeHandleMap: HandleMap | null = null;

const createInitialState = () => ({
  nodes: new Map<string, NodeInstance>(),
  connections: [] as Connection[],
  selectedNodeIds: new Set<string>(),
  frames: new Map(),
  selectedFrameId: null,
  nodeSpecs: [] as NodeSpec[],
  nodeSpecsById: new Map<string, NodeSpec>(),
  engineReady: false,
  renderResults: new Map(),
  lastError: null,
  canUndo: false,
  canRedo: false,
  currentFrame: 0,
  renderProgress: null,
  isRendering: false,
  previewScale: 1,
  dirty: false,
  fitViewRequestId: 0,
  projectSessionRevision: 0,
  hasSequenceNodes: false,
  sequenceLength: 0,
  sequenceStart: 0,
  sequenceInfoMap: new Map(),
  isPlaying: false,
  fps: 24,
  loopPlayback: true,
  playbackFps: null as number | null,
  toasts: [],
  editingStack: [{ id: 'root', label: 'Root', groupNodeId: null }],
  nodeTimings: new Map(),
  nodeErrors: new Map(),
  dslShadow: null,
  customGroupDefinitions: [],
  graphRevision: 0,
  lastTransactionOrigin: null,
});

const normalizeValue = (value: unknown): unknown => {
  if (value instanceof Uint8ClampedArray || value instanceof Uint8Array) {
    return Array.from(value);
  }
  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries())
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
        .map(([key, item]) => [key, normalizeValue(item)]),
    );
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'position')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalizeValue(item)]),
    );
  }
  return value;
};

const sortedRecord = (record: Record<string, ParamValue> | undefined): Record<string, unknown> =>
  normalizeValue(record ?? {}) as Record<string, unknown>;

const nodeHandle = (handleMap: HandleMap, nodeId: string): string =>
  handleMap.getHandle(nodeId) ?? `unmapped:${nodeId}`;

const canonicalEffectiveParams = (
  node: Pick<NodeInstance, 'typeId' | 'params' | 'inputDefaults'>,
  nodeSpecById: Map<string, NodeSpec>,
) => {
  const spec = nodeSpecById.get(node.typeId);
  const keys = new Set([
    ...Object.keys(node.params ?? {}),
    ...Object.keys(node.inputDefaults ?? {}),
  ]);
  const values: Record<string, ParamValue> = {};
  for (const key of keys) {
    const paramSpec = spec?.params.find(param => param.key === key);
    const value = paramSpec && isConnectableParam(paramSpec)
      ? node.inputDefaults[key] ?? node.params[key]
      : node.params[key] ?? node.inputDefaults[key];
    if (value !== undefined) {
      values[key] = value;
    }
  }
  return sortedRecord(values);
};

const internalNodeAliases = (definition: SerializableGroupDefinition): Map<string, string> => {
  const aliases = new Map<string, string>();
  const semanticNodes = definition.internal_graph.nodes
    .filter(node => {
      if (node.type_id === 'group_input') {
        aliases.set(node.id, 'input');
        return false;
      }
      if (node.type_id === 'group_output') {
        aliases.set(node.id, 'output');
        return false;
      }
      return true;
    })
    .sort((a, b) => `${a.type_id}:${a.id}`.localeCompare(`${b.type_id}:${b.id}`));

  semanticNodes.forEach((node, index) => {
    aliases.set(node.id, `node${index + 1}`);
  });
  return aliases;
};

const canonicalGroupDefinitions = (
  definitions: SerializableGroupDefinition[],
  nodeSpecById: Map<string, NodeSpec>,
) =>
  definitions
    .map(definition => {
      const aliases = internalNodeAliases(definition);
      return {
        id: definition.id,
        name: definition.name,
        category: definition.category,
        description: definition.description,
        inputs: normalizeValue(definition.explicit_inputs ?? []),
        outputs: normalizeValue(definition.explicit_outputs ?? []),
        promotions: normalizeValue((definition.promotions ?? []).map(promotion => ({
          ...promotion,
          internal_node_id: aliases.get(promotion.internal_node_id) ?? promotion.internal_node_id,
        }))),
        nodes: definition.internal_graph.nodes
          .map(node => ({
            id: aliases.get(node.id) ?? node.id,
            typeId: node.type_id,
            muted: Boolean(node.muted),
            params: canonicalEffectiveParams({
              typeId: node.type_id,
              params: node.params ?? {},
              inputDefaults: node.input_defaults ?? {},
            }, nodeSpecById),
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        connections: definition.internal_graph.connections
          .map(connection => `${aliases.get(connection.from_node) ?? connection.from_node}.${connection.from_port}->${aliases.get(connection.to_node) ?? connection.to_node}.${connection.to_port}`)
          .sort(),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

const canonicalGraph = (state: GraphState, handleMap: HandleMap) => {
  const nodeSpecById = new Map(state.nodeSpecs.map(spec => [spec.id, spec]));
  return {
    nodes: Array.from(state.nodes.entries())
      .map(([nodeId, node]) => ({
        handle: nodeHandle(handleMap, nodeId),
        typeId: node.typeId,
        muted: node.muted,
        params: canonicalEffectiveParams(node, nodeSpecById),
      }))
      .sort((a, b) => a.handle.localeCompare(b.handle)),
    connections: state.connections
      .map(connection => `${nodeHandle(handleMap, connection.fromNode)}.${connection.fromPort}->${nodeHandle(handleMap, connection.toNode)}.${connection.toPort}`)
      .sort(),
    groupDefinitions: canonicalGroupDefinitions(state.customGroupDefinitions, nodeSpecById),
  };
};

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const deterministicViewerResult = (viewerNodeId: string): ViewerResult | null => {
  if (!activeHandleMap || !useGraphStore) return null;
  const state = useGraphStore.getState();
  const viewer = state.nodes.get(viewerNodeId);
  if (!viewer || viewer.typeId !== 'viewer') return null;
  const canonical = canonicalGraph(state, activeHandleMap);
  const viewerHandle = nodeHandle(activeHandleMap, viewerNodeId);
  const hash = hashString(JSON.stringify({ viewer: viewerHandle, canonical }));
  return {
    type: 'image',
    nodeId: viewerNodeId,
    width: 2,
    height: 1,
    pixels: new Uint8ClampedArray([
      hash & 0xff,
      (hash >> 8) & 0xff,
      (hash >> 16) & 0xff,
      255,
      (hash >> 24) & 0xff,
      (hash >> 12) & 0xff,
      (hash >> 4) & 0xff,
      255,
    ]),
  };
};

const installDeterministicRenderer = () => {
  vi.spyOn(mockEngine as EngineBridge, 'renderViewer').mockImplementation((viewerNodeId) =>
    deterministicViewerResult(viewerNodeId),
  );
};

const parseAndValidate = (dsl: string, nodeSpecs: NodeSpec[], phase: string) => {
  const parseResult = parseDsl(dsl, nodeSpecs);
  expect(parseResult.errors, `${phase}: parser gap`).toEqual([]);
  expect(parseResult.ast, `${phase}: parser did not return an AST`).not.toBeNull();
  const customSpecs = parseResult.ast?.customNodes
    ? Array.from(parseResult.ast.customNodes.values()).map(customDefinitionToNodeSpec)
    : [];
  const validation = validateAst(parseResult.ast!, [...nodeSpecs, ...customSpecs]);
  expect(validation.errors, `${phase}: validation gap`).toEqual([]);
  return parseResult.ast!;
};

const resetHarness = async () => {
  vi.resetModules();
  mockEngine = createMockEngine();
  const storeMod = await import('../../../store/graphStore');
  const executorMod = await import('../executor');
  useGraphStore = storeMod.useGraphStore;
  applyDsl = executorMod.applyDsl;
  useGraphStore.setState(createInitialState());
  resetNodeCounter();
  activeHandleMap = null;
  await useGraphStore.getState().initEngine();
  installDeterministicRenderer();
};

const setMuted = async (nodeId: string, muted: boolean) => {
  if (!muted) return;
  const store = useGraphStore.getState();
  store.setSelectedNodes([nodeId]);
  await store.toggleMuteSelected();
  store.setSelectedNodes([]);
};

const loadRuntimeFixture = async (fixture: SemanticEquivalenceFixture): Promise<HandleMap> => {
  const store = useGraphStore.getState();
  const handleMap = new HandleMap();

  for (const definition of fixture.runtime.groupDefinitions ?? []) {
    const spec = await store.registerGroupDefinition(JSON.stringify(definition));
    expect(spec, `RUNTIME SETUP GAP (${fixture.name}): group definition failed to register`).not.toBeNull();
  }

  for (const node of fixture.runtime.nodes) {
    const nodeId = await store.addNode(node.typeId, { x: 0, y: 0 });
    handleMap.set(node.handle, nodeId);
    for (const [key, value] of Object.entries(node.params ?? {})) {
      await store.setParam(nodeId, key, value);
    }
    for (const [key, value] of Object.entries(node.inputDefaults ?? {})) {
      await store.setInputDefault(nodeId, key, value);
    }
    await setMuted(nodeId, Boolean(node.muted));
  }

  for (const connection of fixture.runtime.connections) {
    const fromNode = handleMap.getNodeId(connection.fromHandle);
    const toNode = handleMap.getNodeId(connection.toHandle);
    expect(fromNode, `RUNTIME SETUP GAP (${fixture.name}): missing from handle ${connection.fromHandle}`).toBeDefined();
    expect(toNode, `RUNTIME SETUP GAP (${fixture.name}): missing to handle ${connection.toHandle}`).toBeDefined();
    await store.connect(fromNode!, connection.fromPort, toNode!, connection.toPort);
  }

  return handleMap;
};

const evaluateOutputs = async (handleMap: HandleMap) => {
  activeHandleMap = handleMap;
  const store = useGraphStore.getState();
  store.triggerAllViewers();
  await store.flushRender();
  const outputs: Array<[string, unknown]> = Array.from(useGraphStore.getState().renderResults.entries())
    .map(([nodeId, result]) => [
      nodeHandle(handleMap, nodeId),
      normalizeValue({ ...result, nodeId: nodeHandle(handleMap, nodeId) }),
    ]);
  return Object.fromEntries(
    outputs.sort(([a], [b]) => a.localeCompare(b)),
  );
};

const serializeRuntimeGraph = (handleMap: HandleMap): string => {
  const store = useGraphStore.getState();
  return serializeGraph({
    nodes: store.nodes,
    connections: store.connections,
    nodeSpecs: store.nodeSpecs,
    handleMap,
    groupDefinitions: store.customGroupDefinitions,
    pruneUnusedCustomDefinitions: true,
  });
};

const applyDslFixture = async (dsl: string, phase: string): Promise<HandleMap> => {
  const store = useGraphStore.getState();
  const handleMap = new HandleMap();
  activeHandleMap = handleMap;
  parseAndValidate(dsl, store.nodeSpecs, phase);
  const result = await applyDsl(
    dsl,
    handleMap,
    store.nodeSpecs,
    store.nodes,
    store.connections,
    { origin: 'dsl', awaitRender: false, suppressUndo: true },
  );
  expect(result, `${phase}: runtime apply gap`).toMatchObject({ success: true });
  return handleMap;
};

describe('DSL semantic equivalence with graph runtime fixtures', () => {
  beforeEach(resetHarness);

  it.each(semanticEquivalenceFixtures)('$name', async (fixture) => {
    const runtimeHandleMap = await loadRuntimeFixture(fixture);
    const runtimeGraph = canonicalGraph(useGraphStore.getState(), runtimeHandleMap);
    const runtimeOutputs = await evaluateOutputs(runtimeHandleMap);
    const serializedRuntimeDsl = serializeRuntimeGraph(runtimeHandleMap);

    parseAndValidate(
      serializedRuntimeDsl,
      useGraphStore.getState().nodeSpecs,
      `SERIALIZATION GAP (${fixture.name})`,
    );

    await resetHarness();
    const serializedHandleMap = await applyDslFixture(
      serializedRuntimeDsl,
      `SERIALIZATION GAP (${fixture.name})`,
    );
    const serializedGraph = canonicalGraph(useGraphStore.getState(), serializedHandleMap);
    const serializedOutputs = await evaluateOutputs(serializedHandleMap);
    expect(serializedGraph, `SERIALIZATION GAP (${fixture.name}): graph structure changed after graph -> DSL -> runtime`).toEqual(runtimeGraph);
    expect(serializedOutputs, `SERIALIZATION GAP (${fixture.name}): evaluated outputs changed after graph -> DSL -> runtime`).toEqual(runtimeOutputs);

    await resetHarness();
    const dslHandleMap = await applyDslFixture(
      fixture.dsl,
      `PARSER GAP (${fixture.name})`,
    );
    const dslGraph = canonicalGraph(useGraphStore.getState(), dslHandleMap);
    const dslOutputs = await evaluateOutputs(dslHandleMap);

    expect(dslGraph, `RUNTIME BEHAVIOR MISMATCH (${fixture.name}): DSL path graph differs from runtime fixture graph`).toEqual(runtimeGraph);
    expect(dslOutputs, `RUNTIME BEHAVIOR MISMATCH (${fixture.name}): DSL path output differs from runtime fixture output`).toEqual(runtimeOutputs);
  });
});
