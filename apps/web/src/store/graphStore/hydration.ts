import type { NodeInstance, NodeSpec, ParamValue } from '../types';
import type { GraphState } from './store';
import type { SequenceInfo, VideoInfo } from '../../engine/bridge';
import { makeEngineError } from '../../engine/engineError';
import { extractCustomGroupDefinitions, extractGraphData, getEngine, normalizeParamValue } from './kernel';
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

const stringParam = (node: NodeInstance, key: string): string | null => {
  const value = node.params[key];
  return value && 'String' in value && value.String ? value.String : null;
};

const nativePathFromUri = (value: string): string =>
  value.startsWith('file://') ? decodeURI(value.slice('file://'.length)) : value;

async function hydratePersistedMediaSources(
  nodes: Map<string, NodeInstance>,
  set: (partial: Partial<GraphState>) => void,
  get: () => GraphState,
): Promise<void> {
  const eng = getEngine();
  const sequenceInfoMap = new Map<string, SequenceInfo | VideoInfo>();

  for (const [nodeId, node] of nodes) {
    if (node.typeId === 'load_image_sequence') {
      const directory = stringParam(node, 'directory');
      if (!directory || !eng.setSequenceDirectory) continue;
      try {
        await Promise.resolve(eng.setSequenceDirectory(nodeId, nativePathFromUri(directory)));
        const pattern = stringParam(node, 'pattern');
        const info = pattern && eng.getSequenceInfo
          ? await Promise.resolve(eng.getSequenceInfo(nodeId, pattern))
          : null;
        if (info) sequenceInfoMap.set(nodeId, info);
      } catch {
        // Keep project load non-fatal if a saved media path is unavailable.
      }
      continue;
    }

    if (node.typeId === 'load_video') {
      const filePath = stringParam(node, 'file_path');
      if (!filePath || !eng.loadVideoFile) continue;
      try {
        const info = await Promise.resolve(eng.loadVideoFile(nodeId, nativePathFromUri(filePath)));
        sequenceInfoMap.set(nodeId, info);
      } catch {
        // Keep project load non-fatal if a saved media path is unavailable.
      }
    }
  }

  let hasSequenceNodes = false;
  let minStart = Infinity;
  let maxEnd = 0;
  for (const node of nodes.values()) {
    if (node.typeId === 'load_image_sequence' || node.typeId === 'load_video') {
      hasSequenceNodes = true;
      break;
    }
  }
  for (const info of sequenceInfoMap.values()) {
    if ('first_frame' in info && info.frame_count > 0) {
      minStart = Math.min(minStart, info.first_frame);
      maxEnd = Math.max(maxEnd, info.last_frame);
    } else if ('frame_count' in info && info.frame_count > 0) {
      minStart = Math.min(minStart, 0);
      maxEnd = Math.max(maxEnd, info.frame_count - 1);
    }
  }
  if (minStart === Infinity) minStart = 0;

  const currentFrame = get().currentFrame;
  set({
    sequenceInfoMap,
    hasSequenceNodes,
    sequenceStart: minStart,
    sequenceLength: maxEnd,
    currentFrame: maxEnd > 0 && (currentFrame < minStart || currentFrame > maxEnd)
      ? minStart
      : currentFrame,
  });
}

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
      // __script_manifest is an internal hidden param not declared in the spec.
      // Preserve it so ScriptNodeEditor can show the saved GLSL after project load.
      if (node.type_id.startsWith('gpu_script::') && node.params?.['__script_manifest']) {
        params['__script_manifest'] = normalizeParamValue(node.params['__script_manifest'] as ParamValue);
      }

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
    customGroupDefinitions: extractCustomGroupDefinitions(graphData),
    selectedNodeIds: new Set(),
    renderResults: new Map(),
    editingStack: createRootEditingStack(),
    dirty: false,
    lastError: null,
    lastTransactionOrigin: null,
    fitViewRequestId: get().fitViewRequestId + 1,
  };

  if (options.resetFrames ?? false) {
    nextState.frames = new Map();
    nextState.selectedFrameId = null;
  }

  set(nextState);
  await hydratePersistedMediaSources(nodes, set, get);
  syncAllCommitted(nodes);

  if (options.triggerViewers ?? true) {
    get().triggerAllViewers();
  }

  return { graphData, nodeSpecs };
}
