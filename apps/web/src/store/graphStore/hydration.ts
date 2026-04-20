import type { NodeInstance, NodeSpec, ParamValue } from '../types';
import type { GraphState } from './store';
import { makeEngineError } from '../../engine/engineError';
import { extractGraphData, getEngine, normalizeParamValue } from './kernel';
import type { SerializableGraphData } from './kernel';
import { syncAllCommitted } from './nodeDraftStore';

type RootHydrationOptions = {
  graphData?: SerializableGraphData;
  nodeSpecs?: NodeSpec[];
  resetFrames?: boolean;
  triggerViewers?: boolean;
};

type RootHydrationResult = {
  graphData: SerializableGraphData;
  nodeSpecs: NodeSpec[];
};

type RootGraphBuildResult = {
  nodes: Map<string, NodeInstance>;
  connections: GraphState['connections'];
  nodeSpecsById: Map<string, NodeSpec>;
};

const createRootEditingStack = (): GraphState['editingStack'] => [{ id: 'root', label: 'Root' }];

async function buildRootGraphState(
  graphData: SerializableGraphData,
  nodeSpecs: NodeSpec[],
): Promise<RootGraphBuildResult> {
  const eng = getEngine();
  const specsByTypeId = new Map(nodeSpecs.map(spec => [spec.id, spec]));
  const nodeSpecsById = new Map<string, NodeSpec>();
  const newNodes = new Map<string, NodeInstance>();
  const newConnections: GraphState['connections'] = [];
  const missingTypeIds = new Set<string>();

  if (Array.isArray(graphData.nodes)) {
    for (const node of graphData.nodes) {
      let spec = specsByTypeId.get(node.type_id);

      if (!spec && eng.getNodeSpec) {
        try {
          spec = await Promise.resolve(eng.getNodeSpec(node.id));
          nodeSpecsById.set(node.id, spec);
        } catch {
          missingTypeIds.add(node.type_id);
          continue;
        }
      }

      if (!spec) {
        missingTypeIds.add(node.type_id);
        continue;
      }

      const params: Record<string, ParamValue> = {};
      spec.params.forEach(param => {
        const rawValue = node.params?.[param.key] ?? param.default;
        params[param.key] = normalizeParamValue(rawValue as ParamValue);
      });

      const [x, y] = node.position;
      newNodes.set(node.id, {
        id: node.id,
        typeId: node.type_id,
        params,
        inputDefaults: node.input_defaults ?? {},
        position: { x, y },
        muted: node.muted ?? false,
      });
    }
  }

  if (missingTypeIds.size > 0) {
    throw makeEngineError(
      `Project references unsupported node types after hydration: ${[...missingTypeIds].sort().join(', ')}`,
      'UNKNOWN_NODE_TYPE',
      'graph'
    );
  }

  if (Array.isArray(graphData.connections)) {
    for (const conn of graphData.connections) {
      newConnections.push({
        id: crypto.randomUUID(),
        fromNode: conn.from_node,
        fromPort: conn.from_port,
        toNode: conn.to_node,
        toPort: conn.to_port,
      });
    }
  }

  return {
    nodes: newNodes,
    connections: newConnections,
    nodeSpecsById,
  };
}

export async function hydrateRootGraphFromEngine(
  set: (partial: Partial<GraphState>) => void,
  get: () => GraphState,
  options: RootHydrationOptions = {},
): Promise<RootHydrationResult> {
  const eng = getEngine();
  const nodeSpecs = options.nodeSpecs ?? await Promise.resolve(eng.listNodeTypes());
  const graphData = options.graphData
    ?? extractGraphData(await Promise.resolve(eng.exportGraph()));
  const { nodes, connections, nodeSpecsById } = await buildRootGraphState(graphData, nodeSpecs);

  const nextState: Partial<GraphState> = {
    nodes,
    connections,
    nodeSpecs,
    nodeSpecsById,
    selectedNodeIds: new Set(),
    renderResults: new Map(),
    editingStack: createRootEditingStack(),
    dirty: false,
    lastError: null,
    fitViewRequestId: get().fitViewRequestId + 1,
  };

  if (options.resetFrames ?? false) {
    nextState.frames = new Map();
    nextState.selectedFrameId = null;
  }

  set(nextState);
  syncAllCommitted(nodes);

  if (options.triggerViewers ?? true) {
    get().triggerAllViewers();
  }

  return { graphData, nodeSpecs };
}
