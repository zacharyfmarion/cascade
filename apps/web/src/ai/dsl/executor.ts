import type { Connection, NodeInstance, NodeSpec, ParamDefault, ParamSpec, ParamValue, PortSpec, TransactionOptions, DiagnosticItem } from '../../store/types';
import { createParamValue, isConnectableParam } from '../../store/types';
import { useGraphStore } from '../../store/graphStore';
import { autoLayoutGraph } from '../autoLayout';
import type { DslAst, DslGroupDefinition, DslGpuDefinition, DslNode, DslParamValue, GraphMutation, ValidationError, DslSourceMap } from './types';
import type { HandleMap } from './handleMap';
import { customDefinitionToNodeSpec, parseDsl } from './parser';
import { validateAst } from './validator';
import { diffAst } from './differ';
import { validateSemantics } from './semanticValidator';
import { serializeGraph } from './serializer';
import type { GpuScriptManifest } from '../gpuScript';
import {
  buildDefaultGpuScriptManifest,
  parseGpuScriptManifestJson,
} from '../gpuScript';
import { pascalToSnake } from './types';

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

const labelFromName = (name: string): string =>
  name
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const scalarDslValueToJson = (value: DslParamValue | undefined): number | boolean | string | undefined => {
  if (!value) return undefined;
  if (value.type === 'float' || value.type === 'int' || value.type === 'bool' || value.type === 'string') {
    return value.value;
  }
  return undefined;
};

const isGpuScalarType = (valueType: string): boolean =>
  ['float', 'int', 'bool'].includes(valueType.toLowerCase());

const manifestType = (valueType: string): string => {
  switch (valueType.toLowerCase()) {
    case 'image': return 'Image';
    case 'mask': return 'Mask';
    case 'float': return 'Float';
    case 'int': return 'Int';
    case 'bool': return 'Bool';
    default: return 'String';
  }
};

const gpuDefinitionToManifest = (definition: DslGpuDefinition) => {
  const id = pascalToSnake(definition.name);
  const scalarInputs = definition.inputs.filter(input => isGpuScalarType(input.valueType));
  const imageInputs = definition.inputs.filter(input => !isGpuScalarType(input.valueType));
  return {
    id,
    display_name: labelFromName(id),
    category: 'GPU',
    description: 'Custom GPU node defined in DSL',
    inputs: imageInputs.map(input => ({
      name: input.name,
      label: labelFromName(input.name),
      ty: manifestType(input.valueType),
      optional: input.optional,
    })),
    outputs: definition.outputs.map(output => ({
      name: output.name,
      label: labelFromName(output.name),
      ty: manifestType(output.valueType),
    })),
    params: scalarInputs.map(input => ({
      key: input.name,
      label: labelFromName(input.name),
      type: manifestType(input.valueType),
      default: scalarDslValueToJson(input.defaultValue) ?? (input.valueType === 'bool' ? false : 0),
      min: input.min,
      max: input.max,
      step: input.step,
      ui: input.valueType === 'bool' ? 'Checkbox' : 'Slider',
    })),
    kernel: definition.code,
    supports_mask: !imageInputs.some(input => input.name === 'mask'),
    pixel_space_params: [],
  };
};

