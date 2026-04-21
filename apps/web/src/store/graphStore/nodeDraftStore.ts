/**
 * Per-Node Draft Store Registry
 *
 * Provides isolated Zustand stores for each node, enabling high-frequency
 * transient updates (slider drags, color picker drags, curve edits) without
 * triggering re-renders across the entire node graph.
 *
 * During a live interaction:
 *  - Only the interacting node's draft store updates
 *  - Only that node's React components re-render
 *  - The durable graph store (nodes Map) is untouched
 *  - The Worker engine gets the latest value via setParamAndRender
 *
 * On commit (pointerup):
 *  - Draft values flush to the durable graph store
 *  - Undo snapshot is pushed
 *
 * IMPORTANT: The draft store does NOT hold committed values. Committed params
 * come from the main Zustand store (nodes Map) and are passed into the hooks
 * by the calling component. The draft store only holds transient overrides.
 * This avoids calling setState during render.
 */

import { createStore, type StoreApi } from 'zustand';
import { useSyncExternalStore, useCallback } from 'react';
import type { ParamValue } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NodeDraftState {
  /** Draft param overrides during active interaction */
  draft: Record<string, ParamValue>;
  /** Draft input default overrides */
  draftDefaults: Record<string, ParamValue>;
  /** Keys currently being interacted with */
  interactingKeys: Set<string>;
}

// ---------------------------------------------------------------------------
// Registry (module-level, NOT inside any Zustand store)
// ---------------------------------------------------------------------------

const registry = new Map<string, StoreApi<NodeDraftState>>();

export function getOrCreateDraftStore(nodeId: string): StoreApi<NodeDraftState> {
  let store = registry.get(nodeId);
  if (!store) {
    store = createStore<NodeDraftState>(() => ({
      draft: {},
      draftDefaults: {},
      interactingKeys: new Set(),
    }));
    registry.set(nodeId, store);
  }
  return store;
}

export function getDraftStore(nodeId: string): StoreApi<NodeDraftState> | undefined {
  return registry.get(nodeId);
}

export function removeDraftStore(nodeId: string): void {
  registry.delete(nodeId);
}

/**
 * Sync committed params from the durable store into draft stores.
 * Called after undo/redo, import, or any bulk node update.
 * Cleans up stores for deleted nodes.
 */
export function syncAllCommitted(nodes: Map<string, { params: Record<string, ParamValue>; inputDefaults: Record<string, ParamValue> }>): void {
  // Clean up stores for deleted nodes
  for (const nodeId of registry.keys()) {
    if (!nodes.has(nodeId)) {
      registry.delete(nodeId);
    }
  }
}

// syncNodeCommitted is no longer needed — committed values come from hooks' parameters
// Kept as no-op for callsites that haven't been updated yet
export function syncNodeCommitted(
  _nodeId: string,
  _params: Record<string, ParamValue>,
  _inputDefaults: Record<string, ParamValue>,
): void {
  // no-op: committed values flow through hooks, not stored in draft
}

// ---------------------------------------------------------------------------
// Draft manipulation (called by ParamController)
// ---------------------------------------------------------------------------

export function setDraftParam(nodeId: string, key: string, value: ParamValue): void {
  const store = registry.get(nodeId);
  if (!store) return;
  const state = store.getState();
  store.setState({
    draft: { ...state.draft, [key]: value },
    interactingKeys: new Set(state.interactingKeys).add(key),
  });
}

export function setDraftInputDefault(nodeId: string, portName: string, value: ParamValue): void {
  const store = registry.get(nodeId);
  if (!store) return;
  const state = store.getState();
  store.setState({
    draftDefaults: { ...state.draftDefaults, [portName]: value },
    interactingKeys: new Set(state.interactingKeys).add(`__default__${portName}`),
  });
}

export function clearDraft(nodeId: string): void {
  const store = registry.get(nodeId);
  if (!store) return;
  store.setState({ draft: {}, draftDefaults: {}, interactingKeys: new Set() });
}

export function getDraftValues(
  nodeId: string,
  committed: Record<string, ParamValue>,
  committedDefaults: Record<string, ParamValue>,
): { params: Record<string, ParamValue>; inputDefaults: Record<string, ParamValue> } | null {
  const store = registry.get(nodeId);
  if (!store) return null;
  const state = store.getState();
  return {
    params: { ...committed, ...state.draft },
    inputDefaults: { ...committedDefaults, ...state.draftDefaults },
  };
}

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

/**
 * Subscribe to a single param value for a node.
 * Returns draft[key] if interacting, otherwise committed[key].
 * Only triggers re-render when THIS node's draft changes.
 */
export function useNodeParam(
  nodeId: string,
  key: string,
  committed: Record<string, ParamValue>,
): ParamValue | undefined {
  const store = getOrCreateDraftStore(nodeId);

  const getSnapshot = useCallback(
    () => {
      const s = store.getState();
      return key in s.draft ? s.draft[key] : committed[key];
    },
    [store, key, committed],
  );

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe to all effective params for a node.
 * Returns merged committed + draft params.
 * Only triggers re-render when THIS node's draft changes OR committed changes.
 */
export function useNodeParams(
  nodeId: string,
  committed: Record<string, ParamValue>,
): Record<string, ParamValue> {
  const store = getOrCreateDraftStore(nodeId);

  // Memoize the merged result to maintain reference stability
  const getSnapshot = useCallback(
    () => {
      const s = store.getState();
      if (Object.keys(s.draft).length === 0) {
        return committed;
      }
      return { ...committed, ...s.draft };
    },
    [store, committed],
  );

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe to a single input default value for a node.
 */
export function useNodeInputDefault(
  nodeId: string,
  portName: string,
  committedParams: Record<string, ParamValue>,
  committedDefaults: Record<string, ParamValue>,
): ParamValue | undefined {
  const store = getOrCreateDraftStore(nodeId);

  const getSnapshot = useCallback(
    () => {
      const s = store.getState();
      if (portName in s.draftDefaults) return s.draftDefaults[portName];
      if (portName in committedDefaults) return committedDefaults[portName];
      return committedParams[portName];
    },
    [store, portName, committedParams, committedDefaults],
  );

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe to all effective input defaults for a node.
 */
export function useNodeInputDefaults(
  nodeId: string,
  committedDefaults: Record<string, ParamValue>,
): Record<string, ParamValue> {
  const store = getOrCreateDraftStore(nodeId);

  const getSnapshot = useCallback(
    () => {
      const s = store.getState();
      if (Object.keys(s.draftDefaults).length === 0) {
        return committedDefaults;
      }
      return { ...committedDefaults, ...s.draftDefaults };
    },
    [store, committedDefaults],
  );

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
