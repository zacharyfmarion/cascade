import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { Frame } from '../../types';
import { parseEngineError } from '../../../engine/engineError';
import { makeEngineError } from '../../../engine/engineError';
import { createDocumentEnvelope, extractFrames, extractGraphData, getEngine, isTauri, kernel } from '../kernel';
import { hydrateRootGraphFromEngine } from '../hydration';
import { syncAllCommitted } from '../nodeDraftStore';
import { dslShadowMatchesGraph, graphSemanticHash, hydrateDslShadowMetadata, serializeDslShadowMetadata } from '../../../ai/dsl/shadow';

export interface ProjectSliceState {
  dirty: boolean;
}

export interface ProjectSliceActions {
  newProject: () => Promise<void>;
  saveProject: () => void;
  loadProject: (file: File) => void;
  loadProjectFromPath?: () => void;
}

export type ProjectSlice = ProjectSliceState & ProjectSliceActions;

export const createProjectSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  ProjectSlice
> = (set, get) => {
  const stopPlayback = () => {
    kernel.playbackAborted = true;
    if (kernel.playbackTimeoutId !== null) {
      clearTimeout(kernel.playbackTimeoutId);
      kernel.playbackTimeoutId = null;
    }
  };

  const resetProjectRuntimeState = (frames: Map<string, Frame>) => {
    kernel.undoStack.length = 0;
    kernel.redoStack.length = 0;
    stopPlayback();

    set({
      frames,
      selectedFrameId: null,
      lastError: null,
      hasSequenceNodes: false,
      sequenceLength: 0,
      sequenceStart: 0,
      sequenceInfoMap: new Map(),
      canUndo: false,
      canRedo: false,
      currentFrame: 0,
      isPlaying: false,
      playbackFps: null,
      nodeTimings: new Map(),
      nodeErrors: new Map(),
      renderProgress: null,
      isRendering: false,
      aiNodeStatuses: {},
      aiNodeStale: {},
    });
  };

  const currentSerializableDslShadow = () => {
    const state = get();
    const shadow = state.dslShadow;
    if (!shadow || shadow.status !== 'valid') return undefined;
    if (
      shadow.graphHash !== graphSemanticHash(state.nodes, state.connections)
      && !dslShadowMatchesGraph(shadow, state.nodes, state.connections, state.nodeSpecs)
    ) {
      return undefined;
    }
    return serializeDslShadowMetadata(shadow);
  };

  return {
    dirty: false,

    newProject: async () => {
      const eng = getEngine();
      const emptyGraph = { nodes: [], connections: [] };
      if (eng.importDocument) {
        await eng.importDocument(emptyGraph);
      } else {
        await eng.importGraph(emptyGraph);
      }
      stopPlayback();
      kernel.undoStack.length = 0;
      kernel.redoStack.length = 0;
      set({
        nodes: new Map(),
        connections: [],
        selectedNodeIds: new Set(),
        nodeSpecsById: new Map(),
        frames: new Map(),
        selectedFrameId: null,
        dslShadow: null,
        renderResults: new Map(),
        editingStack: [{ id: 'root', label: 'Root' }],
        dirty: false,
        lastError: null,
        hasSequenceNodes: false,
        sequenceInfoMap: new Map(),
        canUndo: false,
        canRedo: false,
        currentFrame: 0,
        isPlaying: false,
        playbackFps: null,
        nodeTimings: new Map(),
        nodeErrors: new Map(),
        renderProgress: null,
        isRendering: false,
        aiNodeStatuses: {},
        aiNodeStale: {},
      });
      syncAllCommitted(new Map());
    },

    saveProject: () => {
      const eng = getEngine();
      if (isTauri() && eng.saveProject) {
        import('@tauri-apps/plugin-dialog').then(({ save }) => {
          save({
            filters: [{ name: 'Cascade Project', extensions: ['casc'] }],
            defaultPath: 'project.casc',
          }).then(async path => {
            if (path) {
              await eng.saveProject?.(path, currentSerializableDslShadow());
              set({ dirty: false });
            }
          });
        });
        return;
      }

      const exportPromise = eng.exportDocument
        ? Promise.resolve(eng.exportDocument())
        : Promise.resolve(eng.exportGraph()).then(graphData => createDocumentEnvelope(graphData));

      exportPromise.then(projectDoc => {
        const framesArray = Array.from(get().frames.values());
        if (framesArray.length > 0) {
          const projectRecord = projectDoc as Record<string, unknown>;
          projectRecord.frames = framesArray;
        }
        const dsl = currentSerializableDslShadow();
        if (dsl) {
          const projectRecord = projectDoc as Record<string, unknown>;
          projectRecord.dsl = dsl;
        }
        const json = JSON.stringify(projectDoc, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'project.casc';
        link.click();
        URL.revokeObjectURL(url);
        set({ dirty: false });
      });
    },

    loadProjectFromPath: () => {
      const eng = getEngine();
      if (!isTauri() || !eng.loadProject) {
        set({ lastError: makeEngineError('Project loading is only available in the desktop app') });
        return;
      }

      import('@tauri-apps/plugin-dialog').then(({ open }) => {
        open({
          filters: [{ name: 'Cascade Project', extensions: ['casc'] }],
          multiple: false,
        }).then(async path => {
          if (typeof path === 'string') {
            try {
              const loaded = await eng.loadProject?.(path);
              await hydrateRootGraphFromEngine(set, get, { resetFrames: true });
              const framesData = extractFrames(loaded);
              const frameMap = new Map<string, Frame>();
              for (const frame of framesData) {
                frameMap.set(frame.id, frame);
              }
              resetProjectRuntimeState(frameMap);
              const state = get();
              set({
                dslShadow: hydrateDslShadowMetadata(
                  (loaded as Record<string, unknown>)?.dsl,
                  state.nodes,
                  state.connections,
                  state.nodeSpecs,
                  state.graphRevision,
                ),
              });
            } catch (e) {
              const error = parseEngineError(e);
              set({ lastError: error });
              get().pushToast('error', 'Project load failed', error.message);
            }
          }
        });
      });
    },

    loadProject: (file) => {
      void file.text()
        .then(async text => {
          try {
            let data = JSON.parse(text);
            const eng = getEngine();

            if (await Promise.resolve(eng?.needsMigration?.(text))) {
              if (!eng.migrateDocument) {
                throw makeEngineError('Project migration is required but not supported by this engine', 'MIGRATION_UNSUPPORTED', 'io');
              }

              const migratedJson = await Promise.resolve(eng.migrateDocument(text));
              data = JSON.parse(migratedJson);
              console.info('[Migration] Project upgraded to latest format');
            }

            const graphData = extractGraphData(data);

            if (eng.importDocument) {
              await eng.importDocument(data);
            } else {
              await eng.importGraph(graphData);
            }

            await hydrateRootGraphFromEngine(set, get, { resetFrames: true });
            const framesData = extractFrames(data);
            const frameMap = new Map<string, Frame>();
            for (const frame of framesData) {
              frameMap.set(frame.id, frame);
            }
            resetProjectRuntimeState(frameMap);
            const state = get();
            set({
              dslShadow: hydrateDslShadowMetadata(
                (data as Record<string, unknown>)?.dsl,
                state.nodes,
                state.connections,
                state.nodeSpecs,
                state.graphRevision,
              ),
            });
          } catch (e) {
            const error = parseEngineError(e);
            set({ lastError: error });
            get().pushToast('error', 'Project load failed', error.message);
          }
        })
        .catch(e => {
          const error = parseEngineError(e);
          set({ lastError: error });
          get().pushToast('error', 'Project load failed', error.message);
        });
    },
  };
};