// Build a GpuScriptManifest for an existing gpu_script *instance* (not a named kernel).
// Scalars live in `inputs` (not `params`), `params` is always [].
// Preserves `id` and `display_name` from the existing manifest so renames persist.
const gpuDefinitionToInstanceManifest = (
  definition: DslGpuDefinition,
  existingManifest: GpuScriptManifest | null,
  fallbackTypeId: string,
): GpuScriptManifest => {
  const hasMaskInput = definition.inputs.some(
    input => !isGpuScalarType(input.valueType) && input.name === 'mask',
  );
  const inputs = definition.inputs.map(input =>
    isGpuScalarType(input.valueType)
      ? (() => {
          const rawDefault = scalarDslValueToJson(input.defaultValue);
          const numericDefault: number | boolean =
            typeof rawDefault === 'number' || typeof rawDefault === 'boolean'
              ? rawDefault
              : (input.valueType === 'bool' ? false : 0);
          return {
            name: input.name,
            label: labelFromName(input.name),
            ty: manifestType(input.valueType),
            default: numericDefault,
            ...(input.min !== undefined ? { min: input.min } : {}),
            ...(input.max !== undefined ? { max: input.max } : {}),
            ...(input.step !== undefined ? { step: input.step } : {}),
            ui: input.valueType === 'bool' ? 'Checkbox' : 'Slider',
          };
        })()
      : {
          name: input.name,
          label: labelFromName(input.name),
          ty: manifestType(input.valueType),
          optional: input.optional,
        },
  );
  return {
    id: existingManifest?.id ?? fallbackTypeId,
    display_name: existingManifest?.display_name ?? labelFromName(definition.name),
    category: existingManifest?.category ?? 'GPU',
    description: existingManifest?.description ?? 'Custom GPU shader node',
    inputs,
    outputs: definition.outputs.map(output => ({
      name: output.name,
      label: labelFromName(output.name),
      ty: manifestType(output.valueType),
    })),
    params: [],
    kernel: definition.code,
    supports_mask: !hasMaskInput,
  };
};

// Return a map from definition name to existing nodeId for gpu_script instances.
// The parser resolves custom gpu type names to their snaked form (e.g. 'FilmGlow' → 'film_glow'),
// so we match dslNode.nodeTypeId against the snaked name rather than the raw definition name.
const findGpuScriptInstanceMap = (
  ast: DslAst,
  currentNodes: Map<string, NodeInstance>,
  handleMap: HandleMap,
): Map<string, string> => {
  const instanceMap = new Map<string, string>();
  if (!ast.customNodes) return instanceMap;
  for (const [name, definition] of ast.customNodes.entries()) {
    if (definition.kind !== 'gpu') continue;
    const resolvedTypeId = pascalToSnake(name);
    for (const dslNode of ast.nodes.values()) {
      if (dslNode.nodeTypeId !== resolvedTypeId) continue;
      const nodeId = handleMap.getNodeId(dslNode.handle);
      if (!nodeId) continue;
      if (currentNodes.get(nodeId)?.typeId.startsWith('gpu_script::')) {
        instanceMap.set(name, nodeId);
        break;
      }
    }
  }
  return instanceMap;
};

