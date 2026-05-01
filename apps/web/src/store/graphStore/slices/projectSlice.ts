import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { Frame } from '../../types';
import { parseEngineError } from '../../../engine/engineError';
import { makeEngineError } from '../../../engine/engineError';
import { createDocumentEnvelope, extractFrames, extractGraphData, getEngine, isTauri, kernel } from '../kernel';
import type { SerializableGraphData } from '../kernel';
import { hydrateRootGraphFromEngine } from '../hydration';
import { syncAllCommitted } from '../nodeDraftStore';
import { dslShadowMatchesGraph, graphSemanticHash, hydrateDslShadowMetadata, serializeDslShadowMetadata } from '../../../ai/dsl/shadow';
import { createBundledProjectBlob, readCascadeProjectFile } from '../projectPackage';
import { collectProjectAssets, hasAssetBackedNodes, type ProjectAssetRecord, type ProjectAssetStorage } from '../assetReferences';

export type PendingProjectAction =
  | { kind: 'new' }
  | { kind: 'open'; file?: File }
  | { kind: 'close' };

export type UnsavedChangesChoice = 'save' | 'discard' | 'cancel';
export type AssetStoragePromptAction = 'save' | 'saveAs';

export interface ProjectSliceState {
  dirty: boolean;
  currentProjectPath: string | null;
  currentProjectName: string;
  projectSessionRevision: number;
  unsavedChangesPrompt: PendingProjectAction | null;
  currentProjectAssetStorage: ProjectAssetStorage | null;
  assetStoragePrompt: AssetStoragePromptAction | null;
  projectAssets: Record<string, ProjectAssetRecord>;
}

export interface ProjectSliceActions {
  newProject: () => Promise<void>;
  saveProject: () => Promise<boolean>;
  saveProjectAs: () => Promise<boolean>;
  saveBundledProject: () => Promise<boolean>;
  loadProject: (file: File) => void;
  loadProjectFromPath?: () => Promise<boolean>;
  requestNewProject: () => Promise<void>;
  requestOpenProject: (file?: File) => Promise<void>;
  requestSaveProject: () => Promise<boolean>;
  requestSaveProjectAs: () => Promise<boolean>;
  requestSaveBundledProject: () => Promise<boolean>;
  requestCloseProject: () => Promise<void>;
  resolveUnsavedChanges: (choice: UnsavedChangesChoice) => Promise<void>;
  dismissUnsavedChangesPrompt: () => void;
  setProjectAssetStorage: (mode: ProjectAssetStorage) => void;
  resolveAssetStoragePrompt: (mode: ProjectAssetStorage) => Promise<boolean>;
  dismissAssetStoragePrompt: () => void;
  hydrateProjectFromEngine: () => Promise<boolean>;
}

export type ProjectSlice = ProjectSliceState & ProjectSliceActions;

