import type { Connection, NodeInstance, NodeSpec, ParamDefault, ParamSpec, ParamValue, TransactionOptions, DiagnosticItem } from '../../store/types';
import { createParamValue, isConnectableParam } from '../../store/types';
import { useGraphStore } from '../../store/graphStore';
import { autoLayoutGraph } from '../autoLayout';
import type { DslAst, DslNode, DslParamValue, GraphMutation, ValidationError, DslSourceMap } from './types';
import type { HandleMap } from './handleMap';
import { parseDsl } from './parser';
import { validateAst } from './validator';
import { diffAst } from './differ';
import { validateSemantics } from './semanticValidator';
import { serializeGraph } from './serializer';

export type ApplyResult =
  | { success: true; evalErrors?: DiagnosticItem[] }
  | { success: false; error: string };
export type ApplyDslResult =
  | { success: true; updatedDsl: string; evalErrors?: DiagnosticItem[]; sourceMap?: DslSourceMap }
  | { success: false; errors: (ParseError | ValidationError)[] };

export interface ParseError {
  line: number;
  message: string;
  suggestion?: string;
}

const getNodeSpec = (nodeSpecs: NodeSpec[], typeId: string): NodeSpec | undefined =>
  nodeSpecs.find(spec => spec.id === typeId);

const getParamSpec = (spec: NodeSpec | undefined, key: string): ParamSpec | undefined =>
  spec?.params.find(param => param.key === key);

const paramDefaultToDsl = (paramDefault: ParamDefault): DslParamValue => {
  if ('Float' in paramDefault) return { type: 'float', value: paramDefault.Float };
  if ('Int' in paramDefault) return { type: 'int', value: paramDefault.Int };
  if ('Bool' in paramDefault) return { type: 'bool', value: paramDefault.Bool };
  if ('Color' in paramDefault) return { type: 'color', value: paramDefault.Color };
  if ('ColorRamp' in paramDefault) return { type: 'ramp', value: paramDefault.ColorRamp };
  if ('ColorPalette' in paramDefault) return { type: 'palette', value: paramDefault.ColorPalette };
  if ('CurvePoints' in paramDefault) return { type: 'curve', value: paramDefault.CurvePoints };
  if ('String' in paramDefault) return { type: 'string', value: paramDefault.String };
  return { type: 'string', value: '' };
};

const dslParamToStoreParam = (dslValue: DslParamValue): ParamValue => {
  switch (dslValue.type) {
    case 'float':
      return createParamValue('Float', dslValue.value);
    case 'int':
      return createParamValue('Int', dslValue.value);
    case 'bool':
      return createParamValue('Bool', dslValue.value);
    case 'string':
      return createParamValue('String', dslValue.value);
    case 'color':
      return createParamValue('Color', dslValue.value);
    case 'ramp':
      return { ColorRamp: dslValue.value };
    case 'curve':
      return { CurvePoints: dslValue.value };
    case 'palette':
      return { ColorPalette: dslValue.value };
    case 'dropdown':
      return createParamValue('Int', dslValue.index);
    default:
      return createParamValue('String', '');
  }
};

const applyParamValue = async (
  nodeId: string,
  paramKey: string,
  paramValue: DslParamValue,
  nodeSpecs: NodeSpec[],
) => {
  const store = useGraphStore.getState();
  const node = store.nodes.get(nodeId);
  const spec = node ? getNodeSpec(nodeSpecs, node.typeId) : undefined;
  const paramSpec = getParamSpec(spec, paramKey);
  const value = dslParamToStoreParam(paramValue);
  if (paramSpec && isConnectableParam(paramSpec)) {
    await store.setInputDefault(nodeId, paramKey, value);
  } else {
    await store.setParam(nodeId, paramKey, value);
  }
};

const applyMutedState = async (nodeId: string, muted: boolean) => {
  const store = useGraphStore.getState();
  const node = store.nodes.get(nodeId);
  if (!node || node.muted === muted) return;

  const previousSelection = Array.from(store.selectedNodeIds);
  store.setSelectedNodes([nodeId]);
  await store.toggleMuteSelected();
  store.setSelectedNodes(previousSelection);
};

/**
 * Execute a list of graph mutations against the store and HandleMap.
 * This is the inner loop used inside editTransaction.
 */
