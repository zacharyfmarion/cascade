import { HandleMap } from './handleMap';
import type { DslConnection, DslCustomNodeDefinition, DslGpuDefinition, DslGroupDefinition, DslNode, DslParamDeclaration, DslParamValue, DslPortDeclaration } from './types';
import { snakeToPascal, labelToSnake, pascalToSnake } from './types';
import type { NodeInstance, Connection, NodeSpec, ParamValue, ParamSpec, PortSpec, SerializableGroupDefinition, SerializableInternalNode, SerializablePromotion, DslShadowCustomDefinitionName } from '../../store/types';
import { isConnectableParam } from '../../store/types';
import { isScalarScriptType, parseGpuScriptManifestJson, type GpuScriptManifest } from '../gpuScript';

export interface SerializerInput {
  nodes: Map<string, NodeInstance>;
  connections: Connection[];
  nodeSpecs: NodeSpec[];
  handleMap: HandleMap;
  customNodes?: Map<string, DslCustomNodeDefinition>;
  groupDefinitions?: SerializableGroupDefinition[];
  customDefinitionNames?: DslShadowCustomDefinitionName[];
  pruneUnusedCustomDefinitions?: boolean;
}

const formatFloat = (value: number): string => {
  const fixed = value.toFixed(4);
  let trimmed = fixed.replace(/\.?0+$/, '');
  if (!trimmed.includes('.')) {
    trimmed = `${trimmed}.0`;
  }
  return trimmed;
};

const formatColor = (color: [number, number, number, number]): string => {
  const [r, g, b, a] = color;
  return `rgba(${formatFloat(r)}, ${formatFloat(g)}, ${formatFloat(b)}, ${formatFloat(a)})`;
};

const unwrapParamValue = (paramSpec: ParamSpec, paramValue: ParamValue): DslParamValue => {
  // Dropdown params are stored as Int in the engine but should be represented
  // as snake_case strings in the DSL.
  if (paramSpec.ui_hint.type === 'Dropdown' && 'data' in paramSpec.ui_hint && 'Int' in paramValue) {
    const options = paramSpec.ui_hint.data;
    const idx = paramValue.Int;
    const label = idx >= 0 && idx < options.length ? options[idx] : undefined;
    return { type: 'dropdown', value: label ? labelToSnake(label) : String(idx), index: idx };
  }
  if ('Float' in paramValue) return { type: 'float', value: paramValue.Float };
  if ('Int' in paramValue) return { type: 'int', value: paramValue.Int };
  if ('Bool' in paramValue) return { type: 'bool', value: paramValue.Bool };
  if ('Color' in paramValue) return { type: 'color', value: paramValue.Color };
  if ('ColorRamp' in paramValue) {
    return { type: 'ramp', value: paramValue.ColorRamp.map((stop) => ({ position: stop.position, color: stop.color })) };
  }
  if ('CurvePoints' in paramValue) {
    return { type: 'curve', value: paramValue.CurvePoints.map((point) => ({ x: point.x, y: point.y })) };
  }
  if ('ColorPalette' in paramValue) return { type: 'palette', value: paramValue.ColorPalette };
  return { type: 'string', value: paramValue.String };
};

const formatAssetValue = (typeId: string, paramKey: string, value: string): string | null => {
  if (!value) return null;
  if (paramKey !== 'path' && paramKey !== 'directory' && paramKey !== 'file_path' && paramKey !== 'files') return null;
  if (typeId === 'load_image') return `image(${JSON.stringify(value)})`;
  if (typeId === 'load_image_sequence' && paramKey === 'directory') return `sequence(${JSON.stringify(value)})`;
  if (typeId === 'load_video' && paramKey === 'file_path') return `video(${JSON.stringify(value)})`;
  if (typeId === 'load_image_batch' && paramKey === 'files') {
    return value.startsWith('images(') ? value : `images([${JSON.stringify(value)}])`;
  }
  return null;
};

const formatDslValue = (paramValue: DslParamValue, context?: { typeId: string; paramKey: string }): string => {
  switch (paramValue.type) {
    case 'float':
      return formatFloat(paramValue.value);
    case 'int':
      return `${paramValue.value}`;
    case 'bool':
      return paramValue.value ? 'true' : 'false';
    case 'string':
      if (context) {
        const assetValue = formatAssetValue(context.typeId, context.paramKey, paramValue.value);
        if (assetValue) return assetValue;
      }
      if (paramValue.value.includes('\n') && !paramValue.value.includes('"""')) {
        return `"""\n${paramValue.value}\n"""`;
      }
      return JSON.stringify(paramValue.value);
    case 'ref':
      return paramValue.value;
    case 'color':
      return formatColor(paramValue.value);
    case 'ramp':
      return `[${paramValue.value
        .map((stop) => `${formatFloat(stop.position)}: ${formatColor(stop.color)}`)
        .join(', ')}]`;
    case 'curve':
      return `[${paramValue.value
        .map((point) => `(${formatFloat(point.x)}, ${formatFloat(point.y)})`)
        .join(', ')}]`;
    case 'palette':
      return `[${paramValue.value.map((color) => formatColor(color)).join(', ')}]`;
    case 'dropdown':
      return `"${paramValue.value}"`;
    default: {
      const exhaustive: never = paramValue;
      return String(exhaustive);
    }
  }
};

