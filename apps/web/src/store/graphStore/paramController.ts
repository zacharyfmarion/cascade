/**
 * ParamController — Coordination layer for parameter editing.
 *
 * Orchestrates the durable graph store, per-node draft stores, and the
 * Worker engine during high-frequency parameter interactions.
 *
 * Flow:
 *   setParamLive         → capture param delta + update draft + fire-and-coalesce render
 *   commitParamEdit      → flush delta → durable store → push undo → full render
 *   setInputDefaultLive  → same as setParamLive for input defaults
 *   commitInputDefault   → same as commitParamEdit for input defaults
 *
 * Undo uses lightweight param-delta snapshots (no exportGraph / Worker calls)
 * so that live renders are never blocked by undo bookkeeping.
 *
 * Live render scheduling uses a "fire-and-coalesce" pattern:
 *   - First tick: dispatch immediately to the Worker (no RAF delay)
 *   - While Worker is processing: coalesce incoming ticks (latest-wins)
 *   - When Worker returns: if a new mutation arrived, dispatch it immediately
 *   - This ensures at most ONE render is in-flight at a time, and the Worker
 *     always works on the freshest value.
 */

import type { ParamValue } from '../types';
import { useSettingsStore } from '../settingsStore';
import type { GraphState } from './store';
import {
  kernel,
  cloneEditingStack,
  downscaleRenderResult,
  getEngine,
} from './kernel';
import type { ParamDeltaSnapshot } from './kernel';
import {
  setDraftParam,
  setDraftInputDefault,
  clearDraft,
  syncNodeCommitted,
} from './nodeDraftStore';
import { parseEngineError } from '../../engine/engineError';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Zustand get/set accessors, injected by the slice that owns the controller */
type StoreGet = () => GraphState;
type StoreSet = (partial: Partial<GraphState>) => void;

type LiveMutation = {
  type: 'param' | 'inputDefault';
  nodeId: string;
  key: string;
  value: ParamValue;
};

// ---------------------------------------------------------------------------
// Module state for live render scheduling
// ---------------------------------------------------------------------------

/** Whether a live render round-trip (main→Worker→main) is currently in flight. */
let liveRenderInFlight = false;

/** The next mutation to dispatch when the current in-flight render completes. */
let pendingMutation: {
  mutation: LiveMutation;
  liveScale: number;
  get: StoreGet;
  set: StoreSet;
} | null = null;

// ---------------------------------------------------------------------------
// Internal helpers — Param-delta undo (FULLY SYNCHRONOUS)
// ---------------------------------------------------------------------------

/**
 * Capture a lightweight param-delta snapshot on the FIRST drag tick.
 * This is entirely synchronous — no Worker calls, no exportGraph, no
 * collectImageData. Just records the old value and clones the Zustand state.
 */
function captureParamDelta(
  editType: 'param' | 'inputDefault',
  nodeId: string,
  key: string,
  get: StoreGet,
): void {
  if (kernel.preCommitSnapshot) return; // already captured for this drag

  const node = get().nodes.get(nodeId);
  const oldValue =
    editType === 'param'
      ? node?.params[key]
      : node?.inputDefaults?.[key];

  kernel.preCommitSnapshot = {
    kind: 'param-delta',
    editType,
    nodeId,
    key,
    oldValue,
    nodes: new Map(get().nodes),
    connections: [...get().connections],
    frames: new Map(get().frames),
    editingStack: cloneEditingStack(get().editingStack),
    sequenceInfoMap: new Map(get().sequenceInfoMap),
  };
}

/**
 * Flush the captured param-delta to the undo stack. Synchronous — just
 * fills in the newValue and pushes.
 */
function flushParamDelta(newValue: ParamValue, set: StoreSet): void {
  const snap = kernel.preCommitSnapshot;
  if (!snap) return;

  if (!('kind' in snap) || snap.kind !== 'param-delta') {
    // Shouldn't happen, but guard against it
    kernel.preCommitSnapshot = null;
    return;
  }

  const delta: ParamDeltaSnapshot = { ...snap, newValue };
  kernel.undoStack.push(delta);
  if (kernel.undoStack.length > useSettingsStore.getState().maxUndoSteps) {
    kernel.undoStack.shift();
  }
  kernel.redoStack.length = 0;
  kernel.preCommitSnapshot = null;
  set({ canUndo: true, canRedo: false });
}

// ---------------------------------------------------------------------------
// Internal helpers — timings
// ---------------------------------------------------------------------------

