import type {
  Connection,
  DslShadowCustomDefinitionName,
  DslShadowDocument,
  DslShadowHandleEntry,
  NodeInstance,
  NodeSpec,
  SerializableGroupDefinition,
} from '../../store/types';
import { HandleMap } from './handleMap';
import { parseDsl, customDefinitionToNodeSpec } from './parser';
import { serializeGraph } from './serializer';
import { validateAst } from './validator';
import { pascalToSnake, type DslAst, type DslCustomNodeDefinition, type DslParamValue, type DslPortDeclaration, type DslSourceMap } from './types';

type RuntimeDslMetadata = {
  version: 1;
  text: string;
  graph_hash: string;
  handles: Array<{ node_id: string; handle: string }>;
  custom_definition_names: Array<{ runtime_id: string; name: string }>;
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const displayNameToPascal = (displayName: string): string =>
  displayName
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');

const reachableRuntimeGroupIds = (
  nodes: Map<string, NodeInstance>,
  customGroupDefinitions: SerializableGroupDefinition[],
): Set<string> => {
  const definitionsById = new Map(customGroupDefinitions.map(definition => [definition.id, definition]));
  const reachable = new Set<string>();
  const visit = (typeId: string) => {
    if (!typeId.startsWith('group::') || reachable.has(typeId)) return;
    reachable.add(typeId);
    const definition = definitionsById.get(typeId);
    for (const internal of definition?.internal_graph.nodes ?? []) {
      visit(internal.type_id);
    }
  };
  for (const node of nodes.values()) {
    visit(node.typeId);
  }
  return reachable;
};

export const graphSemanticHash = (
  nodes: Map<string, NodeInstance>,
  connections: Connection[],
  customGroupDefinitions: SerializableGroupDefinition[] = [],
): string => {
  const nodeEntries = Array.from(nodes.values())
    .map(node => ({
      id: node.id,
      typeId: node.typeId,
      params: node.params,
      inputDefaults: node.inputDefaults,
      muted: node.muted,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const connectionEntries = connections
    .map(conn => ({
      fromNode: conn.fromNode,
      fromPort: conn.fromPort,
      toNode: conn.toNode,
      toPort: conn.toPort,
    }))
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  const reachableGroups = reachableRuntimeGroupIds(nodes, customGroupDefinitions);
  const groupDefinitions = customGroupDefinitions
    .filter(definition => reachableGroups.has(definition.id))
    .map(definition => ({
      id: definition.id,
      name: definition.name,
      internalGraph: definition.internal_graph,
      promotions: definition.promotions ?? [],
      explicitInputs: definition.explicit_inputs ?? null,
      explicitOutputs: definition.explicit_outputs ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return stableStringify({ nodes: nodeEntries, connections: connectionEntries, groupDefinitions });
};

const paramValueFingerprint = (value: DslParamValue): unknown => {
  switch (value.type) {
    case 'float':
      return { type: value.type, value: Number(value.value) };
    case 'int':
      return { type: value.type, value: Math.round(Number(value.value)) };
    case 'bool':
      return { type: value.type, value: Boolean(value.value) };
    default:
      return value;
  }
};

const defaultFingerprintForPort = (port: DslPortDeclaration): unknown => {
  if (port.defaultValue) return paramValueFingerprint(port.defaultValue);
  switch (port.valueType.toLowerCase()) {
    case 'float':
      return { type: 'float', value: 0 };
    case 'int':
      return { type: 'int', value: 0 };
    case 'bool':
      return { type: 'bool', value: false };
    default:
      return undefined;
  }
};

const portFingerprint = (port: DslPortDeclaration): unknown => ({
  valueType: port.valueType,
  name: port.name,
  optional: port.optional,
  defaultValue: defaultFingerprintForPort(port),
  min: port.min,
  max: port.max,
  step: port.step,
});

const normalizeGpuCode = (code: string): string => {
  const lines = code.replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd());
  while (lines.length > 0 && lines[0]?.trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
  const commonIndent = lines
    .filter(line => line.trim() !== '')
    .map(line => line.match(/^\s*/)?.[0].length ?? 0)
    .reduce((min, indent) => Math.min(min, indent), Number.POSITIVE_INFINITY);
  const indent = Number.isFinite(commonIndent) ? commonIndent : 0;
  return lines.map(line => line.slice(indent)).join('\n');
};

const customDefinitionFingerprint = (definition: DslCustomNodeDefinition): unknown => {
  const base = {
    kind: definition.kind,
    name: definition.name,
    inputs: definition.inputs.map(portFingerprint),
    outputs: definition.outputs.map(portFingerprint),
  };
  if (definition.kind === 'gpu') {
    return { ...base, code: normalizeGpuCode(definition.code) };
  }
  return {
    ...base,
    params: definition.params.map(param => ({
      valueType: param.valueType,
      name: param.name,
      defaultValue: paramValueFingerprint(param.defaultValue),
      min: param.min,
      max: param.max,
      step: param.step,
    })),
    graph: astFingerprint({
      nodes: definition.graph.nodes,
      connections: definition.graph.connections,
    }),
  };
};

const isRuntimeExternalAssetParam = (nodeType: string, paramKey: string): boolean => {
  if (nodeType === 'LoadImage' && paramKey === 'path') return true;
  if (nodeType === 'LoadImageSequence' && (paramKey === 'path' || paramKey === 'directory')) return true;
  if (nodeType === 'LoadVideo' && (paramKey === 'path' || paramKey === 'file_path')) return true;
  if (nodeType === 'LoadImageBatch' && (paramKey === 'files' || paramKey === 'path')) return true;
  return false;
};

const astFingerprint = (ast: Pick<DslAst, 'nodes' | 'connections' | 'customNodes'>): string => {
  const nodes = Array.from(ast.nodes.values())
    .map(node => ({
      handle: node.handle,
      nodeType: node.nodeType,
      params: Array.from(node.params.entries())
        .filter(([key]) => !isRuntimeExternalAssetParam(node.nodeType, key))
        .map(([key, value]) => [key, paramValueFingerprint(value)])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
      muted: node.muted,
    }))
    .sort((a, b) => a.handle.localeCompare(b.handle));
  const connections = ast.connections
    .map(connection => ({
      fromHandle: connection.fromHandle,
      fromPort: connection.fromPort,
      toHandle: connection.toHandle,
      toPort: connection.toPort,
    }))
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  const customNodes = Array.from(ast.customNodes?.values() ?? [])
    .map(customDefinitionFingerprint)
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  return stableStringify({ nodes, connections, customNodes });
};

export const dslShadowMatchesGraph = (
  shadow: DslShadowDocument,
  nodes: Map<string, NodeInstance>,
  connections: Connection[],
  nodeSpecs: NodeSpec[],
  customGroupDefinitions: SerializableGroupDefinition[] = [],
): boolean => {
  if (shadow.status === 'invalid') return false;
  const handleMap = handleMapFromShadow(nodes, shadow);
  const shadowParse = parseDsl(shadow.text, nodeSpecs, { currentNodes: nodes, handleMap });
  if (shadowParse.errors.length > 0 || !shadowParse.ast) return false;
  const shadowCustomSpecs = shadowParse.ast.customNodes
    ? Array.from(shadowParse.ast.customNodes.values()).map(customDefinitionToNodeSpec)
    : [];
  const shadowValidation = validateAst(shadowParse.ast, [...nodeSpecs, ...shadowCustomSpecs]);
  if (!shadowValidation.valid) return false;

  const canonical = serializeGraph({
    nodes,
    connections,
    nodeSpecs: [...nodeSpecs, ...shadowCustomSpecs],
    handleMap,
    groupDefinitions: customGroupDefinitions,
    customDefinitionNames: shadow.customDefinitionNames,
    pruneUnusedCustomDefinitions: true,
  });
  const canonicalParse = parseDsl(canonical, [...nodeSpecs, ...shadowCustomSpecs], { currentNodes: nodes, handleMap });
  if (canonicalParse.errors.length > 0 || !canonicalParse.ast) return false;

  return astFingerprint(shadowParse.ast) === astFingerprint(canonicalParse.ast);
};

export const handleMapFromShadow = (
  nodes: Map<string, NodeInstance>,
  shadow?: DslShadowDocument | null,
): HandleMap => {
  const map = new HandleMap();
  for (const entry of shadow?.handles ?? []) {
    if (nodes.has(entry.nodeId)) {
      try {
        map.set(entry.handle, entry.nodeId);
      } catch {
        // Ignore invalid persisted handles; deterministic derivation fills gaps below.
      }
    }
  }
  for (const [nodeId, node] of nodes) {
    if (node.dslHandle && !map.hasNodeId(nodeId) && !map.hasHandle(node.dslHandle)) {
      try {
        map.set(node.dslHandle, nodeId);
      } catch {
        // Ignore invalid legacy handles.
      }
    }
  }
  for (const [nodeId, node] of nodes) {
    if (!map.hasNodeId(nodeId)) {
      map.getOrCreate(nodeId, node.typeId);
    }
  }
  return map;
};

export const handleEntriesFromMap = (handleMap: HandleMap): DslShadowHandleEntry[] =>
  handleMap.entries().map(([handle, nodeId]) => ({ nodeId, handle }));

export const customDefinitionNamesFromAst = (ast: DslAst | null): DslShadowCustomDefinitionName[] => {
  if (!ast?.customNodes) return [];
  return Array.from(ast.customNodes.values()).map(definition => ({
    runtimeId: definition.kind === 'group' ? `group::${pascalToSnake(definition.name)}` : pascalToSnake(definition.name),
    name: definition.name,
  }));
};

const mergeCustomDefinitionNames = (
  ast: DslAst | null,
  customGroupDefinitions: SerializableGroupDefinition[],
  existing: DslShadowCustomDefinitionName[] = [],
): DslShadowCustomDefinitionName[] => {
  const merged = new Map<string, string>();
  for (const entry of customDefinitionNamesFromAst(ast)) {
    merged.set(entry.runtimeId, entry.name);
  }
  const existingByRuntimeId = new Map(existing.map(entry => [entry.runtimeId, entry.name]));
  for (const definition of customGroupDefinitions) {
    if (definition.is_builtin) continue;
    const name = existingByRuntimeId.get(definition.id)
      ?? displayNameToPascal(definition.name)
      ?? definition.id.replace(/^group::/, '');
    if (name) merged.set(definition.id, name);
  }
  return Array.from(merged.entries()).map(([runtimeId, name]) => ({ runtimeId, name }));
};

const isRuntimeDslMetadata = (value: unknown): value is RuntimeDslMetadata => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.version === 1
    && typeof record.text === 'string'
    && typeof record.graph_hash === 'string'
    && Array.isArray(record.handles)
    && Array.isArray(record.custom_definition_names);
};

export const serializeDslShadowMetadata = (
  shadow: DslShadowDocument | null,
): RuntimeDslMetadata | undefined => {
  if (!shadow || shadow.status === 'invalid') return undefined;
  return {
    version: 1,
    text: shadow.text,
    graph_hash: shadow.graphHash,
    handles: shadow.handles.map(entry => ({ node_id: entry.nodeId, handle: entry.handle })),
    custom_definition_names: shadow.customDefinitionNames.map(entry => ({
      runtime_id: entry.runtimeId,
      name: entry.name,
    })),
  };
};

export const hydrateDslShadowMetadata = (
  value: unknown,
  nodes: Map<string, NodeInstance>,
  connections: Connection[],
  nodeSpecs: NodeSpec[],
  graphRevision: number,
  customGroupDefinitions: SerializableGroupDefinition[] = [],
): DslShadowDocument | null => {
  if (!isRuntimeDslMetadata(value)) return null;
  const handles = value.handles.flatMap(entry => (
    typeof entry?.node_id === 'string' && typeof entry?.handle === 'string'
      ? [{ nodeId: entry.node_id, handle: entry.handle }]
      : []
  ));
  const customDefinitionNames = value.custom_definition_names.flatMap(entry => (
    typeof entry?.runtime_id === 'string' && typeof entry?.name === 'string'
      ? [{ runtimeId: entry.runtime_id, name: entry.name }]
      : []
  ));
  const graphHash = graphSemanticHash(nodes, connections, customGroupDefinitions);
  const baseShadow: DslShadowDocument = {
    version: 1,
    text: value.text,
    graphHash: value.graph_hash,
    graphRevision,
    handles,
    customDefinitionNames,
    status: value.graph_hash === graphHash ? 'valid' : 'stale',
  };
  const handleMap = handleMapFromShadow(nodes, baseShadow);
  const parseResult = parseDsl(value.text, nodeSpecs, { currentNodes: nodes, handleMap });
  if (parseResult.errors.length > 0 || !parseResult.ast) {
    return { ...baseShadow, status: 'invalid', sourceMap: parseResult.sourceMap };
  }
  const customSpecs = parseResult.ast.customNodes
    ? Array.from(parseResult.ast.customNodes.values()).map(customDefinitionToNodeSpec)
    : [];
  const validation = validateAst(parseResult.ast, [...nodeSpecs, ...customSpecs]);
  const status = validation.valid
    ? (baseShadow.graphHash === graphHash || dslShadowMatchesGraph(baseShadow, nodes, connections, nodeSpecs, customGroupDefinitions) ? 'valid' : baseShadow.status)
    : 'invalid';
  return {
    ...baseShadow,
    status,
    sourceMap: parseResult.sourceMap,
  };
};

export const buildDslShadowFromText = (input: {
  text: string;
  nodes: Map<string, NodeInstance>;
  connections: Connection[];
  customGroupDefinitions?: SerializableGroupDefinition[];
  customDefinitionNames?: DslShadowCustomDefinitionName[];
  graphRevision: number;
  handleMap: HandleMap;
  ast: DslAst | null;
  sourceMap?: DslSourceMap;
}): DslShadowDocument => ({
  version: 1,
  text: input.text,
  graphHash: graphSemanticHash(input.nodes, input.connections, input.customGroupDefinitions ?? []),
  graphRevision: input.graphRevision,
  handles: handleEntriesFromMap(input.handleMap),
  customDefinitionNames: mergeCustomDefinitionNames(input.ast, input.customGroupDefinitions ?? [], input.customDefinitionNames),
  status: 'valid',
  sourceMap: input.sourceMap,
});

const lineForSpan = (text: string, span: { startLine: number; endLine: number }): string | null => {
  if (span.startLine !== span.endLine) return null;
  return text.split('\n')[span.startLine - 1] ?? null;
};

const semanticLine = (line: string, inlineCommentCol?: number): string => {
  const semantic = inlineCommentCol === undefined ? line : line.slice(0, inlineCommentCol);
  return semantic.trim();
};

const normalizeSemanticLine = (line: string): string => {
  let result = '';
  let inString = false;
  let escaped = false;
  for (const char of line) {
    if (inString) {
      result += char;
      if (char === '\\' && !escaped) {
        escaped = true;
        continue;
      }
      if (char === '"' && !escaped) inString = false;
      escaped = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (!/\s/.test(char)) result += char;
  }
  return result;
};

const replacementLinePreservingTrivia = (
  oldLine: string,
  nextLine: string,
  sourceMap: DslSourceMap,
  targetKind: 'node' | 'connection',
  targetKey: string,
  lineNumber: number,
): string => {
  const inlineComment = sourceMap.trivia.find(trivia =>
    trivia.kind === 'comment'
    && trivia.inline
    && trivia.targetKind === targetKind
    && trivia.targetKey === targetKey
    && trivia.span.startLine === lineNumber
  );
  const oldSemantic = semanticLine(oldLine, inlineComment?.span.startCol);
  const nextSemantic = semanticLine(nextLine);
  if (normalizeSemanticLine(oldSemantic) === normalizeSemanticLine(nextSemantic)) {
    return oldLine;
  }

  const indent = oldLine.match(/^\s*/)?.[0] ?? '';
  if (!inlineComment) return `${indent}${nextSemantic}`;

  const semanticEndCol = oldLine.slice(0, inlineComment.span.startCol).trimEnd().length;
  const separator = oldLine.slice(semanticEndCol, inlineComment.span.startCol) || ' ';
  const comment = oldLine.slice(inlineComment.span.startCol);
  return `${indent}${nextSemantic}${separator}${comment}`;
};

const findGraphCloseLine = (lines: string[]): number => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.trim() === '}') return index;
  }
  return lines.length;
};

const collectCustomDefinitionNames = (text: string): Set<string> => {
  const names = new Set<string>();
  const definitionRegex = /^\s*node\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:group|gpu)\s*\{/gm;
  let match: RegExpExecArray | null;
  while ((match = definitionRegex.exec(text)) !== null) {
    names.add(match[1]);
  }
  return names;
};

export const reconcileDslShadowText = (
  oldText: string,
  oldSourceMap: DslSourceMap | undefined,
  newText: string,
  newSourceMap: DslSourceMap | undefined,
): string | null => {
  if (!oldSourceMap || !newSourceMap) return null;
  const oldDefinitions = collectCustomDefinitionNames(oldText);
  const newDefinitions = collectCustomDefinitionNames(newText);
  if (
    oldDefinitions.size !== newDefinitions.size
    || [...newDefinitions].some(name => !oldDefinitions.has(name))
  ) {
    return null;
  }
  const oldLines = oldText.split('\n');
  const replacements = new Map<number, string | null>();
  const additions: string[] = [];

  const queueReplacement = (
    oldSpan: { startLine: number; endLine: number } | undefined,
    nextLine: string | null,
    targetKind?: 'node' | 'connection',
    targetKey?: string,
  ): boolean => {
    if (!oldSpan || oldSpan.startLine !== oldSpan.endLine) return false;
    const oldLine = oldLines[oldSpan.startLine - 1];
    const replacement = nextLine && oldLine !== undefined && targetKind && targetKey
      ? replacementLinePreservingTrivia(oldLine, nextLine, oldSourceMap, targetKind, targetKey, oldSpan.startLine)
      : nextLine;
    replacements.set(oldSpan.startLine - 1, replacement);
    return true;
  };

  for (const [handle, oldSpan] of oldSourceMap.nodeSpans.entries()) {
    const nextSpan = newSourceMap.nodeSpans.get(handle);
    if (nextSpan) {
      const nextLine = lineForSpan(newText, nextSpan);
      if (!nextLine || !queueReplacement(oldSpan, nextLine, 'node', handle)) return null;
    } else if (!queueReplacement(oldSpan, null)) {
      return null;
    }
  }
  for (const [handle, nextSpan] of newSourceMap.nodeSpans.entries()) {
    if (oldSourceMap.nodeSpans.has(handle)) continue;
    const nextLine = lineForSpan(newText, nextSpan);
    if (!nextLine) return null;
    additions.push(nextLine);
  }

  for (const [key, oldSpan] of oldSourceMap.connectionSpans.entries()) {
    const nextSpan = newSourceMap.connectionSpans.get(key);
    if (nextSpan) {
      const nextLine = lineForSpan(newText, nextSpan);
      if (!nextLine || !queueReplacement(oldSpan, nextLine, 'connection', key)) return null;
    } else if (!queueReplacement(oldSpan, null)) {
      return null;
    }
  }
  for (const [key, nextSpan] of newSourceMap.connectionSpans.entries()) {
    if (oldSourceMap.connectionSpans.has(key)) continue;
    const nextLine = lineForSpan(newText, nextSpan);
    if (!nextLine) return null;
    additions.push(nextLine);
  }

  const reconciled = oldLines.flatMap((line, index) => {
    if (!replacements.has(index)) return [line];
    const replacement = replacements.get(index) ?? null;
    return replacement === null ? [] : [replacement];
  });
  if (additions.length > 0) {
    const insertAt = findGraphCloseLine(reconciled);
    reconciled.splice(insertAt, 0, ...additions);
  }
  return reconciled.join('\n');
};