const formatParamEntry = (typeId: string, paramSpec: ParamSpec, paramValue: ParamValue): string => {
  const dslValue = unwrapParamValue(paramSpec, paramValue);
  return `${paramSpec.key}: ${formatDslValue(dslValue, { typeId, paramKey: paramSpec.key })}`;
};

const paramValueToDslValue = (value: ParamValue): DslParamValue => {
  if ('Float' in value) return { type: 'float', value: value.Float };
  if ('Int' in value) return { type: 'int', value: value.Int };
  if ('Bool' in value) return { type: 'bool', value: value.Bool };
  if ('Color' in value) return { type: 'color', value: value.Color };
  if ('ColorRamp' in value) return { type: 'ramp', value: value.ColorRamp.map(stop => ({ position: stop.position, color: stop.color })) };
  if ('CurvePoints' in value) return { type: 'curve', value: value.CurvePoints.map(point => ({ x: point.x, y: point.y })) };
  if ('ColorPalette' in value) return { type: 'palette', value: value.ColorPalette };
  return { type: 'string', value: value.String };
};

const getStringParam = (node: NodeInstance, key: string): string => {
  const value = node.params[key];
  return value && 'String' in value ? value.String : '';
};

const shouldIncludeParam = (
  node: NodeInstance,
  paramSpec: ParamSpec,
  paramValue: ParamValue | undefined,
): paramValue is ParamValue => {
  if (!paramValue) return false;
  if (node.typeId === 'load_image' && paramSpec.key === 'image_data') return false;
  if (node.typeId === 'load_image_sequence') {
    if (paramSpec.key === 'directory') return Boolean(getStringParam(node, 'directory'));
    if (paramSpec.key === 'pattern') return Boolean(getStringParam(node, 'directory'));
  }
  if (node.typeId === 'load_video' && paramSpec.key === 'file_path') {
    return Boolean(getStringParam(node, 'file_path'));
  }
  if (node.typeId === 'load_image_batch') {
    if (paramSpec.key === 'directory') return Boolean(getStringParam(node, 'directory'));
    if (paramSpec.key === 'files') return !getStringParam(node, 'directory') && Boolean(getStringParam(node, 'files'));
  }
  return JSON.stringify(paramValue) !== JSON.stringify(paramSpec.default);
};

const formatVirtualAssetParamEntries = (node: NodeInstance, spec: NodeSpec | undefined): string[] => {
  if (node.typeId !== 'load_image') return [];
  if (spec?.params.some((param) => param.key === 'path')) return [];
  const path = getStringParam(node, 'path');
  if (!path) return [];
  return [`path: image(${JSON.stringify(path)})`];
};

const topologicalOrder = (
  nodes: Map<string, NodeInstance>,
  connections: Connection[],
  handleMap: HandleMap,
  handleBaseForNode?: (node: NodeInstance) => string | null,
): NodeInstance[] => {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  for (const nodeId of nodes.keys()) {
    inDegree.set(nodeId, 0);
    adjacency.set(nodeId, new Set());
  }

  for (const connection of connections) {
    if (!nodes.has(connection.fromNode) || !nodes.has(connection.toNode)) continue;
    const neighbors = adjacency.get(connection.fromNode);
    if (!neighbors) continue;
    if (!neighbors.has(connection.toNode)) {
      neighbors.add(connection.toNode);
      inDegree.set(connection.toNode, (inDegree.get(connection.toNode) ?? 0) + 1);
    }
  }

  const getHandle = (nodeId: string): string => {
    const node = nodes.get(nodeId);
    const base = node ? handleBaseForNode?.(node) : null;
    return base ? handleMap.getOrCreateWithBase(nodeId, base) : handleMap.getOrCreate(nodeId, node?.typeId ?? 'node');
  };

  const queue = Array.from(nodes.keys())
    .filter((nodeId) => (inDegree.get(nodeId) ?? 0) === 0)
    .sort((a, b) => getHandle(a).localeCompare(getHandle(b)));

  const ordered: NodeInstance[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) break;
    const node = nodes.get(nodeId);
    if (node) ordered.push(node);
    const neighbors = adjacency.get(nodeId);
    if (!neighbors) continue;
    for (const neighbor of neighbors) {
      const nextIn = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, nextIn);
      if (nextIn === 0) {
        queue.push(neighbor);
        queue.sort((a, b) => getHandle(a).localeCompare(getHandle(b)));
      }
    }
  }

  if (ordered.length !== nodes.size) {
    const remaining = Array.from(nodes.keys()).filter((nodeId) => !ordered.find((node) => node.id === nodeId));
    remaining.sort((a, b) => getHandle(a).localeCompare(getHandle(b)));
    for (const nodeId of remaining) {
      const node = nodes.get(nodeId);
      if (node) ordered.push(node);
    }
  }

  return ordered;
};