// Recompile existing gpu_script instances whose definition has changed in the new DSL.
const recompileGpuScriptInstances = async (
  ast: DslAst,
  instanceMap: Map<string, string>,
  currentNodes: Map<string, NodeInstance>,
): Promise<ValidationError[]> => {
  if (instanceMap.size === 0) return [];
  const errors: ValidationError[] = [];
  const store = useGraphStore.getState();
  for (const [name, nodeId] of instanceMap.entries()) {
    const definition = ast.customNodes?.get(name);
    if (!definition || definition.kind !== 'gpu') continue;
    const currentNode = currentNodes.get(nodeId);
    const existingManifestValue = currentNode?.params['__script_manifest'];
    const existingManifestJson =
      existingManifestValue && 'String' in existingManifestValue ? existingManifestValue.String : undefined;
    const existingManifest = parseGpuScriptManifestJson(existingManifestJson);
    const newManifest = gpuDefinitionToInstanceManifest(
      definition,
      existingManifest,
      currentNode?.typeId ?? 'gpu_script',
    );
    try {
      await store.compileScriptNode(nodeId, JSON.stringify(newManifest));
    } catch (e) {
      errors.push({
        line: definition.line,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return errors;
};

const emptyInternalNode = (id: string, typeId: string) => ({
  id,
  type_id: typeId,
  params: {},
  muted: false,
  position: [0, 0],
  image_data: null,
  input_defaults: {},
});

const groupDefinitionToRuntimeJson = (definition: DslGroupDefinition) => {
  const spec = customDefinitionToNodeSpec(definition);
  const paramSpecByKey = new Map(spec.params.map(param => [param.key, param]));
  const nodes = [
    emptyInternalNode('input', 'group_input'),
    emptyInternalNode('output', 'group_output'),
    ...Array.from(definition.graph.nodes.values()).map((node, index) => {
      const params: Record<string, ParamValue> = {};
      const inputDefaults: Record<string, ParamValue> = {};
      for (const [paramKey, paramValue] of node.params.entries()) {
        if (paramValue.type === 'ref') continue;
        params[paramKey] = dslParamToStoreParam(paramValue);
      }
      return {
        id: node.handle,
        type_id: node.nodeTypeId,
        params,
        muted: node.muted,
        position: [index * 220, 0],
        image_data: null,
        input_defaults: inputDefaults,
      };
    }),
  ];
  const promotions = Array.from(definition.graph.nodes.values()).flatMap(node =>
    Array.from(node.params.entries()).flatMap(([paramKey, paramValue]) => {
      if (paramValue.type !== 'ref' || !paramValue.value.startsWith('param.')) return [];
      const groupParamKey = paramValue.value.slice('param.'.length);
      const paramSpec = paramSpecByKey.get(groupParamKey);
      if (!paramSpec) return [];
      return [{
        group_param_key: groupParamKey,
        internal_node_id: node.handle,
        internal_param_key: paramKey,
        spec: paramSpec,
      }];
    })
  );

  return {
    id: spec.id,
    name: spec.display_name,
    category: spec.category,
    description: spec.description,
    internal_graph: {
      nodes,
      connections: definition.graph.connections.map(connection => ({
        from_node: connection.fromHandle,
        from_port: connection.fromPort,
        to_node: connection.toHandle,
        to_port: connection.toPort,
      })),
    },
    promotions,
    is_builtin: false,
    explicit_inputs: spec.inputs as PortSpec[],
    explicit_outputs: spec.outputs as PortSpec[],
  };
};

const registerCustomDefinitions = async (
  ast: DslAst,
  gpuScriptInstances: Map<string, string>,
): Promise<ValidationError[]> => {
  const errors: ValidationError[] = [];
  const definitions = ast.customNodes ? Array.from(ast.customNodes.values()) : [];
  const store = useGraphStore.getState();
  for (const definition of definitions) {
    // gpu_script instances are handled by recompileGpuScriptInstances, not registered as named kernels
    if (definition.kind === 'gpu' && gpuScriptInstances.has(definition.name)) continue;
    const spec = definition.kind === 'gpu'
      ? await store.registerGpuKernel(JSON.stringify(gpuDefinitionToManifest(definition)))
      : await store.registerGroupDefinition(JSON.stringify(groupDefinitionToRuntimeJson(definition)));
    if (!spec) {
      errors.push({
        line: definition.line,
        message: `Failed to register custom node "${definition.name}"`,
      });
    }
  }
  return errors;
};

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
    case 'ref':
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
  if (node?.typeId === 'load_image' && paramKey === 'path' && paramValue.type === 'string') {
    await store.loadImagePath(nodeId, paramValue.value);
    return;
  }
  if (node?.typeId.startsWith('gpu_script') && paramKey === 'script' && paramValue.type === 'string') {
    const manifestValue = node.params['__script_manifest'];
    const manifestJson =
      manifestValue && 'String' in manifestValue ? manifestValue.String : undefined;
    const manifest = parseGpuScriptManifestJson(manifestJson) ?? buildDefaultGpuScriptManifest(node.typeId);
    manifest.kernel = paramValue.value;
    await store.compileScriptNode(nodeId, JSON.stringify(manifest));
    return;
  }
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

const mutationDiagnosticsToError = (diagnostics: DiagnosticItem[]): string | null => {
  if (diagnostics.length === 0) return null;
  return diagnostics.map(diagnostic => diagnostic.message).join('\n');
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
  const diagnosticError = mutationDiagnosticsToError(result.diagnostics.mutationErrors);
  if (diagnosticError) {
    return { success: false, error: diagnosticError };
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

const getMutationLine = (mutation: GraphMutation, ast: DslAst): number | null => {
  switch (mutation.type) {
    case 'addNode':
    case 'removeNode':
    case 'setParam':
    case 'setMuted':
      return ast.nodes.get(mutation.handle)?.line ?? null;
    case 'connect':
      return ast.connections.find(conn =>
        conn.fromHandle === mutation.fromHandle
        && conn.fromPort === mutation.fromPort
        && conn.toHandle === mutation.toHandle
        && conn.toPort === mutation.toPort
      )?.line ?? null;
    case 'disconnect':
      return ast.connections.find(conn =>
        conn.toHandle === mutation.toHandle
        && conn.toPort === mutation.toPort
      )?.line ?? null;
    default:
      return null;
  }
};

const getApplyFailureLine = (mutations: GraphMutation[], ast: DslAst): number => {
  for (const mutation of mutations) {
    const line = getMutationLine(mutation, ast);
    if (line && line > 0) return line;
  }
  return 1;
};

export const applyDsl = async (
  newDslText: string,
  handleMap: HandleMap,
  nodeSpecs: NodeSpec[],
  currentNodes: Map<string, NodeInstance>,
  currentConnections: Connection[],
): Promise<ApplyDslResult> => {
  const parseContext = { currentNodes, handleMap };
  const parseResult = parseDsl(newDslText, nodeSpecs, parseContext);
  if (parseResult.errors.length > 0 || !parseResult.ast) {
    return { success: false, errors: parseResult.errors };
  }

  const customSpecs = parseResult.ast.customNodes
    ? Array.from(parseResult.ast.customNodes.values()).map(customDefinitionToNodeSpec)
    : [];
  const validationSpecs = [...nodeSpecs, ...customSpecs];
  const validation = validateAst(parseResult.ast, validationSpecs);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  // Identify which gpu definitions map to existing gpu_script node instances
  const gpuScriptInstances = findGpuScriptInstanceMap(parseResult.ast, currentNodes, handleMap);

  // Recompile existing instances with the updated definition (ports + code)
  const instanceErrors = await recompileGpuScriptInstances(parseResult.ast, gpuScriptInstances, currentNodes);
  if (instanceErrors.length > 0) {
    return { success: false, errors: instanceErrors };
  }

  // Register truly new named kernels and group definitions (not existing instances)
  const customDefinitionErrors = await registerCustomDefinitions(parseResult.ast, gpuScriptInstances);
  if (customDefinitionErrors.length > 0) {
    return { success: false, errors: customDefinitionErrors };
  }

  // Use post-recompile store state so the diff baseline reflects any updated ports/code
  const storeAfterCompile = useGraphStore.getState();
  const nodesForDiff = gpuScriptInstances.size > 0 ? storeAfterCompile.nodes : currentNodes;
  const connectionsForDiff = gpuScriptInstances.size > 0 ? storeAfterCompile.connections : currentConnections;

  const currentDsl = serializeGraph({
    handleMap,
    nodes: nodesForDiff,
    connections: connectionsForDiff,
    nodeSpecs: validationSpecs,
  });
  const reparsedCurrent = parseDsl(currentDsl, validationSpecs, parseContext);
  if (reparsedCurrent.errors.length > 0 || !reparsedCurrent.ast) {
    return { success: false, errors: reparsedCurrent.errors };
  }

  const normalizedNewAst = buildAstWithDefaults(reparsedCurrent.ast, parseResult.ast, validationSpecs);
  const mutations = diffAst(reparsedCurrent.ast, normalizedNewAst);
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
  const applyResult = await applyMutations(mutations, handleMap, validationSpecs, { origin: 'dsl', awaitRender: true });
  if (!applyResult.success) {
    return { success: false, errors: [{ line: getApplyFailureLine(mutations, normalizedNewAst), message: applyResult.error }] };
  }

  const store = useGraphStore.getState();
  const updatedDsl = serializeGraph({
    handleMap,
    nodes: store.nodes,
    connections: store.connections,
    nodeSpecs: store.nodeSpecs.length > 0 ? store.nodeSpecs : validationSpecs,
    customNodes: parseResult.ast.customNodes,
  });

  return { success: true, updatedDsl, evalErrors: applyResult.evalErrors, sourceMap: parseResult.sourceMap };
};