export const createProjectSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  ProjectSlice
> = (set, get) => {
  const desktopPathStorageKey = 'cascade.currentProjectPath';

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

  const projectNameFromPath = (path: string): string => {
    const basename = path.split(/[\\/]/).filter(Boolean).pop() ?? 'Untitled';
    return basename.replace(/\.casc$/i, '') || 'Untitled';
  };

  const projectNameFromFile = (file: File): string =>
    file.name.replace(/\.casc$/i, '').replace(/\.json$/i, '') || 'Untitled';

  const frameMapFromProjectData = (data: Record<string, unknown>): Map<string, Frame> => {
    const framesData = extractFrames(data);
    const frameMap = new Map<string, Frame>();
    for (const frame of framesData) {
      frameMap.set(frame.id, frame);
    }
    return frameMap;
  };

  const rememberDesktopPath = (path: string | null) => {
    if (typeof localStorage === 'undefined') return;
    if (path) localStorage.setItem(desktopPathStorageKey, path);
    else localStorage.removeItem(desktopPathStorageKey);
  };

  const rememberedDesktopPath = (): string | null => {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(desktopPathStorageKey);
  };

  const currentSerializableDslShadow = () => {
    const state = get();
    const shadow = state.dslShadow;
    if (!shadow || shadow.status !== 'valid') return undefined;
    if (
      shadow.graphHash !== graphSemanticHash(state.nodes, state.connections, state.customGroupDefinitions)
      && !dslShadowMatchesGraph(shadow, state.nodes, state.connections, state.nodeSpecs, state.customGroupDefinitions)
    ) {
      return undefined;
    }
    return serializeDslShadowMetadata(shadow);
  };

  const attachProjectMetadata = (projectDoc: unknown): Record<string, unknown> => {
    const projectRecord = projectDoc as Record<string, unknown>;
    const state = get();
    projectRecord.asset_storage = state.currentProjectAssetStorage ?? undefined;
    if (Object.keys(state.projectAssets).length > 0) {
      projectRecord.assets = {
        ...(typeof projectRecord.assets === 'object' && projectRecord.assets !== null ? projectRecord.assets : {}),
        ...state.projectAssets,
      };
    }
    const framesArray = Array.from(state.frames.values());
    if (framesArray.length > 0) {
      projectRecord.frames = framesArray;
    }
    const dsl = currentSerializableDslShadow();
    if (dsl) {
      projectRecord.dsl = dsl;
    }
    return projectRecord;
  };

  const projectAssetStorageFromData = (data: Record<string, unknown>): ProjectAssetStorage | null => (
    data.asset_storage === 'bundled' || data.asset_storage === 'external'
      ? data.asset_storage
      : null
  );

  const stableStringify = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  };

  const rootGraphShape = (graphData: unknown) => {
    const graph = extractGraphData(graphData) as {
      nodes?: Array<{ id: string; type_id: string }>;
      connections?: Array<{ from_node: string; from_port: string; to_node: string; to_port: string }>;
    };
    return {
      nodes: (graph.nodes ?? [])
        .map(node => ({ id: node.id, typeId: node.type_id }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      connections: (graph.connections ?? [])
        .map(conn => ({
          fromNode: conn.from_node,
          fromPort: conn.from_port,
          toNode: conn.to_node,
          toPort: conn.to_port,
        }))
        .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
    };
  };

  const storeGraphShape = () => {
    const state = get();
    return {
      nodes: Array.from(state.nodes.values())
        .map(node => ({ id: node.id, typeId: node.typeId }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      connections: state.connections
        .map(conn => ({
          fromNode: conn.fromNode,
          fromPort: conn.fromPort,
          toNode: conn.toNode,
          toPort: conn.toPort,
        }))
        .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
    };
  };

  const assertDesktopGraphInSync = async (): Promise<boolean> => {
    if (!isTauri() || !import.meta.env.DEV) return true;
    const engineGraph = await Promise.resolve(getEngine().exportGraph());
    if (stableStringify(rootGraphShape(engineGraph)) === stableStringify(storeGraphShape())) {
      return true;
    }
    const error = makeEngineError(
      'The native engine graph is out of sync with the visible graph. Save was blocked to avoid writing hidden nodes. Refresh the app to hydrate the visible graph from the native engine, or create a new project before saving.',
      'PROJECT_GRAPH_DIVERGED',
      'io',
    );
    set({ lastError: error });
    get().pushToast('error', 'Project save blocked', error.message);
    return false;
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const currentProjectDocument = async (): Promise<Record<string, unknown>> => {
    const eng = getEngine();
    const projectDoc = eng.exportDocument
      ? await Promise.resolve(eng.exportDocument())
      : createDocumentEnvelope(await Promise.resolve(eng.exportGraph()));
    return attachProjectMetadata(projectDoc);
  };

  const currentProjectHasAssets = async (): Promise<boolean> => {
    const doc = await currentProjectDocument();
    return hasAssetBackedNodes(doc, doc.assets);
  };

  const shouldPromptForAssetStorage = async (): Promise<boolean> => (
    isTauri() && get().currentProjectAssetStorage === null && await currentProjectHasAssets()
  );

  const saveWebProject = async (): Promise<boolean> => {
    const projectRecord = await currentProjectDocument();
    if (hasAssetBackedNodes(projectRecord, projectRecord.assets)) {
      const blob = await createBundledProjectBlob(projectRecord);
      downloadBlob(blob, `${get().currentProjectName || 'project'}.casc`);
      set({ dirty: false, currentProjectPath: null, currentProjectAssetStorage: 'bundled' });
      return true;
    }
    delete projectRecord.asset_storage;
    const json = JSON.stringify(projectRecord, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, `${get().currentProjectName || 'project'}.casc`);
    set({ dirty: false, currentProjectPath: null, currentProjectAssetStorage: null });
    return true;
  };

  const saveWebBundledProject = async (): Promise<boolean> => {
    const blob = await createBundledProjectBlob(await currentProjectDocument());
    downloadBlob(blob, `${get().currentProjectName || 'project'}.casc`);
    set({ dirty: false, currentProjectPath: null, currentProjectAssetStorage: 'bundled' });
    return true;
  };

  const saveDesktopProjectToPath = async (path: string, bundleMedia = false): Promise<boolean> => {
    if (!await assertDesktopGraphInSync()) return false;
    const savedDocument = await getEngine().saveProject?.(path, currentSerializableDslShadow(), {
      bundleMedia,
      assetStorage: bundleMedia ? 'bundled' : 'external',
    });
    if (savedDocument && typeof savedDocument === 'object') {
      const data = savedDocument as Record<string, unknown>;
      const graphData = extractGraphData(data);
      await hydrateRootGraphFromEngine(set, get, { resetFrames: false, graphData });
      set({
        dslShadow: hydrateDslShadowMetadata(
          data.dsl,
          get().nodes,
          get().connections,
          get().nodeSpecs,
          get().graphRevision,
          get().customGroupDefinitions,
        ),
        projectAssets: collectProjectAssets(data.assets),
      });
    }
    rememberDesktopPath(path);
    set({
      currentProjectPath: path,
      currentProjectName: projectNameFromPath(path),
      currentProjectAssetStorage: bundleMedia ? 'bundled' : 'external',
      dirty: false,
    });
    return true;
  };

  const chooseDesktopSavePath = async (): Promise<string | null> => {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      filters: [{ name: 'Cascade Project', extensions: ['casc'] }],
      defaultPath: `${get().currentProjectName || 'project'}.casc`,
    });
    return typeof path === 'string' ? path : null;
  };

  const loadProjectData = async (
    data: Record<string, unknown>,
    identity: { name: string; path: string | null },
    options: { resetRuntime?: boolean } = {},
  ) => {
    if (options.resetRuntime ?? true) {
      resetProjectRuntimeState(frameMapFromProjectData(data));
    }
    const state = get();
    set({
      currentProjectPath: identity.path,
      currentProjectName: identity.name,
      projectSessionRevision: get().projectSessionRevision + 1,
      currentProjectAssetStorage: projectAssetStorageFromData(data),
      projectAssets: collectProjectAssets(data.assets),
      dslShadow: hydrateDslShadowMetadata(
        data.dsl,
        state.nodes,
        state.connections,
        state.nodeSpecs,
        state.graphRevision,
        state.customGroupDefinitions,
      ),
      dirty: false,
    });
    rememberDesktopPath(identity.path);
  };

  const loadProjectFile = async (file: File) => {
    let data = await readCascadeProjectFile(file);
    const text = JSON.stringify(data);
    const eng = getEngine();

    if (await Promise.resolve(eng?.needsMigration?.(text))) {
      if (!eng.migrateDocument) {
        throw makeEngineError('Project migration is required but not supported by this engine', 'MIGRATION_UNSUPPORTED', 'io');
      }

      const migratedJson = await Promise.resolve(eng.migrateDocument(text));
      data = JSON.parse(migratedJson) as Record<string, unknown>;
      console.info('[Migration] Project upgraded to latest format');
    }

    const graphData = extractGraphData(data);
    if (eng.importDocument) {
      await eng.importDocument(data);
    } else {
      await eng.importGraph(graphData);
    }

    resetProjectRuntimeState(frameMapFromProjectData(data));
    await hydrateRootGraphFromEngine(set, get, { resetFrames: false });
    await loadProjectData(data, { name: projectNameFromFile(file), path: null }, { resetRuntime: false });
  };

  const loadProjectPath = async (path: string): Promise<boolean> => {
    const eng = getEngine();
    if (!eng.loadProject) {
      throw makeEngineError('Project loading is only available in the desktop app');
    }
    const loaded = await eng.loadProject(path);
    resetProjectRuntimeState(frameMapFromProjectData((loaded as Record<string, unknown>) ?? {}));
    await hydrateRootGraphFromEngine(set, get, { resetFrames: false });
    await loadProjectData((loaded as Record<string, unknown>) ?? {}, {
      name: projectNameFromPath(path),
      path,
    }, { resetRuntime: false });
    return true;
  };

  const openWebFilePicker = () => {
    document.getElementById('menu-file-input')?.click();
  };

  const openProjectNow = async (file?: File): Promise<boolean> => {
    if (file) {
      await loadProjectFile(file);
      return true;
    }
    if (isTauri()) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open({
        filters: [{ name: 'Cascade Project', extensions: ['casc'] }],
        multiple: false,
      });
      if (typeof path !== 'string') return false;
      return loadProjectPath(path);
    }
    openWebFilePicker();
    return true;
  };

  const closeDesktopWindow = async () => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  };

  const runPendingAction = async (action: PendingProjectAction) => {
    if (action.kind === 'new') {
      await get().newProject();
      return;
    }
    if (action.kind === 'open') {
      await openProjectNow(action.file);
      return;
    }
    set({ dirty: false });
    await closeDesktopWindow();
  };

  return {
    dirty: false,
    currentProjectPath: null,
    currentProjectName: 'Untitled',
    projectSessionRevision: 0,
    unsavedChangesPrompt: null,
    currentProjectAssetStorage: null,
    assetStoragePrompt: null,
    projectAssets: {},

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
        customGroupDefinitions: [],
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
        currentProjectPath: null,
        currentProjectName: 'Untitled',
        projectSessionRevision: get().projectSessionRevision + 1,
        unsavedChangesPrompt: null,
        currentProjectAssetStorage: null,
        assetStoragePrompt: null,
        projectAssets: {},
      });
      rememberDesktopPath(null);
      syncAllCommitted(new Map());
    },

    saveProject: async () => {
      try {
        if (await shouldPromptForAssetStorage()) {
          set({ assetStoragePrompt: 'save' });
          return false;
        }
        if (isTauri() && getEngine().saveProject) {
          const path = get().currentProjectPath ?? await chooseDesktopSavePath();
          if (!path) return false;
          return await saveDesktopProjectToPath(path, get().currentProjectAssetStorage === 'bundled');
        }
        return await saveWebProject();
      } catch (e) {
        const error = parseEngineError(e);
        set({ lastError: error });
        get().pushToast('error', 'Project save failed', error.message);
        return false;
      }
    },

    saveProjectAs: async () => {
      try {
        if (await shouldPromptForAssetStorage()) {
          set({ assetStoragePrompt: 'saveAs' });
          return false;
        }
        if (isTauri() && getEngine().saveProject) {
          const path = await chooseDesktopSavePath();
          if (!path) return false;
          return await saveDesktopProjectToPath(path, get().currentProjectAssetStorage === 'bundled');
        }
        return await saveWebProject();
      } catch (e) {
        const error = parseEngineError(e);
        set({ lastError: error });
        get().pushToast('error', 'Project save failed', error.message);
        return false;
      }
    },

    saveBundledProject: async () => {
      try {
        if (isTauri() && getEngine().saveProject) {
          const path = await chooseDesktopSavePath();
          if (!path) return false;
          return await saveDesktopProjectToPath(path, true);
        }
        return await saveWebBundledProject();
      } catch (e) {
        const error = parseEngineError(e);
        set({ lastError: error });
        get().pushToast('error', 'Bundled project save failed', error.message);
        return false;
      }
    },

    loadProjectFromPath: async () => {
      if (!isTauri() || !getEngine().loadProject) {
        set({ lastError: makeEngineError('Project loading is only available in the desktop app') });
        return false;
      }

      try {
        return await openProjectNow();
      } catch (e) {
        const error = parseEngineError(e);
        set({ lastError: error });
        get().pushToast('error', 'Project load failed', error.message);
        return false;
      }
    },

    loadProject: (file) => {
      void loadProjectFile(file).catch(e => {
          const error = parseEngineError(e);
          set({ lastError: error });
          get().pushToast('error', 'Project load failed', error.message);
        });
    },

    requestNewProject: async () => {
      if (get().dirty) {
        set({ unsavedChangesPrompt: { kind: 'new' } });
        return;
      }
      await get().newProject();
    },

    requestOpenProject: async (file?: File) => {
      if (get().dirty) {
        set({ unsavedChangesPrompt: { kind: 'open', file } });
        return;
      }
      try {
        await openProjectNow(file);
      } catch (e) {
        const error = parseEngineError(e);
        set({ lastError: error });
        get().pushToast('error', 'Project load failed', error.message);
      }
    },

    requestSaveProject: () => get().saveProject(),

    requestSaveProjectAs: () => get().saveProjectAs(),

    requestSaveBundledProject: () => get().saveBundledProject(),

    setProjectAssetStorage: (mode) => {
      set({ currentProjectAssetStorage: mode, dirty: true });
      if (mode === 'external') {
        const hasInternalRefs = Array.from(get().nodes.values()).some(node =>
          Object.values(node.params).some(value => 'String' in value && value.String.startsWith('asset://sha256/')),
        );
        if (hasInternalRefs) {
          get().pushToast('info', 'Some assets remain internal', 'Original file paths are not available for every bundled asset.');
        }
      }
      get().refreshDslShadowFromGraph();
    },

    resolveAssetStoragePrompt: async (mode) => {
      const action = get().assetStoragePrompt;
      if (!action) return false;
      set({ currentProjectAssetStorage: mode, assetStoragePrompt: null });
      return action === 'saveAs' ? get().saveProjectAs() : get().saveProject();
    },

    dismissAssetStoragePrompt: () => set({ assetStoragePrompt: null }),

    requestCloseProject: async () => {
      if (get().dirty) {
        set({ unsavedChangesPrompt: { kind: 'close' } });
        return;
      }
      await closeDesktopWindow();
    },

    resolveUnsavedChanges: async (choice) => {
      const action = get().unsavedChangesPrompt;
      if (!action || choice === 'cancel') {
        set({ unsavedChangesPrompt: null });
        return;
      }
      if (choice === 'save') {
        const saved = await get().saveProject();
        if (!saved) return;
      }
      set({ unsavedChangesPrompt: null });
      await runPendingAction(action);
    },

    dismissUnsavedChangesPrompt: () => {
      set({ unsavedChangesPrompt: null });
    },

    hydrateProjectFromEngine: async () => {
      if (!isTauri()) return false;
      try {
        const graphData = extractGraphData(await Promise.resolve(getEngine().exportGraph())) as SerializableGraphData;
        const hasGraph = (graphData.nodes?.length ?? 0) > 0 || (graphData.connections?.length ?? 0) > 0;
        if (!hasGraph) return false;
        await hydrateRootGraphFromEngine(set, get, {
          graphData,
          nodeSpecs: get().nodeSpecs,
          resetFrames: false,
        });
        const path = rememberedDesktopPath();
        set({
          currentProjectPath: path,
          currentProjectName: path ? projectNameFromPath(path) : get().currentProjectName,
          dirty: false,
        });
        return true;
      } catch (e) {
        const error = parseEngineError(e);
        set({ lastError: error });
        return false;
      }
    },
  };
};
