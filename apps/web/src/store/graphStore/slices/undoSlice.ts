import type { ParamValue } from '../../types';
import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import { kernel, cloneEditingStack, getEngine } from '../kernel';
import type { UndoSnapshot, ParamDeltaSnapshot, MuteDeltaSnapshot } from '../kernel';
import { isParamDelta, isMuteDelta } from '../kernel';
import { syncAllCommitted } from '../nodeDraftStore';
import { sequenceFrameManager } from '../../../engine/sequenceFrameManager';
import { useSettingsStore } from '../../settingsStore';

// ---------------------------------------------------------------------------
// Slice interface
// ---------------------------------------------------------------------------

export interface UndoSliceState {
  canUndo: boolean;
  canRedo: boolean;
}

export interface UndoSliceActions {
  undo: () => void;
  redo: () => void;
  pushUndo: () => Promise<void>;
  /** Capture a full undo snapshot of the current graph state. */
  captureSnapshot: () => Promise<UndoSnapshot>;
  /** Collect raw image bytes from all load_image nodes (for undo snapshots). */
  collectImageData: () => Promise<Map<string, Uint8Array>>;
}

export type UndoSlice = UndoSliceState & UndoSliceActions;

// ---------------------------------------------------------------------------
// Slice creator
// ---------------------------------------------------------------------------