function cancelLiveState(): void {
  pendingMutation = null;
  // liveRenderInFlight is NOT cleared here — the in-flight render will
  // complete and clear it naturally. We just ensure no new dispatches
  // happen after commit.
}

async function updateNodeTimings(get: StoreGet, set: StoreSet): Promise<void> {
  const timings = await Promise.resolve(getEngine().getLastRenderTimings?.());
  if (timings) {
    const prev = get().nodeTimings;
    const merged = new Map(prev);
    for (const [nodeId, value] of Object.entries(timings)) {
      if (value > 0) {
        merged.set(nodeId, value);
      }
    }
    set({ nodeTimings: merged });
  }
}

// ---------------------------------------------------------------------------
// Live render dispatch — fire-and-coalesce pattern
// ---------------------------------------------------------------------------

/**
 * Dispatch a single live render to the Worker. When it completes, check
 * if a newer mutation arrived while we were rendering. If so, dispatch
 * that one immediately (latest-wins). Otherwise, mark idle.
 *
 * This guarantees at most ONE render in flight at a time, and the Worker
 * always processes the freshest mutation when it becomes free.
 */
function dispatchLiveRender(
  mutation: LiveMutation,
  liveScale: number,
  get: StoreGet,
  set: StoreSet,
): void {
  liveRenderInFlight = true;
    ++kernel.liveRenderGeneration;
  const eng = getEngine();

  if (eng.setAndRender) {
    eng.setAndRender(mutation, get().currentFrame).then(async results => {
      // ALWAYS display whatever the Worker produced — even if a newer
      // mutation is pending. Showing a slightly-stale frame is far better
      // than showing nothing during a drag. The next render (dispatched
      // below) will update to the freshest value.
      if (results.length > 0) {
        const newResults = new Map(get().renderResults);
        for (const [vid, r] of results) {
          const scaled = await downscaleRenderResult(r, liveScale);
          newResults.set(vid, scaled);
        }
        set({ renderResults: newResults, lastError: null });
        updateNodeTimings(get, set);
      }

      // If a newer mutation arrived while we were rendering, dispatch it now.
      if (pendingMutation) {
        const next = pendingMutation;
        pendingMutation = null;
        dispatchLiveRender(next.mutation, next.liveScale, next.get, next.set);
      } else {
        liveRenderInFlight = false;
      }
    }).catch((e: unknown) => {
      // On error, still drain pending to keep the pipeline alive.
      if (pendingMutation) {
        const next = pendingMutation;
        pendingMutation = null;
        dispatchLiveRender(next.mutation, next.liveScale, next.get, next.set);
      } else {
        liveRenderInFlight = false;
      }

      const error = parseEngineError(e);
      if (error.code !== 'MISSING_INPUT') { set({ lastError: error }); }
    });
  } else {
    // Fallback: non-Worker path (synchronous engine)
    if (mutation.type === 'param') {
      eng.setParam(mutation.nodeId, mutation.key, mutation.value);
    } else {
      eng.setInputDefault(mutation.nodeId, mutation.key, mutation.value);
    }
    liveRenderInFlight = false;
    get().triggerAffectedViewers([mutation.nodeId]);
  }
}

/**
 * Schedule a live render. If no render is in-flight, dispatch immediately.
 * If a render is in-flight, replace the pending mutation (latest-wins).
 *
 * No RAF is used — dispatch is immediate when the Worker is idle, and
 * coalescing happens naturally while the Worker is busy (~200ms renders
 * mean we get ~5fps during drags, which is acceptable for preview).
 */
function scheduleLiveRender(
  mutation: LiveMutation,
  liveScale: number,
  get: StoreGet,
  set: StoreSet,
): void {
  if (liveRenderInFlight) {
    // A render is in-flight — just replace the pending mutation.
    // When the in-flight render completes, it will dispatch this one.
    pendingMutation = { mutation, liveScale, get, set };
    return;
  }

  // No render in-flight — dispatch immediately.
  dispatchLiveRender(mutation, liveScale, get, set);
}

/**
 * Atomic set + render for commit (pointerup). Not coalesced.
 * Returns after the render completes.
 */
