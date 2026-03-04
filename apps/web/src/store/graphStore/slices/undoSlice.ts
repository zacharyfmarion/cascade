import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import { kernel, cloneEditingStack, getEngine } from '../kernel';
import type { UndoSnapshot } from '../kernel';
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
  };

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
      captureSnapshot().then(async current => {
        kernel.redoStack.push(current);
        await restoreSnapshot(snapshot);
      });
    },

    redo: () => {
      const snapshot = kernel.redoStack.pop();
      if (!snapshot) return;
      captureSnapshot().then(async current => {
        kernel.undoStack.push(current);
        await restoreSnapshot(snapshot);
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