const executeMutations = async (
  mutations: GraphMutation[],
  handleMap: HandleMap,
  nodeSpecs: NodeSpec[],
): Promise<string | null> => {
  const store = useGraphStore.getState();
  let error: string | null = null;
  for (const mutation of mutations) {
    if (error) break;
    switch (mutation.type) {
      case 'addNode': {
        const nodeId = await store.addNode(mutation.typeId, { x: 0, y: 0 });
        handleMap.set(mutation.handle, nodeId);
        for (const [paramKey, paramValue] of mutation.params.entries()) {
          await applyParamValue(nodeId, paramKey, paramValue, nodeSpecs);
        }
        if (mutation.muted) {
          await applyMutedState(nodeId, true);
        }
        break;
      }
      case 'removeNode': {
        const nodeId = handleMap.getNodeId(mutation.handle);
        if (!nodeId) {
          error = `Unknown handle for removeNode: ${mutation.handle}`;
          break;
        }
        await store.removeNode(nodeId);
        handleMap.removeByHandle(mutation.handle);
        break;
      }
      case 'setParam': {
        const nodeId = handleMap.getNodeId(mutation.handle);
        if (!nodeId) {
          error = `Unknown handle for setParam: ${mutation.handle}`;
          break;
        }
        await applyParamValue(nodeId, mutation.paramKey, mutation.value, nodeSpecs);
        break;
      }
      case 'connect': {
        const fromId = handleMap.getNodeId(mutation.fromHandle);
        const toId = handleMap.getNodeId(mutation.toHandle);
        if (!fromId || !toId) {
          error = `Unknown handle for connect: ${mutation.fromHandle} -> ${mutation.toHandle}`;
          break;
        }
        await store.connect(fromId, mutation.fromPort, toId, mutation.toPort);
        break;
      }
      case 'disconnect': {
        const toId = handleMap.getNodeId(mutation.toHandle);
        if (!toId) {
          error = `Unknown handle for disconnect: ${mutation.toHandle}`;
          break;
        }
        const connection = store.connections.find(
          conn => conn.toNode === toId && conn.toPort === mutation.toPort,
        );
        if (!connection) {
          error = `Connection not found for disconnect: ${mutation.toHandle}.${mutation.toPort}`;
          break;
        }
        await store.disconnect(connection.id);
        break;
      }
      case 'setMuted': {
        const nodeId = handleMap.getNodeId(mutation.handle);
        if (!nodeId) {
          error = `Unknown handle for setMuted: ${mutation.handle}`;
          break;
        }
        await applyMutedState(nodeId, mutation.muted);
        break;
      }
      default:
        break;
    }
  }

  return error;
};
export const applyMutations = async (
  mutations: GraphMutation[],
  handleMap: HandleMap,
  nodeSpecs: NodeSpec[],
  txOptions: TransactionOptions = { origin: 'ai', awaitRender: true },
): Promise<ApplyResult> => {
  const store = useGraphStore.getState();
  let mutationError: string | null = null;
  const result = await store.editTransaction(txOptions, async () => {
    mutationError = await executeMutations(mutations, handleMap, nodeSpecs);
    if (mutationError) throw new Error(mutationError);
  });
  if (mutationError) {
    return { success: false, error: mutationError };
  }

  autoLayoutGraph();
  const evalErrors = result.diagnostics.evalErrors.length > 0
    ? result.diagnostics.evalErrors
    : undefined;
  return { success: true, evalErrors };
};

const buildAstWithDefaults = (
  oldAst: DslAst,
  newAst: DslAst,
  nodeSpecs: NodeSpec[],
): DslAst => {
  const specById = new Map(nodeSpecs.map(spec => [spec.id, spec]));
  const nextNodes = new Map<string, DslNode>();

  for (const [handle, newNode] of newAst.nodes.entries()) {
    const oldNode = oldAst.nodes.get(handle);
    if (!oldNode) {
      nextNodes.set(handle, newNode);
      continue;
    }

    const spec = specById.get(newNode.nodeTypeId);
    const params = new Map(newNode.params);

    for (const [paramKey] of oldNode.params.entries()) {
      if (params.has(paramKey)) continue;
      const paramSpec = spec?.params.find(param => param.key === paramKey);
      if (paramSpec) {
        params.set(paramKey, paramDefaultToDsl(paramSpec.default));
      }
    }

    nextNodes.set(handle, { ...newNode, params });
  }

  return { nodes: nextNodes, connections: newAst.connections };
};

export const applyDsl = async (
  newDslText: string,
  handleMap: HandleMap,
  nodeSpecs: NodeSpec[],
  currentNodes: Map<string, NodeInstance>,
  currentConnections: Connection[],
): Promise<ApplyDslResult> => {
  const parseResult = parseDsl(newDslText, nodeSpecs);
  if (parseResult.errors.length > 0 || !parseResult.ast) {
    return { success: false, errors: parseResult.errors };
  }

  const validation = validateAst(parseResult.ast, nodeSpecs);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  const currentDsl = serializeGraph({
    handleMap,
    nodes: currentNodes,
    connections: currentConnections,
    nodeSpecs,
  });
  const currentParsed = parseDsl(currentDsl, nodeSpecs);
  if (currentParsed.errors.length > 0 || !currentParsed.ast) {
    return { success: false, errors: currentParsed.errors };
  }

  const normalizedNewAst = buildAstWithDefaults(currentParsed.ast, parseResult.ast, nodeSpecs);
  const mutations = diffAst(currentParsed.ast, normalizedNewAst);
  // Semantic validation via Rust engine (type compat, port existence, cycles)
  const validateEditsFn = useGraphStore.getState().validateEdits;
  if (validateEditsFn) {
    const semanticErrors = validateSemantics(
      mutations,
      parseResult.sourceMap ?? { nodeSpans: new Map(), connectionSpans: new Map() },
      handleMap,
      validateEditsFn,
    );
    if (semanticErrors.length > 0) {
      return { success: false, errors: semanticErrors };
    }
  }
  const applyResult = await applyMutations(mutations, handleMap, nodeSpecs, { origin: 'dsl', awaitRender: true });
  if (!applyResult.success) {
    return { success: false, errors: [{ line: 0, message: applyResult.error }] };
  }

  const store = useGraphStore.getState();
  const updatedDsl = serializeGraph({
    handleMap,
    nodes: store.nodes,
    connections: store.connections,
    nodeSpecs,
  });

  return { success: true, updatedDsl, evalErrors: applyResult.evalErrors, sourceMap: parseResult.sourceMap };
};
