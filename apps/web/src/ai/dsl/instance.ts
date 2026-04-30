import { HandleMap } from './handleMap';
import type { NodeInstance } from '../../store/types';

let sharedHandleMap: HandleMap | null = null;

export function getSharedHandleMap(): HandleMap {
  if (!sharedHandleMap) {
    sharedHandleMap = new HandleMap();
  }
  return sharedHandleMap;
}

export function deriveHandleMap(nodes: Map<string, NodeInstance>): HandleMap {
  const map = new HandleMap();
  for (const [nodeId, node] of nodes) {
    if (node.dslHandle) {
      map.set(node.dslHandle, nodeId);
    }
  }
  for (const [nodeId, node] of nodes) {
    if (!map.hasNodeId(nodeId)) {
      map.getOrCreate(nodeId, node.typeId);
    }
  }
  return map;
}

export function resetSharedHandleMap(): void {
  sharedHandleMap = null;
}
