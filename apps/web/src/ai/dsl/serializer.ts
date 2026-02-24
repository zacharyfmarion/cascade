import { HandleMap } from './handleMap';
import type { DslParamValue } from './types';
import { snakeToPascal, labelToSnake } from './types';
import type { NodeInstance, Connection, NodeSpec, ParamValue, ParamSpec } from '../../store/types';
import { isConnectableParam } from '../../store/types';
import { useGraphStore } from '../../store/graphStore';

export interface SerializerInput {
  nodes: Map<string, NodeInstance>;
  connections: Connection[];
  nodeSpecs: NodeSpec[];
  handleMap: HandleMap;
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

const formatDslValue = (paramValue: DslParamValue): string => {
  switch (paramValue.type) {
    case 'float':
      return formatFloat(paramValue.value);
    case 'int':
      return `${paramValue.value}`;
    case 'bool':
      return paramValue.value ? 'true' : 'false';
    case 'string':
      return `"${paramValue.value}"`;
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

const formatParamEntry = (paramSpec: ParamSpec, paramValue: ParamValue): string => {
  const dslValue = unwrapParamValue(paramSpec, paramValue);
  return `${paramSpec.key}: ${formatDslValue(dslValue)}`;
};

const shouldIncludeParam = (paramSpec: ParamSpec, paramValue: ParamValue | undefined): paramValue is ParamValue => {
  if (!paramValue) return false;
  return JSON.stringify(paramValue) !== JSON.stringify(paramSpec.default);
};

const topologicalOrder = (nodes: Map<string, NodeInstance>, connections: Connection[], handleMap: HandleMap): NodeInstance[] => {
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

  const getHandle = (nodeId: string): string => handleMap.getOrCreate(nodeId, nodes.get(nodeId)?.typeId ?? 'node');

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

export function serializeGraph(input: SerializerInput): string {
  const { nodes, connections, nodeSpecs, handleMap } = input;
  const nodeSpecById = new Map(nodeSpecs.map((spec) => [spec.id, spec]));

  const orderedNodes = topologicalOrder(nodes, connections, handleMap);

  const nodeLines = orderedNodes.map((node) => {
    const spec = nodeSpecById.get(node.typeId);
    const handle = handleMap.getOrCreate(node.id, node.typeId);
    if (!node.dslHandle || node.dslHandle !== handle) {
      useGraphStore.getState().setDslHandle(node.id, handle);
    }
    const typeName = spec ? snakeToPascal(spec.id) : snakeToPascal(node.typeId);

    const params: string[] = [];
    if (spec) {
      for (const paramSpec of spec.params) {
        const source = isConnectableParam(paramSpec) ? node.inputDefaults : node.params;
        const value = source[paramSpec.key];
        if (!shouldIncludeParam(paramSpec, value)) continue;
        params.push(formatParamEntry(paramSpec, value));
      }
    }

    const paramSection = params.join(', ');
    const mutedPrefix = node.muted ? '@muted ' : '';
    return `${mutedPrefix}${handle} = ${typeName}(${paramSection})`;
  });

  const connectionLines = connections
    .filter((connection) => nodes.has(connection.fromNode) && nodes.has(connection.toNode))
    .map((connection) => {
      const fromHandle = handleMap.getOrCreate(connection.fromNode, nodes.get(connection.fromNode)?.typeId ?? 'node');
      const toHandle = handleMap.getOrCreate(connection.toNode, nodes.get(connection.toNode)?.typeId ?? 'node');
      return {
        line: `${toHandle}.${connection.toPort} <- ${fromHandle}.${connection.fromPort}`,
        sortKey: `${toHandle}|${connection.toPort}`,
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map((entry) => entry.line);

  if (connectionLines.length === 0) {
    return nodeLines.join('\n');
  }

  return `${nodeLines.join('\n')}\n\n${connectionLines.join('\n')}`;
}