async function commitRender(
  mutation: LiveMutation,
  get: StoreGet,
  set: StoreSet,
): Promise<void> {
  const eng = getEngine();

  if (eng.setAndRender) {
    const renderGeneration = ++kernel.liveRenderGeneration;
    try {
      const results = await eng.setAndRender(mutation, get().currentFrame);
      if (renderGeneration !== kernel.liveRenderGeneration) return;
      if (results.length > 0) {
        const newResults = new Map(get().renderResults);
        for (const [vid, r] of results) {
          const scaled = await downscaleRenderResult(r, 1);
          newResults.set(vid, scaled);
        }
        if (renderGeneration !== kernel.liveRenderGeneration) return;
        set({ renderResults: newResults, lastError: null });
        updateNodeTimings(get, set);
      }
    } catch (e: unknown) {
      const error = parseEngineError(e);
      if (error.code !== 'MISSING_INPUT') { set({ lastError: error }); }
    }
  } else {
    if (mutation.type === 'param') {
      await eng.setParam(mutation.nodeId, mutation.key, mutation.value);
    } else {
      await eng.setInputDefault(mutation.nodeId, mutation.key, mutation.value);
    }
    get().triggerAffectedViewers([mutation.nodeId]);
  }
}

// ---------------------------------------------------------------------------
// Public API — Params
// ---------------------------------------------------------------------------

/**
 * Live parameter update during drag. Updates draft store + engine only.
 * The durable nodes Map is NOT touched — zero React re-renders on other nodes.
 *
 * Undo snapshot is a synchronous param-delta (no Worker calls).
 */
export function setParamLive(
  nodeId: string,
  key: string,
  value: ParamValue,
  get: StoreGet,
  set: StoreSet,
): void {
  captureParamDelta('param', nodeId, key, get);
  setDraftParam(nodeId, key, value);

  const liveScale = useSettingsStore.getState().livePreviewScale;
  if (get().previewScale !== liveScale) {
    set({ previewScale: liveScale });
  }

  scheduleLiveRender(
    { type: 'param', nodeId, key, value },
    liveScale, get, set,
  );
}

/**
 * Commit the param edit (pointerup). Flushes delta → undo stack,
 * updates durable store, renders at full resolution.
 */
export async function commitParamEdit(
  nodeId: string,
  key: string,
  value: ParamValue,
  get: StoreGet,
  set: StoreSet,
): Promise<void> {
  flushParamDelta(value, set);

  const newNodes = new Map(get().nodes);
  const node = newNodes.get(nodeId);
  if (node) {
    node.params = { ...node.params, [key]: value };
    newNodes.set(nodeId, { ...node });
    set({ nodes: newNodes, previewScale: 1, dirty: true });
  } else {
    set({ previewScale: 1 });
  }

  clearDraft(nodeId);
  if (node) {
    syncNodeCommitted(nodeId, node.params, node.inputDefaults);
  }

  cancelLiveState();
  await commitRender({ type: 'param', nodeId, key, value }, get, set);
}

// ---------------------------------------------------------------------------
// Public API — Input Defaults
// ---------------------------------------------------------------------------

/**
 * Live input default update during drag. Same architecture as setParamLive:
 * draft store + atomic engine call, no durable store update.
 */
export function setInputDefaultLive(
  nodeId: string,
  portName: string,
  value: ParamValue,
  get: StoreGet,
  set: StoreSet,
): void {
  captureParamDelta('inputDefault', nodeId, portName, get);
  setDraftInputDefault(nodeId, portName, value);

  const liveScale = useSettingsStore.getState().livePreviewScale;
  if (get().previewScale !== liveScale) {
    set({ previewScale: liveScale });
  }

  scheduleLiveRender(
    { type: 'inputDefault', nodeId, key: portName, value },
    liveScale, get, set,
  );
}

/**
 * Commit input default edit. Same flow as commitParamEdit.
 */
export async function commitInputDefault(
  nodeId: string,
  portName: string,
  value: ParamValue,
  get: StoreGet,
  set: StoreSet,
): Promise<void> {
  flushParamDelta(value, set);

  const newNodes = new Map(get().nodes);
  const node = newNodes.get(nodeId);
  if (node) {
    node.inputDefaults = { ...node.inputDefaults, [portName]: value };
    newNodes.set(nodeId, { ...node });
    set({ nodes: newNodes, previewScale: 1, dirty: true });
  } else {
    set({ previewScale: 1 });
  }

  clearDraft(nodeId);
  if (node) {
    syncNodeCommitted(nodeId, node.params, node.inputDefaults);
  }

  cancelLiveState();
  await commitRender({ type: 'inputDefault', nodeId, key: portName, value }, get, set);
}