// ---------------------------------------------------------------------------
// Custom node definition serialization
// ---------------------------------------------------------------------------

const formatExtras = (item: { min?: number; max?: number; step?: number }): string => {
  const parts: string[] = [];
  if (item.min !== undefined) parts.push(`min ${formatFloat(item.min)}`);
  if (item.max !== undefined) parts.push(`max ${formatFloat(item.max)}`);
  if (item.step !== undefined) parts.push(`step ${formatFloat(item.step)}`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
};

const formatPortDeclaration = (port: DslPortDeclaration): string => {
  const optMark = port.optional ? '?' : '';
  const defaultStr = port.defaultValue !== undefined
    ? ` = ${formatDslValue(port.defaultValue)}`
    : '';
  return `${port.valueType} ${port.name}${optMark}${defaultStr}${formatExtras(port)}`;
};

const formatParamDeclaration = (param: DslParamDeclaration): string =>
  `${param.valueType} ${param.name} = ${formatDslValue(param.defaultValue)}${formatExtras(param)}`;

const formatInternalNode = (node: DslNode): string => {
  const params: string[] = [];
  const paramKeys = new Set(node.params.keys());
  for (const [key, value] of node.params) {
    params.push(`${key}: ${formatDslValue(value)}`);
  }
  for (const [key, value] of node.inputDefaults) {
    const dslKey = paramKeys.has(key) ? `input.${key}` : key;
    params.push(`${dslKey}: ${formatDslValue(value)}`);
  }
  const expression = `${node.nodeType}(${params.join(', ')})`;
  return node.muted ? `${node.handle} = muted(${expression})` : `${node.handle} = ${expression}`;
};

const formatInternalConnection = (conn: DslConnection): string =>
  `${conn.fromHandle}.${conn.fromPort} -> ${conn.toHandle}.${conn.toPort}`;

const formatSection = (header: string, lines: string[]): string => {
  if (lines.length === 0) return '';
  const body = lines.map(line => `    ${line}`).join('\n');
  return `  ${header} {\n${body}\n  }`;
};

const scalarPortToDslValue = (ty: string, raw: ParamValue | undefined): DslParamValue | null => {
  if (!raw) return null;
  if (ty === 'Bool') return { type: 'bool', value: 'Bool' in raw ? raw.Bool : false };
  if (ty === 'Int') return { type: 'int', value: 'Int' in raw ? raw.Int : 0 };
  if ('Float' in raw) return { type: 'float', value: raw.Float };
  return null;
};

const scalarPortDefaultDslValue = (ty: string, def: number | boolean | undefined): DslParamValue => {
  if (ty === 'Bool') return { type: 'bool', value: Boolean(def ?? false) };
  if (ty === 'Int') return { type: 'int', value: Math.round(Number(def ?? 0)) };
  return { type: 'float', value: Number(def ?? 0) };
};

const displayNameToPascal = (displayName: string): string =>
  displayName
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');

const displayNameToHandleBase = (displayName: string): string => {
  const pascal = /[\s_-]/.test(displayName) ? displayNameToPascal(displayName) : displayName;
  // convert PascalCase → snake_case for use as a handle prefix
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    || 'gpu';
};

const uniqueDefinitionName = (baseName: string, usedNames: Set<string>): string => {
  const fallback = baseName || 'GroupNode';
  if (!usedNames.has(fallback)) {
    usedNames.add(fallback);
    return fallback;
  }
  let suffix = 2;
  while (usedNames.has(`${fallback}${suffix}`)) {
    suffix += 1;
  }
  const name = `${fallback}${suffix}`;
  usedNames.add(name);
  return name;
};

const definitionNameForGroup = (
  definition: SerializableGroupDefinition,
  customNameByRuntimeId: Map<string, string>,
  usedNames: Set<string>,
): string => {
  const persisted = customNameByRuntimeId.get(definition.id);
  if (persisted) return uniqueDefinitionName(persisted, usedNames);
  return uniqueDefinitionName(displayNameToPascal(definition.name) || snakeToPascal(definition.id.replace(/^group::/, '')), usedNames);
};

const portToDslDeclaration = (port: PortSpec): DslPortDeclaration => ({
  valueType: port.ty.toLowerCase(),
  name: port.name,
  optional: false,
  defaultValue: port.default ? paramValueToDslValue(port.default as ParamValue) : undefined,
  min: port.min,
  max: port.max,
  step: port.step,
  line: 1,
});

const INPUT_DEFAULT_TYPES = new Set(['Float', 'Int', 'Bool', 'Color', 'String']);

const fallbackDefaultForInputType = (ty: string): ParamValue => {
  if (ty === 'Bool') return { Bool: false };
  if (ty === 'Int') return { Int: 0 };
  if (ty === 'Float') return { Float: 0 };
  if (ty === 'Color') return { Color: [0, 0, 0, 1] };
  return { String: '' };
};

const inputPortToParamSpec = (port: PortSpec): ParamSpec | null => {
  if (!INPUT_DEFAULT_TYPES.has(port.ty)) return null;
  return {
    key: port.name,
    label: port.label,
    ty: port.ty,
    default: port.default ?? fallbackDefaultForInputType(port.ty),
    min: port.min,
    max: port.max,
    step: port.step,
    ui_hint: port.ui_hint ?? (
      port.ty === 'Bool'
        ? { type: 'Checkbox' }
        : port.ty === 'Color'
          ? { type: 'ColorPicker' }
          : port.ty === 'String'
            ? { type: 'TextArea' }
            : { type: 'NumberInput' }
    ),
    promotable: true,
  };
};

const isSyntheticParamInput = (portSpec: PortSpec, paramSpec: ParamSpec | undefined): boolean => {
  if (!paramSpec) return false;
  return isConnectableParam(paramSpec)
    && portSpec.name === paramSpec.key
    && portSpec.label === paramSpec.label
    && portSpec.ty === paramSpec.ty
    && JSON.stringify(portSpec.default) === JSON.stringify(paramSpec.default)
    && portSpec.min === paramSpec.min
    && portSpec.max === paramSpec.max
    && portSpec.step === paramSpec.step
    && JSON.stringify(portSpec.ui_hint) === JSON.stringify(paramSpec.ui_hint);
};

const formatInputDefaultEntry = (
  typeId: string,
  portSpec: PortSpec,
  value: ParamValue,
  paramKeys: Set<string>,
): string | null => {
  const inputParamSpec = inputPortToParamSpec(portSpec);
  if (!inputParamSpec) return null;
  const dslValue = unwrapParamValue(inputParamSpec, value);
  const key = paramKeys.has(portSpec.name) ? `input.${portSpec.name}` : portSpec.name;
  return `${key}: ${formatDslValue(dslValue, { typeId, paramKey: portSpec.name })}`;
};

const promotionToParamDeclaration = (promotion: SerializablePromotion): DslParamDeclaration => ({
  valueType: promotion.spec.ty.toLowerCase(),
  name: promotion.group_param_key,
  defaultValue: unwrapParamValue(promotion.spec, promotion.spec.default),
  min: promotion.spec.min,
  max: promotion.spec.max,
  step: promotion.spec.step,
  line: 1,
});

const proxyAliasesForGroup = (definition: SerializableGroupDefinition): Map<string, string> => {
  const aliases = new Map<string, string>();
  for (const node of definition.internal_graph.nodes) {
    if (node.type_id === 'group_input') aliases.set(node.id, 'input');
    if (node.type_id === 'group_output') aliases.set(node.id, 'output');
  }
  aliases.set('gi', 'input');
  aliases.set('go', 'output');
  aliases.set('input', 'input');
  aliases.set('output', 'output');
  return aliases;
};

const findInputPortSpec = (spec: NodeSpec | undefined, name: string): PortSpec | null => {
  const input = spec?.inputs.find(port => port.name === name);
  if (input) return input;
  const param = spec?.params.find(item => item.key === name);
  return param
    ? {
        name: param.key,
        label: param.label,
        ty: param.ty,
        default: param.default,
        min: param.min,
        max: param.max,
        step: param.step,
        ui_hint: param.ui_hint,
      }
    : null;
};

const inferGroupInputs = (
  definition: SerializableGroupDefinition,
  nodeSpecById: Map<string, NodeSpec>,
): PortSpec[] => {
  const proxies = proxyAliasesForGroup(definition);
  const nodeById = new Map(definition.internal_graph.nodes.map(node => [node.id, node]));
  const seen = new Set<string>();
  const ports: PortSpec[] = [];
  for (const connection of definition.internal_graph.connections) {
    if (proxies.get(connection.from_node) !== 'input') continue;
    if (seen.has(connection.from_port)) continue;
    const targetNode = nodeById.get(connection.to_node);
    const targetSpec = targetNode ? nodeSpecById.get(targetNode.type_id) : undefined;
    const inferred = findInputPortSpec(targetSpec, connection.to_port);
    ports.push(inferred
      ? { ...inferred, name: connection.from_port, label: inferred.label || connection.from_port }
      : { name: connection.from_port, label: connection.from_port, ty: 'Image' });
    seen.add(connection.from_port);
  }
  return ports;
};

const inferGroupOutputs = (
  definition: SerializableGroupDefinition,
  nodeSpecById: Map<string, NodeSpec>,
): PortSpec[] => {
  const proxies = proxyAliasesForGroup(definition);
  const nodeById = new Map(definition.internal_graph.nodes.map(node => [node.id, node]));
  const seen = new Set<string>();
  const ports: PortSpec[] = [];
  for (const connection of definition.internal_graph.connections) {
    if (proxies.get(connection.to_node) !== 'output') continue;
    if (seen.has(connection.to_port)) continue;
    const sourceNode = nodeById.get(connection.from_node);
    const sourceSpec = sourceNode ? nodeSpecById.get(sourceNode.type_id) : undefined;
    const inferred = sourceSpec?.outputs.find(port => port.name === connection.from_port);
    ports.push(inferred
      ? { ...inferred, name: connection.to_port, label: inferred.label || connection.to_port }
      : { name: connection.to_port, label: connection.to_port, ty: 'Image' });
    seen.add(connection.to_port);
  }
  return ports;
};

const typeNameForNodeTypeId = (
  typeId: string,
  nodeSpecById: Map<string, NodeSpec>,
  customDefinitionNameByRuntimeId: Map<string, string>,
): string => {
  const customName = customDefinitionNameByRuntimeId.get(typeId);
  if (customName) return customName;
  const spec = nodeSpecById.get(typeId);
  const rawId = spec ? spec.id : typeId;
  return snakeToPascal(rawId.replace(/^(gpu_kernel|group)::/, ''));
};

const internalNodeToDslNode = (
  node: SerializableInternalNode,
  handle: string,
  nodeSpecById: Map<string, NodeSpec>,
  customDefinitionNameByRuntimeId: Map<string, string>,
  promotions: SerializablePromotion[],
  connectedInputKeys: Set<string> = new Set(),
): DslNode => {
  const spec = nodeSpecById.get(node.type_id);
  const promotedParamByKey = new Map(
    promotions
      .filter(promotion => promotion.internal_node_id === node.id)
      .map(promotion => [promotion.internal_param_key, promotion.group_param_key]),
  );
  const params = new Map<string, DslParamValue>();
  const inputDefaults = new Map<string, DslParamValue>();

  if (spec) {
    for (const paramSpec of spec.params) {
      const promotedName = promotedParamByKey.get(paramSpec.key);
      if (promotedName) {
        params.set(paramSpec.key, { type: 'ref', value: `param.${promotedName}` });
        continue;
      }
      const value = isConnectableParam(paramSpec)
        ? (node.input_defaults?.[paramSpec.key] ?? node.params?.[paramSpec.key])
        : node.params?.[paramSpec.key];
      if (!value || JSON.stringify(value) === JSON.stringify(paramSpec.default)) continue;
      params.set(paramSpec.key, unwrapParamValue(paramSpec, value));
    }
    for (const inputSpec of spec.inputs) {
      if (connectedInputKeys.has(inputSpec.name)) continue;
      const inputParamSpec = inputPortToParamSpec(inputSpec);
      if (!inputParamSpec) continue;
      const value = node.input_defaults?.[inputSpec.name] ?? node.params?.[inputSpec.name];
      if (!value || JSON.stringify(value) === JSON.stringify(inputSpec.default)) continue;
      inputDefaults.set(inputSpec.name, unwrapParamValue(inputParamSpec, value));
    }
  } else {
    for (const [key, value] of Object.entries(node.params ?? {})) {
      if (key === '__script_manifest') continue;
      const promotedName = promotedParamByKey.get(key);
      params.set(key, promotedName ? { type: 'ref', value: `param.${promotedName}` } : paramValueToDslValue(value));
    }
  }

  return {
    handle,
    nodeType: typeNameForNodeTypeId(node.type_id, nodeSpecById, customDefinitionNameByRuntimeId),
    nodeTypeId: node.type_id,
    params,
    inputDefaults,
    muted: Boolean(node.muted),
    line: 1,
  };
};

const runtimeGroupDefinitionToDsl = (
  definition: SerializableGroupDefinition,
  name: string,
  nodeSpecById: Map<string, NodeSpec>,
  customDefinitionNameByRuntimeId: Map<string, string>,
): DslGroupDefinition => {
  const proxies = proxyAliasesForGroup(definition);
  const promotions = definition.promotions ?? [];
  const handleMap = new HandleMap();
  const nodes = new Map<string, DslNode>();

  for (const node of definition.internal_graph.nodes) {
    if (node.type_id === 'group_input' || node.type_id === 'group_output') continue;
    const handle = handleMap.getOrCreate(node.id, node.type_id);
    const connectedInputs = new Set(
      definition.internal_graph.connections
        .filter(connection => connection.to_node === node.id)
        .map(connection => connection.to_port),
    );
    nodes.set(handle, internalNodeToDslNode(node, handle, nodeSpecById, customDefinitionNameByRuntimeId, promotions, connectedInputs));
  }

  const connections: DslConnection[] = definition.internal_graph.connections.map(connection => ({
    fromHandle: proxies.get(connection.from_node) ?? handleMap.getOrCreate(connection.from_node, definition.internal_graph.nodes.find(node => node.id === connection.from_node)?.type_id ?? 'node'),
    fromPort: connection.from_port,
    toHandle: proxies.get(connection.to_node) ?? handleMap.getOrCreate(connection.to_node, definition.internal_graph.nodes.find(node => node.id === connection.to_node)?.type_id ?? 'node'),
    toPort: connection.to_port,
    line: 1,
  }));

  return {
    kind: 'group',
    name,
    line: 1,
    inputs: (definition.explicit_inputs ?? inferGroupInputs(definition, nodeSpecById)).map(portToDslDeclaration),
    outputs: (definition.explicit_outputs ?? inferGroupOutputs(definition, nodeSpecById)).map(portToDslDeclaration),
    params: promotions.map(promotionToParamDeclaration),
    graph: { nodes, connections },
  };
};

const runtimeIdForCustomDefinition = (definition: DslCustomNodeDefinition): string =>
  definition.kind === 'group' ? `group::${pascalToSnake(definition.name)}` : pascalToSnake(definition.name);

const collectReachableCustomDefinitionIds = (
  nodes: Map<string, NodeInstance>,
  groupDefinitions: SerializableGroupDefinition[],
  customNodes: Map<string, DslCustomNodeDefinition> | undefined,
): Set<string> => {
  const reachable = new Set<string>();
  const groupById = new Map(groupDefinitions.map(definition => [definition.id, definition]));
  const customByRuntimeId = new Map<string, DslCustomNodeDefinition>();
  for (const definition of customNodes?.values() ?? []) {
    customByRuntimeId.set(runtimeIdForCustomDefinition(definition), definition);
  }

  const visit = (typeId: string) => {
    if (reachable.has(typeId)) return;
    if (!typeId.startsWith('group::') && !customByRuntimeId.has(typeId)) return;
    reachable.add(typeId);

    const runtimeGroup = groupById.get(typeId);
    for (const internal of runtimeGroup?.internal_graph.nodes ?? []) {
      visit(internal.type_id);
    }

    const customDefinition = customByRuntimeId.get(typeId);
    if (customDefinition?.kind === 'group') {
      for (const internal of customDefinition.graph.nodes.values()) {
        visit(internal.nodeTypeId);
      }
    }
  };

  for (const node of nodes.values()) {
    visit(node.typeId);
  }

  return reachable;
};

const GPU_SCRIPT_DEFAULT_DISPLAY_NAME = 'GPU Script';

const gpuDefinitionName = (manifest: GpuScriptManifest, gpuNodeCounter: number): string => {
  const pascal = displayNameToPascal(manifest.display_name);
  if (!pascal || pascal === displayNameToPascal(GPU_SCRIPT_DEFAULT_DISPLAY_NAME)) {
    return `GpuNode${gpuNodeCounter}`;
  }
  return pascal;
};

const manifestToGpuDefinition = (name: string, manifest: GpuScriptManifest): DslGpuDefinition => ({
  kind: 'gpu',
  name,
  line: 1,
  inputs: manifest.inputs.map(port => ({
    valueType: port.ty.toLowerCase(),
    name: port.name,
    optional: port.name === 'mask',
    defaultValue: isScalarScriptType(port.ty)
      ? scalarPortDefaultDslValue(port.ty, port.default)
      : undefined,
    min: port.min,
    max: port.max,
    step: port.step,
    line: 1,
  })),
  outputs: manifest.outputs.map(port => ({
    valueType: port.ty.toLowerCase(),
    name: port.name,
    optional: false,
    line: 1,
  })),
  code: manifest.kernel,
});

export function serializeCustomDefinition(definition: DslCustomNodeDefinition): string {
  const sections: string[] = [];

  if (definition.inputs.length > 0) {
    sections.push(formatSection('inputs', definition.inputs.map(formatPortDeclaration)));
  }
  if (definition.outputs.length > 0) {
    sections.push(formatSection('outputs', definition.outputs.map(formatPortDeclaration)));
  }

  if (definition.kind === 'gpu') {
    const codeLines = definition.code.split('\n').map(line => `  ${line}`);
    sections.push(`  code """\n${codeLines.join('\n')}\n  """`);
  } else {
    if (definition.params.length > 0) {
      sections.push(formatSection('params', definition.params.map(formatParamDeclaration)));
    }

    const internalNodes = Array.from(definition.graph.nodes.values());
    const internalConnections = definition.graph.connections;
    if (internalNodes.length > 0 || internalConnections.length > 0) {
      const nodeLines = internalNodes.map(formatInternalNode);
      const connLines = internalConnections
        .map(formatInternalConnection)
        .sort();
      const graphLines = connLines.length === 0
        ? nodeLines
        : [...nodeLines, '', ...connLines];
      sections.push(formatSection('graph', graphLines));
    }
  }

  const kind = definition.kind === 'gpu' ? 'gpu' : 'group';
  const body = sections.join('\n\n');
  return `node ${definition.name} = ${kind} {\n${body}\n}`;
}

export function serializeGraph(input: SerializerInput): string {
  const { nodes, connections, nodeSpecs, handleMap } = input;
  if (nodes.size === 0) return '';
  const nodeSpecById = new Map(nodeSpecs.map((spec) => [spec.id, spec]));
  const reachableCustomDefinitionIds = input.pruneUnusedCustomDefinitions
    ? collectReachableCustomDefinitionIds(nodes, input.groupDefinitions ?? [], input.customNodes)
    : null;
  const customDefinitionNameByRuntimeId = new Map<string, string>();
  const usedDefinitionNames = new Set<string>();
  for (const entry of input.customDefinitionNames ?? []) {
    customDefinitionNameByRuntimeId.set(entry.runtimeId, entry.name);
  }
  const activeCustomNodes = new Map<string, DslCustomNodeDefinition>();
  for (const definition of input.customNodes?.values() ?? []) {
    const runtimeId = runtimeIdForCustomDefinition(definition);
    if (reachableCustomDefinitionIds && !reachableCustomDefinitionIds.has(runtimeId)) continue;
    activeCustomNodes.set(runtimeId, definition);
    usedDefinitionNames.add(definition.name);
    customDefinitionNameByRuntimeId.set(runtimeId, definition.name);
  }

  const liftedGroupDefs = new Map<string, DslGroupDefinition>();
  for (const definition of input.groupDefinitions ?? []) {
    if (definition.is_builtin) continue;
    if (reachableCustomDefinitionIds && !reachableCustomDefinitionIds.has(definition.id)) continue;
    if (activeCustomNodes.has(definition.id)) continue;
    const name = definitionNameForGroup(definition, customDefinitionNameByRuntimeId, usedDefinitionNames);
    customDefinitionNameByRuntimeId.set(definition.id, name);
    liftedGroupDefs.set(definition.id, runtimeGroupDefinitionToDsl(definition, name, nodeSpecById, customDefinitionNameByRuntimeId));
  }

  // Collect gpu_script node definitions to lift into top-level blocks
  const liftedGpuDefs = new Map<string, DslGpuDefinition>();
  let gpuNodeCounter = 0;

  const preferredHandleBaseForNode = (node: NodeInstance): string | null => {
    const customName = customDefinitionNameByRuntimeId.get(node.typeId);
    if (customName) {
      const existingHandle = handleMap.getHandle(node.id);
      if (existingHandle && /^user\d+$/.test(existingHandle)) {
        handleMap.removeByNodeId(node.id);
      }
      return displayNameToHandleBase(customName);
    }

    if (node.typeId.startsWith('gpu_script')) {
      const manifestJson = node.params['__script_manifest'];
      const manifestStr = manifestJson && 'String' in manifestJson ? manifestJson.String : undefined;
      const manifest = parseGpuScriptManifestJson(manifestStr);
      if (manifest?.display_name && manifest.display_name !== GPU_SCRIPT_DEFAULT_DISPLAY_NAME) {
        return displayNameToHandleBase(manifest.display_name);
      }
    }

    return null;
  };

  for (const node of nodes.values()) {
    const base = preferredHandleBaseForNode(node);
    if (base) handleMap.getOrCreateWithBase(node.id, base);
  }

  const orderedNodes = topologicalOrder(nodes, connections, handleMap, preferredHandleBaseForNode);

  const nodeLines = orderedNodes.map((node) => {
    // gpu_script nodes: lift to a top-level `node Name = gpu { ... }` definition
    if (node.typeId.startsWith('gpu_script')) {
      const manifestJson = node.params['__script_manifest'];
      const manifestStr = manifestJson && 'String' in manifestJson ? manifestJson.String : undefined;
      const manifest = parseGpuScriptManifestJson(manifestStr);
      if (manifest) {
        gpuNodeCounter += 1;
        const defName = uniqueDefinitionName(gpuDefinitionName(manifest, gpuNodeCounter), usedDefinitionNames);
        // Derive handle from display_name so it reads like 'film_glow1' not 'gpu1'
        const handleBase = displayNameToHandleBase(manifest.display_name);
        const isDefault = !manifest.display_name || manifest.display_name === GPU_SCRIPT_DEFAULT_DISPLAY_NAME;
        const handle = isDefault
          ? handleMap.getOrCreate(node.id, 'gpu_script')
          : handleMap.getOrCreateWithBase(node.id, handleBase);
        liftedGpuDefs.set(handle, manifestToGpuDefinition(defName, manifest));

        // Emit current scalar param values that differ from the manifest defaults
        const scalarParams: string[] = [];
        for (const port of manifest.inputs.filter(p => isScalarScriptType(p.ty))) {
          const raw = node.inputDefaults[port.name] ?? node.params[port.name];
          const dslValue = scalarPortToDslValue(port.ty, raw);
          if (!dslValue) continue;
          const defValue = scalarPortDefaultDslValue(port.ty, port.default);
          if (JSON.stringify(dslValue) !== JSON.stringify(defValue)) {
            scalarParams.push(`${port.name}: ${formatDslValue(dslValue)}`);
          }
        }
        const paramSection = scalarParams.join(', ');
        const expression = `${defName}(${paramSection})`;
        return node.muted ? `${handle} = muted(${expression})` : `${handle} = ${expression}`;
      }
    }

    const customDefinitionName = customDefinitionNameByRuntimeId.get(node.typeId);
    const handle = customDefinitionName
      ? handleMap.getOrCreateWithBase(node.id, displayNameToHandleBase(customDefinitionName))
      : handleMap.getOrCreate(node.id, node.typeId);
    const spec = nodeSpecById.get(node.typeId);
    const typeName = customDefinitionName ?? typeNameForNodeTypeId(spec ? spec.id : node.typeId, nodeSpecById, customDefinitionNameByRuntimeId);

    const params: string[] = formatVirtualAssetParamEntries(node, spec);
    if (spec) {
      const connectedInputs = new Set(
        connections
          .filter(connection => connection.toNode === node.id)
          .map(connection => connection.toPort),
      );
      const paramByKey = new Map(spec.params.map(param => [param.key, param]));
      const paramKeys = new Set(paramByKey.keys());
      for (const inputSpec of spec.inputs) {
        if (isSyntheticParamInput(inputSpec, paramByKey.get(inputSpec.name))) continue;
        if (connectedInputs.has(inputSpec.name)) continue;
        const value = node.inputDefaults[inputSpec.name];
        if (!value || JSON.stringify(value) === JSON.stringify(inputSpec.default)) continue;
        const entry = formatInputDefaultEntry(node.typeId, inputSpec, value, paramKeys);
        if (entry) params.push(entry);
      }
      for (const paramSpec of spec.params) {
        const value = isConnectableParam(paramSpec)
          ? node.inputDefaults[paramSpec.key] ?? node.params[paramSpec.key]
          : node.params[paramSpec.key];
        if (!shouldIncludeParam(node, paramSpec, value)) continue;
        params.push(formatParamEntry(node.typeId, paramSpec, value));
      }
    }

    const paramSection = params.join(', ');
    const expression = `${typeName}(${paramSection})`;
    return node.muted ? `${handle} = muted(${expression})` : `${handle} = ${expression}`;
  });

  const connectionLines = connections
    .filter((connection) => nodes.has(connection.fromNode) && nodes.has(connection.toNode))
    .map((connection) => {
      const fromHandle = handleMap.getOrCreate(connection.fromNode, nodes.get(connection.fromNode)?.typeId ?? 'node');
      const toHandle = handleMap.getOrCreate(connection.toNode, nodes.get(connection.toNode)?.typeId ?? 'node');
      return {
        line: `${fromHandle}.${connection.fromPort} -> ${toHandle}.${connection.toPort}`,
        sortKey: `${toHandle}|${connection.toPort}`,
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map((entry) => entry.line);

  const graphLines = connectionLines.length === 0
    ? nodeLines
    : [...nodeLines, '', ...connectionLines];
  const graphBlock = `graph {\n${graphLines.map((line) => (line ? `  ${line}` : '')).join('\n')}\n}`;

  // Merge lifted gpu_script definitions with any explicit customNodes
  const allDefs = new Map<string, DslCustomNodeDefinition>([
    ...liftedGroupDefs,
    ...liftedGpuDefs,
    ...activeCustomNodes,
  ]);
  if (allDefs.size === 0) return graphBlock;

  const definitionBlocks = Array.from(allDefs.values()).map(serializeCustomDefinition);
  return [...definitionBlocks, graphBlock].join('\n\n');
}
