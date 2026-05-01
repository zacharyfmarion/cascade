/**
 * Public surface test for graphStore.
 *
 * Ensures that splitting the store into slices never accidentally
 * drops or renames an exported key. If this test fails after a
 * refactor, it means a consumer-visible member was removed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the WASM engine so the store module can load without a real engine.
vi.mock('../engine/wasmEngine', () => ({
  createWasmEngine: vi.fn(),
}));

// Provide a minimal window / globalThis for Node environment.
if (typeof globalThis.window === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = globalThis;
}

/**
 * The canonical set of keys that useGraphStore.getState() must expose.
 * Sorted alphabetically for easy diffing.
 */
const EXPECTED_KEYS: string[] = [
  // ── State fields ──
  'aiActionInProgress',
  'aiNodeStale',
  'aiNodeStatuses',
  'applyNodeInterfaceChange',
  'assetStoragePrompt',
  'canRedo',
  'canUndo',
  'colorManagement',
  'connections',
  'currentFrame',
  'currentProjectAssetStorage',
  'currentProjectName',
  'currentProjectPath',
  'customGroupDefinitions',
  'dirty',
  'dslShadow',
  'editingStack',
  'engineReady',
  'fitViewRequestId',
  'fps',
  'frames',
  'graphRevision',
  'hasSequenceNodes',
  'isPlaying',
  'isRendering',
  'lastError',
  'lastTransactionOrigin',
  'loopPlayback',
  'nodeErrors',
  'nodeSpecs',
  'nodeSpecsById',
  'nodeTimings',
  'nodes',
  'playbackFps',
  'previewScale',
  'projectAssets',
  'projectSessionRevision',
  'renderProgress',
  'renderResults',
  'selectedFrameId',
  'selectedNodeIds',
  'sequenceInfoMap',
  'sequenceLength',
  'sequenceStart',
  'toasts',
  'unsavedChangesPrompt',

  // ── Actions ──
  'addFrame',
  'addNode',
  'beginAiAction',
  'cancelRender',
  'captureSnapshot',
  'clearDslShadow',
  'clearToasts',
  'collectImageData',
  'compileScriptNode',
  'connect',
  'createGroup',
  'disconnect',
  'dismissAssetStoragePrompt',
  'dismissToast',
  'dismissUnsavedChangesPrompt',
  'editTransaction',
  'endAiAction',
  'enterGroup',
  'exitGroup',
  'exportGroupAsPackage',
  'exportImage',
  'exportExr',
  'flushRender',
  'frameSelectedNodes',
  'getDslShadow',
  'getImageData',
  'getViewsForDisplay',
  'goToEnd',
  'goToStart',
  'hydrateProjectFromEngine',
  'importCustomNodes',
  'initEngine',
  'isAiConfigured',
  'isInsideGroup',
  'linkToViewer',
  'loadBatchFiles',
  'loadColorManagementInfo',
  'loadImageFile',
  'loadImagePath',
  'loadOcioConfig',
  'loadOcioFromEnv',
  'loadPaletteFile',
  'loadProject',
  'loadProjectFromPath',
  'loadVideoFile',
  'navigateToBreadcrumb',
  'newProject',
  'pause',
  'play',
  'pushSequenceFrames',
  'pushToast',
  'pushUndo',
  'recomputeSequenceState',
  'redo',
  'refreshDslShadowFromGraph',
  'refreshAiNodeStale',
  'registerGpuKernel',
  'registerGroupDefinition',
  'removeFrame',
  'removeNode',
  'requestCloseProject',
  'requestNewProject',
  'requestOpenProject',
  'requestSaveProject',
  'requestSaveProjectAs',
  'requestSaveBundledProject',
  'resolveAssetStoragePrompt',
  'resolveUnsavedChanges',
  'renameGroup',
  'renameGpuScriptNode',
  'renderAllViewersAsync',
  'renderBatch',
  'renderSequence',
  'renderVideo',
  'resetColorManagement',
  'runAiNode',
  'saveProject',
  'saveProjectAs',
  'saveBundledProject',
  'selectFrame',
  'selectNode',
  'setAiApiKey',
  'setCurrentFrame',
  'setDisplayView',
  'setDslHandle',
  'setDslShadowFromEditor',
  'setFps',
  'setInputDefault',
  'setInputDefaultCommit',
  'setInputDefaultLive',
  'setLoopPlayback',
  'setParam',
  'setParamCommit',
  'setParamLive',
  'setPosition',
  'setProjectAssetStorage',
  'setProjectFormat',
  'setSelectedNodes',
  'setSequenceDirectory',
  'setSequenceFiles',
  'stepBackward',
  'stepForward',
  'toggleMuteSelected',
  'togglePlayback',
  'triggerAffectedViewers',
  'triggerAllViewers',
  'triggerRender',
  'typesCompatible',
  'undo',
  'ungroupNode',
  'updateFrame',
  'updateGroupInterface',
  'validateEdits',
].sort();

describe('graphStore public surface', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let useGraphStore: any;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../store/graphStore');
    useGraphStore = mod.useGraphStore;
  });

  it('exposes exactly the expected set of keys (no additions, no removals)', () => {
    const actual = Object.keys(useGraphStore.getState()).sort();
    expect(actual).toEqual(EXPECTED_KEYS);
  });
});
