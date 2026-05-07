import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { BatchInfo } from '../../../engine/bridge';
import type { NodeInstance } from '../../types';
import { isSequenceInfo } from '../kernel';

export type MediaIteratorKind = 'batch' | 'sequence' | 'video';

export interface MediaIteratorInfo {
  sourceNodeId: string;
  kind: MediaIteratorKind;
  label: string;
  startFrame: number;
  endFrame: number;
  count: number;
  itemLabels: string[];
  supportsRandomAccess: boolean;
}

export interface MediaIteratorSliceState {
  batchInfoMap: Map<string, BatchInfo>;
  mediaIteratorInfoMap: Map<string, MediaIteratorInfo>;
  activeTransportSourceId: string | null;
}

export interface MediaIteratorSliceActions {
  setBatchInfo: (nodeId: string, info: BatchInfo | null) => void;
  setActiveTransportSource: (nodeId: string | null) => void;
  suggestActiveTransportSourceForViewer: (viewerNodeId: string | null) => void;
  recomputeMediaIteratorState: () => void;
}

export type MediaIteratorSlice = MediaIteratorSliceState & MediaIteratorSliceActions;

const MEDIA_NODE_TYPES: Record<string, MediaIteratorKind> = {
  load_image_batch: 'batch',
  load_image_sequence: 'sequence',
  load_video: 'video',
};

const pathBasename = (path: string): string => (
  path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path
);

const stringParam = (node: NodeInstance, key: string): string => {
  const value = node.params?.[key];
  return value && typeof value === 'object' && 'String' in value ? String(value.String) : '';
};

const sourceLabel = (
  nodeId: string,
  kind: MediaIteratorKind,
  node: NodeInstance,
  count: number,
): string => {
  if (kind === 'batch') {
    const directory = stringParam(node, 'directory');
    if (directory) return pathBasename(directory);
    const files = stringParam(node, 'files');
    if (files) return `${count} images`;
    return 'Image batch';
  }
  if (kind === 'sequence') {
    const directory = stringParam(node, 'directory');
    return directory ? pathBasename(directory) : 'Image sequence';
  }
  const filePath = stringParam(node, 'file_path');
  return filePath ? pathBasename(filePath) : nodeId;
};

const findNearestMediaSource = (
  nodes: GraphState['nodes'],
  connections: GraphState['connections'],
  startNodeId: string,
): string | null => {
  const visited = new Set<string>();
  const queue = [startNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodes.get(nodeId);
    if (node && MEDIA_NODE_TYPES[node.typeId]) {
      return nodeId;
    }

    for (const connection of connections) {
      if (connection.toNode === nodeId && !visited.has(connection.fromNode)) {
        queue.push(connection.fromNode);
      }
    }
  }

  return null;
};

export const createMediaIteratorSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  MediaIteratorSlice
> = (set, get) => {
  const recomputeMediaIteratorState = () => {
    const { nodes, sequenceInfoMap, batchInfoMap } = get();
    const iterators = new Map<string, MediaIteratorInfo>();

    for (const [nodeId, node] of nodes) {
      const kind = MEDIA_NODE_TYPES[node.typeId];
      if (!kind) continue;

      if (kind === 'batch') {
        const info = batchInfoMap.get(nodeId);
        const count = info?.count ?? 0;
        if (count <= 0) continue;
        iterators.set(nodeId, {
          sourceNodeId: nodeId,
          kind,
          label: sourceLabel(nodeId, kind, node, count),
          startFrame: 0,
          endFrame: count - 1,
          count,
          itemLabels: info?.filenames ?? [],
          supportsRandomAccess: true,
        });
        continue;
      }

      const info = sequenceInfoMap.get(nodeId);
      const count = info?.frame_count ?? 0;
      if (!info || count <= 0) continue;
      const startFrame = isSequenceInfo(info) ? info.first_frame : 0;
      const endFrame = isSequenceInfo(info) ? info.last_frame : count - 1;
      iterators.set(nodeId, {
        sourceNodeId: nodeId,
        kind,
        label: sourceLabel(nodeId, kind, node, count),
        startFrame,
        endFrame,
        count,
        itemLabels: [],
        supportsRandomAccess: true,
      });
    }

    const previousActive = get().activeTransportSourceId;
    const activeTransportSourceId = previousActive && iterators.has(previousActive)
      ? previousActive
      : iterators.keys().next().value ?? null;
    const active = activeTransportSourceId
      ? iterators.get(activeTransportSourceId) ?? null
      : null;
    const currentFrame = get().currentFrame;
    const clampedFrame = active
      ? Math.max(active.startFrame, Math.min(currentFrame, active.endFrame))
      : currentFrame;

    set({
      mediaIteratorInfoMap: iterators,
      activeTransportSourceId,
      hasSequenceNodes: iterators.size > 0,
      sequenceStart: active?.startFrame ?? 0,
      sequenceLength: active?.endFrame ?? 0,
      currentFrame: clampedFrame,
    });
  };

  return {
    batchInfoMap: new Map(),
    mediaIteratorInfoMap: new Map(),
    activeTransportSourceId: null,

    setBatchInfo: (nodeId, info) => {
      const next = new Map(get().batchInfoMap);
      if (info && info.count > 0) {
        next.set(nodeId, info);
      } else {
        next.delete(nodeId);
      }
      set({ batchInfoMap: next });
      recomputeMediaIteratorState();
    },

    setActiveTransportSource: (nodeId) => {
      const active = nodeId ? get().mediaIteratorInfoMap.get(nodeId) : null;
      const currentFrame = get().currentFrame;
      set({
        activeTransportSourceId: active ? nodeId : null,
        sequenceStart: active?.startFrame ?? 0,
        sequenceLength: active?.endFrame ?? 0,
        currentFrame: active
          ? Math.max(active.startFrame, Math.min(currentFrame, active.endFrame))
          : currentFrame,
      });
      if (active && currentFrame !== get().currentFrame) {
        get().triggerAllViewers();
      }
    },

    suggestActiveTransportSourceForViewer: (viewerNodeId) => {
      if (!viewerNodeId) return;
      const sourceId = findNearestMediaSource(get().nodes, get().connections, viewerNodeId);
      if (sourceId && get().mediaIteratorInfoMap.has(sourceId)) {
        get().setActiveTransportSource(sourceId);
      }
    },

    recomputeMediaIteratorState,
  };
};