export const createUndoSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  UndoSlice
> = (set, get) => {
  // -- internal helpers (not exposed on the store) --------------------------

  const restoreSnapshot = async (snapshot: UndoSnapshot) => {
    await getEngine().importGraph(snapshot.engineState);

    const eng = getEngine();
    for (const [nodeId, bytes] of snapshot.imageData) {
      try {
        await Promise.resolve(eng.loadImageData(nodeId, bytes));
      } catch {
        // Node may not exist in this snapshot state
      }
    }

    set({
      nodes: new Map(snapshot.nodes),
      connections: [...snapshot.connections],
      frames: new Map(snapshot.frames),
      editingStack: cloneEditingStack(snapshot.editingStack),
      selectedNodeIds: new Set(),
      selectedFrameId: null,
      renderResults: new Map(),
      canUndo: kernel.undoStack.length > 0,
      canRedo: kernel.redoStack.length > 0,
      sequenceInfoMap: new Map(snapshot.sequenceInfoMap),
    });

    get().recomputeSequenceState();

    for (const [nodeId, node] of snapshot.nodes) {
      if (node.typeId !== 'load_image_sequence') continue;
      if (sequenceFrameManager.hasSequence(nodeId)) {
        const frame = get().currentFrame;
        const data = await sequenceFrameManager.getFrameData(nodeId, frame);
        if (data && eng.loadSequenceFrameData) {
          await eng.loadSequenceFrameData(nodeId, frame, data);
        }
      } else if (eng.setSequenceDirectory && snapshot.sequenceInfoMap.has(nodeId)) {
        const dirParam = node.params['directory'];
        if (dirParam && 'String' in dirParam && dirParam.String) {
          try {
            await eng.setSequenceDirectory(nodeId, dirParam.String);
          } catch {
            // Directory may no longer exist
          }
        }
      }
    }

    get().triggerAllViewers();
    syncAllCommitted(get().nodes);
  };

  /**
   * Restore a lightweight param-delta snapshot.
   * Sets the old param/inputDefault value in the engine (one Worker call),
   * restores Zustand state, and re-renders affected viewers.
   */
  const restoreParamDelta = async (delta: ParamDeltaSnapshot, valueToApply: ParamValue | undefined) => {
    const eng = getEngine();

    // Apply the param change in the engine
    if (valueToApply !== undefined) {
      if (delta.editType === 'param') {
        await eng.setParam(delta.nodeId, delta.key, valueToApply);
      } else {
        await eng.setInputDefault(delta.nodeId, delta.key, valueToApply);
      }
    }

    // Restore Zustand state from the snapshot
    set({
      nodes: new Map(delta.nodes),
      connections: [...delta.connections],
      frames: new Map(delta.frames),
      editingStack: cloneEditingStack(delta.editingStack),
      selectedNodeIds: new Set(),
      selectedFrameId: null,
      renderResults: new Map(),
      canUndo: kernel.undoStack.length > 0,
      canRedo: kernel.redoStack.length > 0,
      sequenceInfoMap: new Map(delta.sequenceInfoMap),
    });

    get().triggerAllViewers();
    syncAllCommitted(get().nodes);
  };

  /**
   * Restore a lightweight mute-delta snapshot.
   * Applies oldMuted/newMuted for each entry in the engine, restores Zustand
   * state, and re-renders affected viewers.
   */
  const restoreMuteDelta = async (delta: MuteDeltaSnapshot, direction: 'undo' | 'redo') => {
    const eng = getEngine();

    for (const entry of delta.entries) {
      const muted = direction === 'undo' ? entry.oldMuted : entry.newMuted;
      await Promise.resolve(eng.setMuted(entry.nodeId, muted));
    }

    // Restore Zustand state from the snapshot
    set({
      nodes: new Map(delta.nodes),
      connections: [...delta.connections],
      frames: new Map(delta.frames),
      editingStack: cloneEditingStack(delta.editingStack),
      selectedNodeIds: new Set(),
      selectedFrameId: null,
      renderResults: new Map(),
      canUndo: kernel.undoStack.length > 0,
      canRedo: kernel.redoStack.length > 0,
      sequenceInfoMap: new Map(delta.sequenceInfoMap),
    });

    get().triggerAllViewers();
    syncAllCommitted(get().nodes);
  };

  /**
   * Create a reverse mute-delta snapshot (for redo stack when undoing,
   * or for undo stack when redoing).
   */
  const createReverseMuteDelta = (delta: MuteDeltaSnapshot): MuteDeltaSnapshot => ({
    kind: 'mute-delta',
    entries: delta.entries.map(e => ({
      nodeId: e.nodeId,
      oldMuted: e.newMuted,
      newMuted: e.oldMuted,
    })),
    nodes: new Map(get().nodes),
    connections: [...get().connections],
    frames: new Map(get().frames),
    editingStack: cloneEditingStack(get().editingStack),
    sequenceInfoMap: new Map(get().sequenceInfoMap),
  });

  /**
   * Create a reverse param-delta snapshot (for redo stack when undoing a delta,
   * or for undo stack when redoing a delta).
   */
  const createReverseDelta = (delta: ParamDeltaSnapshot): ParamDeltaSnapshot => ({
    kind: 'param-delta',
    editType: delta.editType,
    nodeId: delta.nodeId,
    key: delta.key,
    oldValue: delta.newValue,
    newValue: delta.oldValue,
    nodes: new Map(get().nodes),
    connections: [...get().connections],
    frames: new Map(get().frames),
    editingStack: cloneEditingStack(get().editingStack),
    sequenceInfoMap: new Map(get().sequenceInfoMap),
  });

  // -- public slice ---------------------------------------------------------

  const collectImageData = async (): Promise<Map<string, Uint8Array>> => {
    const imgData = new Map<string, Uint8Array>();
    for (const [nodeId, node] of get().nodes) {
      if (node.typeId !== 'load_image') continue;
      try {
        const bytes = await get().getImageData(nodeId);
        if (bytes) imgData.set(nodeId, bytes);
      } catch {
        // Node may not have image loaded yet
      }
    }
    return imgData;
  };

  const captureSnapshot = async (): Promise<UndoSnapshot> => ({
    engineState: await getEngine().exportGraph(),
    nodes: new Map(get().nodes),
    connections: [...get().connections],
    frames: new Map(get().frames),
    editingStack: cloneEditingStack(get().editingStack),
    imageData: await collectImageData(),
    sequenceInfoMap: new Map(get().sequenceInfoMap),
  });

  return {
    canUndo: false,
    canRedo: false,

    undo: () => {
      const snapshot = kernel.undoStack.pop();
      if (!snapshot) return;

      kernel.undoLock = kernel.undoLock.then(async () => {
        if (isParamDelta(snapshot)) {
          // Lightweight path: capture reverse delta for redo, then restore
          const reverseDelta = createReverseDelta(snapshot);
          kernel.redoStack.push(reverseDelta);
          await restoreParamDelta(snapshot, snapshot.oldValue);
        } else if (isMuteDelta(snapshot)) {
          // Lightweight path: reverse mute entries for redo, then restore
          const reverseDelta = createReverseMuteDelta(snapshot);
          kernel.redoStack.push(reverseDelta);
          await restoreMuteDelta(snapshot, 'undo');
        } else {
          // Full snapshot path (structural edits like add/remove node)
          const current = await captureSnapshot();
          kernel.redoStack.push(current);
          await restoreSnapshot(snapshot);
        }
      }).catch(() => {
        // Swallow errors to prevent breaking the promise chain.
        set({ canUndo: kernel.undoStack.length > 0, canRedo: kernel.redoStack.length > 0 });
      });
    },

    redo: () => {
      const snapshot = kernel.redoStack.pop();
      if (!snapshot) return;

      kernel.undoLock = kernel.undoLock.then(async () => {
        if (isParamDelta(snapshot)) {
          // Lightweight path: capture reverse delta for undo, then restore
          const reverseDelta = createReverseDelta(snapshot);
          kernel.undoStack.push(reverseDelta);
          await restoreParamDelta(snapshot, snapshot.oldValue);
        } else if (isMuteDelta(snapshot)) {
          // Lightweight path: reverse mute entries for undo, then restore
          const reverseDelta = createReverseMuteDelta(snapshot);
          kernel.undoStack.push(reverseDelta);
          await restoreMuteDelta(snapshot, 'redo');
        } else {
          // Full snapshot path
          const current = await captureSnapshot();
          kernel.undoStack.push(current);
          await restoreSnapshot(snapshot);
        }
      }).catch(() => {
        set({ canUndo: kernel.undoStack.length > 0, canRedo: kernel.redoStack.length > 0 });
      });
    },

    pushUndo: async () => {
      if (get().aiActionInProgress) return;
      const snapshot = await captureSnapshot();
      kernel.undoStack.push(snapshot);
      if (kernel.undoStack.length > useSettingsStore.getState().maxUndoSteps) kernel.undoStack.shift();
      kernel.redoStack.length = 0;
      set({ canUndo: kernel.undoStack.length > 0, canRedo: false, dirty: true });
    },

    captureSnapshot,
    collectImageData,
  };
};
