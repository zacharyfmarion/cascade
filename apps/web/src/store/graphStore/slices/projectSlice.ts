import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { Connection, Frame, NodeInstance, ParamValue } from '../../types';
import { makeEngineError } from '../../../engine/engineError';
import { createDocumentEnvelope, extractFrames, extractGraphData, getEngine, isTauri, kernel, normalizeParamValue } from '../kernel';
import type { SerializableGraphData } from '../kernel';
import { syncAllCommitted } from '../nodeDraftStore';

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
  const applyGraphData = (graphData: SerializableGraphData) => {
    const newNodes = new Map<string, NodeInstance>();
    const newConnections: Connection[] = [];

    if (Array.isArray(graphData.nodes)) {
      for (const node of graphData.nodes) {
        const spec = get().nodeSpecs.find(s => s.id === node.type_id);
        const params: Record<string, ParamValue> = {};
        if (spec) {
          spec.params.forEach(p => {
            const rawValue = node.params?.[p.key] ?? p.default;
            params[p.key] = normalizeParamValue(rawValue as ParamValue);
          });
        } else if (node.params) {
          Object.assign(params, node.params);
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

    set({
      nodes: newNodes,
      connections: newConnections,
      selectedNodeIds: new Set(),
      frames: new Map(),
      selectedFrameId: null,
      renderResults: new Map(),
      editingStack: [{ id: 'root', label: 'Root' }],
      dirty: false,
      fitViewRequestId: get().fitViewRequestId + 1,
    });
    syncAllCommitted(newNodes);

    get().triggerAllViewers();
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
      kernel.undoStack.length = 0;
      kernel.redoStack.length = 0;
      set({
        nodes: new Map(),
        connections: [],
        selectedNodeIds: new Set(),
        frames: new Map(),
        selectedFrameId: null,
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
        nodeTimings: new Map(),
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
              await eng.saveProject?.(path);
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
            const loaded = await eng.loadProject?.(path);
            const graphData = extractGraphData(loaded);
            applyGraphData(graphData);
            const framesData = extractFrames(loaded);
            const frameMap = new Map<string, Frame>();
            for (const frame of framesData) {
              frameMap.set(frame.id, frame);
            }
            set({ frames: frameMap });
          }
        });
      });
    },

    loadProject: (file) => {
      file.text().then(async text => {
        let data = JSON.parse(text);
        const eng = getEngine();

        if (eng?.needsMigration) {
          try {
            if (eng.needsMigration(text)) {
              const migratedJson = eng.migrateDocument!(text);
              data = JSON.parse(migratedJson);
              console.info('[Migration] Project upgraded to latest format');
            }
          } catch (e) {
            console.warn('[Migration] Migration failed, loading original:', e);
          }
        }

        const graphData = extractGraphData(data);

        if (eng.importDocument) {
          await eng.importDocument(data);
        } else {
          await eng.importGraph(graphData);
        }

        applyGraphData(graphData);
        const framesData = extractFrames(data);
        const frameMap = new Map<string, Frame>();
        for (const frame of framesData) {
          frameMap.set(frame.id, frame);
        }
        set({ frames: frameMap });
      });
    },
  };
};
