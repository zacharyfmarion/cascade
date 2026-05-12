import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import type { Connection, NodeInstance, NodeSpec, ParamValue, PortSpec, GroupInternalGraph, ViewerResult } from '../store/types';
import { createMockEngine, resetNodeCounter, NODE_SPECS } from './engineMock';
import { useSettingsStore } from '../store/settingsStore';
import { buildDefaultGpuScriptManifest, buildGpuScriptManifest, buildGpuScriptNodeSpec } from '../ai/gpuScript';
import { serializeGraph } from '../ai/dsl/serializer';
import { HandleMap } from '../ai/dsl/handleMap';
import { createBundledProjectBlob } from '../store/graphStore/projectPackage';

if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true });
}

let mockEngine = createMockEngine();
let addOutputPort: string;
let addInputPort: string;
const trackAnalyticsEvent = vi.fn();
const dialogMocks = vi.hoisted(() => ({
  save: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));

const setTauriMode = (enabled: boolean) => {
  const host = window as unknown as Record<string, unknown>;
  if (enabled) {
    host.__TAURI_INTERNALS__ = {};
    host.isTauri = true;
  } else {
    delete host.__TAURI_INTERNALS__;
    delete host.isTauri;
  }
};

vi.mock('../engine/wasmEngine', () => ({
  initWasmEngine: vi.fn(),
  get wasmEngine() {
    return mockEngine;
  },
}));

vi.mock('../analytics/runtime', () => ({
  trackAnalyticsEvent,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: dialogMocks.save,
  open: dialogMocks.open,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    close: dialogMocks.close,
    destroy: dialogMocks.close,
    onCloseRequested: vi.fn(async () => vi.fn()),
  }),
}));

type GraphStore = typeof import('../store/graphStore')['useGraphStore'];

let useGraphStore: GraphStore;
const originalFetch = globalThis.fetch;

const createInitialState = () => ({
  nodes: new Map<string, NodeInstance>(),
  connections: [] as Connection[],
  selectedNodeIds: new Set<string>(),
  frames: new Map(),
  selectedFrameId: null,
  nodeSpecs: [] as NodeSpec[],
  nodeSpecsById: new Map<string, NodeSpec>(),
  engineReady: false,
  renderResults: new Map(),
  lastError: null,
  canUndo: false,
  canRedo: false,
  currentFrame: 0,
  renderProgress: null,
  isRendering: false,
  previewScale: 1,
  dirty: false,
  currentProjectPath: null,
  currentProjectName: 'Untitled',
  currentProjectAssetStorage: null,
  assetStoragePrompt: null,
  projectAssets: {},
  projectSessionRevision: 0,
  unsavedChangesPrompt: null,
  hasSequenceNodes: false,
  sequenceLength: 0,
  sequenceStart: 0,
  sequenceInfoMap: new Map(),
  batchInfoMap: new Map(),
  mediaIteratorInfoMap: new Map(),
  activeTransportSourceId: null,
  isPlaying: false,
  fps: useSettingsStore.getState().defaultFps,
  loopPlayback: useSettingsStore.getState().loopPlayback,
  playbackFps: null as number | null,
  toasts: [],
  editingStack: [{ id: 'root', label: 'Root' }],
  nodeTimings: new Map(),
  nodeErrors: new Map(),
  dslShadow: null,
  customGroupDefinitions: [],
  graphRevision: 0,
  lastTransactionOrigin: null,
});

const flushPromises = async (ticks = 1) => {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

const imageResult = (nodeId: string, width: number, height: number): ViewerResult => ({
  type: 'image',
  nodeId,
  width,
  height,
  pixels: new Uint8ClampedArray(Math.min(width * height * 4, 4)),
});

beforeEach(async () => {
  vi.resetModules();
  setTauriMode(false);
  mockEngine = createMockEngine();
  trackAnalyticsEvent.mockClear();
  dialogMocks.save.mockReset();
  dialogMocks.open.mockReset();
  dialogMocks.close.mockReset();
  const mod = await import('../store/graphStore');
  useGraphStore = mod.useGraphStore;
  addOutputPort = mod.ADD_OUTPUT_PORT;
  addInputPort = mod.ADD_INPUT_PORT;
  useGraphStore.setState(createInitialState());
  resetNodeCounter();
  await useGraphStore.getState().initEngine();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('graphStore initialization', () => {
  it('initEngine sets engineReady and loads node specs', () => {
    const state = useGraphStore.getState();
    expect(state.engineReady).toBe(true);
    expect(state.nodeSpecs.length).toBe(NODE_SPECS.length);
    expect(state.nodeSpecs.map(s => s.id)).toContain('load_image');
  });

  it('initial state has empty nodes and connections with no errors', () => {
    const state = useGraphStore.getState();
    expect(state.nodes.size).toBe(0);
    expect(state.connections.length).toBe(0);
    expect(state.lastError).toBeNull();
  });
});

describe('graphStore node CRUD', () => {
  it('addNode creates node with type, position, defaults', async () => {
    const id = await useGraphStore.getState().addNode('load_image', { x: 10, y: 20 });
    const node = useGraphStore.getState().nodes.get(id);
    expect(node?.typeId).toBe('load_image');
    expect(node?.position).toEqual({ x: 10, y: 20 });
    expect(node?.params.file).toEqual({ String: '' } as ParamValue);
  });

  it('addNode returns the node id', async () => {
    const id = await useGraphStore.getState().addNode('curves', { x: 0, y: 0 });
    expect(id.length).toBeGreaterThan(0);
    expect(useGraphStore.getState().nodes.has(id)).toBe(true);
  });

  it('addNode populates default params for multi-param nodes', async () => {
    const id = await useGraphStore.getState().addNode('gaussian_blur', { x: 1, y: 2 });
    const node = useGraphStore.getState().nodes.get(id);
    expect(node?.params.amount).toEqual({ Float: 0.5 } as ParamValue);
    expect(node?.params.radius).toEqual({ Float: 1.0 } as ParamValue);
  });

  it('addNode rejects desktop-only nodes on web and stores a structured error', async () => {
    await expect(
      useGraphStore.getState().addNode('load_video', { x: 0, y: 0 }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_PLATFORM',
      domain: 'runtime',
    });

    expect(useGraphStore.getState().lastError?.message).toBe('Load Video is only available in the desktop app.');
  });

  it('addNode allows desktop-only nodes in the desktop runtime', async () => {
    setTauriMode(true);

    const id = await useGraphStore.getState().addNode('load_video', { x: 0, y: 0 });

    expect(useGraphStore.getState().nodes.get(id)?.typeId).toBe('load_video');
  });

  it('removeNode deletes the node from the map', async () => {
    const id = await useGraphStore.getState().addNode('curves', { x: 0, y: 0 });
    await useGraphStore.getState().removeNode(id);
    expect(useGraphStore.getState().nodes.has(id)).toBe(false);
  });

  it('removeNode removes connections involving the node', async () => {
    const fromId = await useGraphStore.getState().addNode('load_image', { x: 0, y: 0 });
    const toId = await useGraphStore.getState().addNode('viewer', { x: 1, y: 1 });
    await useGraphStore.getState().connect(fromId, 'image', toId, 'image');
    expect(useGraphStore.getState().connections.length).toBe(1);
    await useGraphStore.getState().removeNode(fromId);
    expect(useGraphStore.getState().connections.length).toBe(0);
  });

  it('removeNode removes node from selection', async () => {
    const id = await useGraphStore.getState().addNode('curves', { x: 0, y: 0 });
    useGraphStore.getState().selectNode(id);
    await useGraphStore.getState().removeNode(id);
    expect(useGraphStore.getState().selectedNodeIds.has(id)).toBe(false);
  });

  it('removeNode for sequence node recomputes sequence state', async () => {
    const id = await useGraphStore.getState().addNode('load_image_sequence', { x: 0, y: 0 });
    useGraphStore.setState({
      sequenceInfoMap: new Map([
        [id, { frame_count: 10, first_frame: 1, last_frame: 10 }],
      ]),
    });
    useGraphStore.getState().recomputeMediaIteratorState();
    expect(useGraphStore.getState().hasSequenceNodes).toBe(true);
    await useGraphStore.getState().removeNode(id);
    const state = useGraphStore.getState();
    expect(state.hasSequenceNodes).toBe(false);
    expect(state.sequenceLength).toBe(0);
    expect(state.sequenceStart).toBe(0);
  });
});

describe('graphStore connections', () => {
  it('connect adds a connection with correct endpoints', async () => {
    const fromId = await useGraphStore.getState().addNode('load_image', { x: 0, y: 0 });
    const toId = await useGraphStore.getState().addNode('viewer', { x: 1, y: 1 });
    await useGraphStore.getState().connect(fromId, 'image', toId, 'image');
    const conn = useGraphStore.getState().connections[0];
    expect(conn.fromNode).toBe(fromId);
    expect(conn.toNode).toBe(toId);
    expect(conn.fromPort).toBe('image');
    expect(conn.toPort).toBe('image');
  });

  it('connect is idempotent and avoids duplicate connections', async () => {
    const fromId = await useGraphStore.getState().addNode('load_image', { x: 0, y: 0 });
    const toId = await useGraphStore.getState().addNode('viewer', { x: 1, y: 1 });
    await useGraphStore.getState().connect(fromId, 'image', toId, 'image');
    await useGraphStore.getState().connect(fromId, 'image', toId, 'image');
    expect(useGraphStore.getState().connections.length).toBe(1);
  });

  it('disconnect removes a connection by id', async () => {
    const fromId = await useGraphStore.getState().addNode('load_image', { x: 0, y: 0 });
    const toId = await useGraphStore.getState().addNode('viewer', { x: 1, y: 1 });
    await useGraphStore.getState().connect(fromId, 'image', toId, 'image');
    const connId = useGraphStore.getState().connections[0].id;
    await useGraphStore.getState().disconnect(connId);
    expect(useGraphStore.getState().connections.length).toBe(0);
  });

  it('disconnect is a no-op for unknown connection', async () => {
    await useGraphStore.getState().disconnect('missing');
    expect(useGraphStore.getState().connections.length).toBe(0);
  });
});

describe('graphStore parameters and positioning', () => {
  it('setParam updates the node param value', async () => {
    const id = await useGraphStore.getState().addNode('gaussian_blur', { x: 0, y: 0 });
    await useGraphStore.getState().setParam(id, 'amount', { Float: 0.5 });
    expect(useGraphStore.getState().nodes.get(id)?.params.amount).toEqual({ Float: 0.5 } as ParamValue);
  });

  it('setParam calls engine.setParam', async () => {
    const id = await useGraphStore.getState().addNode('gaussian_blur', { x: 0, y: 0 });
    const spy = vi.spyOn(mockEngine, 'setParam');
    await useGraphStore.getState().setParam(id, 'amount', { Float: 0.2 });
    expect(spy).toHaveBeenCalledWith(id, 'amount', { Float: 0.2 });
  });

  it('setPosition updates the node position', async () => {
    const id = await useGraphStore.getState().addNode('curves', { x: 0, y: 0 });
    useGraphStore.getState().setPosition(id, { x: 5, y: 6 });
    expect(useGraphStore.getState().nodes.get(id)?.position).toEqual({ x: 5, y: 6 });
  });

  it('setPosition for non-existent node is a no-op', () => {
    useGraphStore.getState().setPosition('missing', { x: 1, y: 1 });
    expect(useGraphStore.getState().nodes.size).toBe(0);
  });
});

describe('graphStore input defaults', () => {
  it('setInputDefault updates node inputDefaults', async () => {
    const id = await useGraphStore.getState().addNode('viewer', { x: 0, y: 0 });
    await useGraphStore.getState().setInputDefault(id, 'image', { String: 'default' });
    expect(useGraphStore.getState().nodes.get(id)?.inputDefaults.image).toEqual({ String: 'default' } as ParamValue);
  });

  it('setInputDefault calls engine.setInputDefault', async () => {
    const id = await useGraphStore.getState().addNode('viewer', { x: 0, y: 0 });
    const spy = vi.spyOn(mockEngine, 'setInputDefault');
    await useGraphStore.getState().setInputDefault(id, 'image', { String: 'x' });
    expect(spy).toHaveBeenCalledWith(id, 'image', { String: 'x' });
  });
});

describe('graphStore selection', () => {
  it('selectNode sets selectedNodeIds to single id', async () => {
    const id = await useGraphStore.getState().addNode('curves', { x: 0, y: 0 });
    useGraphStore.getState().selectNode(id);
    expect(useGraphStore.getState().selectedNodeIds).toEqual(new Set([id]));
  });

  it('selectNode with null clears selection', async () => {
    const id = await useGraphStore.getState().addNode('curves', { x: 0, y: 0 });
    useGraphStore.getState().selectNode(id);
    useGraphStore.getState().selectNode(null);
    expect(useGraphStore.getState().selectedNodeIds.size).toBe(0);
  });

  it('setSelectedNodes sets multiple ids', async () => {
    const id1 = await useGraphStore.getState().addNode('curves', { x: 0, y: 0 });
    const id2 = await useGraphStore.getState().addNode('viewer', { x: 0, y: 0 });
    useGraphStore.getState().setSelectedNodes([id1, id2]);
    expect(useGraphStore.getState().selectedNodeIds).toEqual(new Set([id1, id2]));
  });

  it('linkToViewer captures analytics and reports when it creates a viewer', async () => {
    const sourceId = await useGraphStore.getState().addNode('curves', { x: 0, y: 0 });

    trackAnalyticsEvent.mockClear();
    await useGraphStore.getState().linkToViewer(sourceId);

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('node linked to viewer', {
      source_node_type: 'curves',
      viewer_created: true,
    });
  });
});

describe('graphStore analytics', () => {
  it('captures node added analytics with node category', async () => {
    await useGraphStore.getState().addNode('curves', { x: 0, y: 0 });

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('node added', {
      node_type_id: 'curves',
      category: 'Color',
    });
  });

  it('captures node removed analytics with node category', async () => {
    const nodeId = await useGraphStore.getState().addNode('gaussian_blur', { x: 0, y: 0 });

    trackAnalyticsEvent.mockClear();
    await useGraphStore.getState().removeNode(nodeId);

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('node removed', {
      node_type_id: 'gaussian_blur',
      category: 'Filter',
    });
  });

  it('captures nodes connected analytics with node and port types', async () => {
    const fromId = await useGraphStore.getState().addNode('load_image', { x: 0, y: 0 });
    const toId = await useGraphStore.getState().addNode('viewer', { x: 1, y: 1 });

    trackAnalyticsEvent.mockClear();
    await useGraphStore.getState().connect(fromId, 'image', toId, 'image');

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('nodes connected', {
      from_node_type: 'load_image',
      to_node_type: 'viewer',
      from_port_type: 'Image',
      to_port_type: 'Image',
    });
  });

  it('captures nodes disconnected analytics', async () => {
    const fromId = await useGraphStore.getState().addNode('load_image', { x: 0, y: 0 });
    const toId = await useGraphStore.getState().addNode('viewer', { x: 1, y: 1 });
    await useGraphStore.getState().connect(fromId, 'image', toId, 'image');
    const connectionId = useGraphStore.getState().connections[0].id;

    trackAnalyticsEvent.mockClear();
    await useGraphStore.getState().disconnect(connectionId);

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('nodes disconnected');
  });

  it('captures node muted analytics for each toggled node', async () => {
    const nodeId = await useGraphStore.getState().addNode('gaussian_blur', { x: 0, y: 0 });
    useGraphStore.getState().selectNode(nodeId);

    trackAnalyticsEvent.mockClear();
    await useGraphStore.getState().toggleMuteSelected();

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('node muted', {
      node_type_id: 'gaussian_blur',
      muted: true,
    });
  });
});

describe('graphStore preview rendering', () => {
  it('passes previewScale to the engine and does not downscale engine preview results again', async () => {
    const store = useGraphStore.getState();
    const viewerId = 'viewer-preview';
    const fullResult = imageResult(viewerId, 4096, 3072);
    const enginePreview = imageResult(viewerId, 1024, 768);

    mockEngine._setRenderResult(enginePreview);
    mockEngine._clearRenderCalls();
    useGraphStore.setState({
      previewScale: 0.25,
      renderResults: new Map([[viewerId, fullResult]]),
    });

    store.triggerRender(viewerId);
    await flushPromises(3);

    expect(mockEngine._renderCalls).toEqual([viewerId]);
    expect(mockEngine._renderScales).toEqual([0.25]);
    const stored = useGraphStore.getState().renderResults.get(viewerId);
    expect(stored).toMatchObject({
      type: 'image',
      width: 1024,
      height: 768,
      frame: 0,
      previewScale: 0.25,
      originalWidth: 4096,
      originalHeight: 3072,
    });
  });

  it('passes the minimum-edge effective previewScale to the engine for clamped previews', async () => {
    const store = useGraphStore.getState();
    const viewerId = 'viewer-preview';
    const fullResult = imageResult(viewerId, 1200, 900);
    const enginePreview = imageResult(viewerId, 800, 600);

    mockEngine._setRenderResult(enginePreview);
    mockEngine._clearRenderCalls();
    useGraphStore.setState({
      previewScale: 0.25,
      renderResults: new Map([[viewerId, fullResult]]),
    });

    store.triggerRender(viewerId);
    await flushPromises(3);

    expect(mockEngine._renderScales).toEqual([600 / 900]);
    const stored = useGraphStore.getState().renderResults.get(viewerId);
    expect(stored).toMatchObject({
      type: 'image',
      width: 800,
      height: 600,
      frame: 0,
      previewScale: 600 / 900,
      originalWidth: 1200,
      originalHeight: 900,
    });
  });

  it('uses full scale when there is no previous image size for a preview render', async () => {
    const store = useGraphStore.getState();
    const viewerId = 'viewer-preview';
    const engineResult = imageResult(viewerId, 400, 300);

    mockEngine._setRenderResult(engineResult);
    mockEngine._clearRenderCalls();
    useGraphStore.setState({
      previewScale: 0.25,
      renderResults: new Map(),
    });

    store.triggerRender(viewerId);
    await flushPromises(3);

    expect(mockEngine._renderScales).toEqual([1]);
    expect(useGraphStore.getState().renderResults.get(viewerId)).toMatchObject({
      type: 'image',
      width: 400,
      height: 300,
    });
  });

  it('allows explicit preview render overrides before a full-size result exists', async () => {
    const store = useGraphStore.getState();
    const viewerId = 'viewer-preview';
    const engineResult = imageResult(viewerId, 120, 90);

    mockEngine._setRenderResult(engineResult);
    mockEngine._clearRenderCalls();
    useGraphStore.setState({
      previewScale: 1,
      renderResults: new Map(),
    });

    store.triggerRender(viewerId, 0.2);
    await flushPromises(3);

    expect(mockEngine._renderScales).toEqual([0.2]);
    expect(useGraphStore.getState().renderResults.get(viewerId)).toMatchObject({
      type: 'image',
      width: 120,
      height: 90,
      frame: 0,
    });
  });

  it('uses the coalesced preview render path when navigating an active media iterator', async () => {
    const viewerId = await useGraphStore.getState().addNode('viewer', { x: 0, y: 0 });
    mockEngine._setRenderResult(imageResult(viewerId, 120, 90));
    mockEngine._clearRenderCalls();
    useGraphStore.setState({
      activeTransportSourceId: 'batch1',
      mediaIteratorInfoMap: new Map([[
        'batch1',
        {
          sourceNodeId: 'batch1',
          kind: 'batch',
          label: 'Batch',
          startFrame: 0,
          endFrame: 2,
          count: 3,
          itemLabels: ['dog', 'mona_lisa', 'portrait'],
          supportsRandomAccess: true,
        },
      ]]),
      renderResults: new Map(),
    });

    useGraphStore.getState().setCurrentFrame(1);
    await flushPromises(3);

    expect(useGraphStore.getState().currentFrame).toBe(1);
    expect(mockEngine._renderCalls).toEqual([viewerId]);
    expect(mockEngine._renderScales).toEqual([0.2]);
    expect(useGraphStore.getState().renderResults.get(viewerId)).toMatchObject({
      frame: 1,
    });
  });
});

describe('graphStore undo/redo', () => {
  it('after addNode, canUndo is true', async () => {
    await useGraphStore.getState().addNode('curves', { x: 0, y: 0 });
    expect(useGraphStore.getState().canUndo).toBe(true);
  });

  it('undo removes the node', async () => {
    const id = await useGraphStore.getState().addNode('curves', { x: 0, y: 0 });
    useGraphStore.getState().undo();
    await flushPromises(2);
    expect(useGraphStore.getState().nodes.has(id)).toBe(false);
  });

  it('redo restores the node after undo', async () => {
    const id = await useGraphStore.getState().addNode('curves', { x: 0, y: 0 });
    useGraphStore.getState().undo();
    await flushPromises(2);
    useGraphStore.getState().redo();
    await flushPromises(2);
    expect(useGraphStore.getState().nodes.has(id)).toBe(true);
  });

  it('undo with empty stack is a no-op', async () => {
    useGraphStore.getState().undo();
    await flushPromises(1);
    expect(useGraphStore.getState().nodes.size).toBe(0);
  });

  it('redo with empty stack is a no-op', async () => {
    useGraphStore.getState().redo();
    await flushPromises(1);
    expect(useGraphStore.getState().nodes.size).toBe(0);
  });

  it('new mutation after undo clears redo stack', async () => {
    await useGraphStore.getState().addNode('curves', { x: 0, y: 0 });
    useGraphStore.getState().undo();
    await flushPromises(2);
    await useGraphStore.getState().addNode('viewer', { x: 1, y: 1 });
    expect(useGraphStore.getState().canRedo).toBe(false);
  });

  it('dirty flag is set on mutations', async () => {
    await useGraphStore.getState().addNode('curves', { x: 0, y: 0 });
    expect(useGraphStore.getState().dirty).toBe(true);
  });
});

describe('graphStore frame and playback controls', () => {
  it('setCurrentFrame updates currentFrame', () => {
    useGraphStore.getState().setCurrentFrame(12);
    expect(useGraphStore.getState().currentFrame).toBe(12);
  });

  it('stepForward increments currentFrame by 1', () => {
    useGraphStore.setState({ currentFrame: 1, sequenceLength: 10 });
    useGraphStore.getState().stepForward();
    expect(useGraphStore.getState().currentFrame).toBe(2);
  });

  it('stepBackward decrements currentFrame by 1', () => {
    useGraphStore.setState({ currentFrame: 2, sequenceStart: 0 });
    useGraphStore.getState().stepBackward();
    expect(useGraphStore.getState().currentFrame).toBe(1);
  });

  it('stepForward does not go past sequenceLength', () => {
    useGraphStore.setState({ currentFrame: 5, sequenceLength: 5 });
    useGraphStore.getState().stepForward();
    expect(useGraphStore.getState().currentFrame).toBe(5);
  });

  it('stepBackward does not go below sequenceStart', () => {
    useGraphStore.setState({ currentFrame: 2, sequenceStart: 2 });
    useGraphStore.getState().stepBackward();
    expect(useGraphStore.getState().currentFrame).toBe(2);
  });

  it('goToStart sets currentFrame to sequenceStart', () => {
    useGraphStore.setState({ currentFrame: 10, sequenceStart: 3 });
    useGraphStore.getState().goToStart();
    expect(useGraphStore.getState().currentFrame).toBe(3);
  });

  it('goToEnd sets currentFrame to sequenceLength', () => {
    useGraphStore.setState({ sequenceLength: 7, currentFrame: 1 });
    useGraphStore.getState().goToEnd();
    expect(useGraphStore.getState().currentFrame).toBe(7);
  });

  it('goToEnd uses 999 when no sequenceLength', () => {
    useGraphStore.setState({ sequenceLength: 0, currentFrame: 1 });
    useGraphStore.getState().goToEnd();
    expect(useGraphStore.getState().currentFrame).toBe(999);
  });

  it('setBatchInfo registers a batch media iterator without selecting unrelated transport', async () => {
    const batchId = await useGraphStore.getState().addNode('load_image_batch', { x: 0, y: 0 });
    useGraphStore.getState().setBatchInfo(batchId, {
      count: 3,
      filenames: ['a', 'b', 'c'],
    });

    const state = useGraphStore.getState();
    expect(state.activeTransportSourceId).toBeNull();
    expect(state.mediaIteratorInfoMap.get(batchId)).toMatchObject({
      kind: 'batch',
      startFrame: 0,
      endFrame: 2,
      count: 3,
      itemLabels: ['a', 'b', 'c'],
    });
    expect(state.sequenceLength).toBe(0);
  });

  it('setCurrentFrame clamps to the active media iterator', async () => {
    const batchId = await useGraphStore.getState().addNode('load_image_batch', { x: 0, y: 0 });
    useGraphStore.getState().setBatchInfo(batchId, {
      count: 2,
      filenames: ['a', 'b'],
    });
    useGraphStore.getState().setActiveTransportSource(batchId);

    useGraphStore.getState().setCurrentFrame(42);
    expect(useGraphStore.getState().currentFrame).toBe(1);
  });

  it('getBatchThumbnail does not fall back to full image data', async () => {
    const fullImageFallback = vi.fn(() => new Uint8Array([1, 2, 3, 4]));
    (mockEngine as unknown as { getBatchThumbnail?: unknown }).getBatchThumbnail = undefined;
    mockEngine.getBatchImageData = fullImageFallback;

    const result = await useGraphStore.getState().getBatchThumbnail('batch1', 0, 96);

    expect(result).toBeNull();
    expect(fullImageFallback).not.toHaveBeenCalled();
  });

  it('setFps updates fps', () => {
    useGraphStore.getState().setFps(48);
    expect(useGraphStore.getState().fps).toBe(48);
  });

  it('setLoopPlayback updates loopPlayback', () => {
    useGraphStore.getState().setLoopPlayback(true);
    expect(useGraphStore.getState().loopPlayback).toBe(true);
  });

  it('togglePlayback toggles play and pause states', async () => {
    useGraphStore.getState().togglePlayback();
    expect(useGraphStore.getState().isPlaying).toBe(true);
    useGraphStore.getState().togglePlayback();
    await flushPromises(1);
    expect(useGraphStore.getState().isPlaying).toBe(false);
  });
});

describe('graphStore group editing state', () => {
  it('isInsideGroup returns false at root', () => {
    expect(useGraphStore.getState().isInsideGroup()).toBe(false);
  });

  it('editingStack starts with root context', () => {
    const stack = useGraphStore.getState().editingStack;
    expect(stack.length).toBe(1);
    expect(stack[0].id).toBe('root');
  });

  it('exitGroup at root is a no-op', () => {
    useGraphStore.getState().exitGroup();
    expect(useGraphStore.getState().editingStack.length).toBe(1);
  });

  it('createGroup stores runtime group definitions for DSL serialization', async () => {
    const store = useGraphStore.getState();
    const load = await store.addNode('load_image', { x: 0, y: 0 });
    const blur = await store.addNode('gaussian_blur', { x: 100, y: 0 });
    const curves = await store.addNode('curves', { x: 200, y: 0 });
    const viewer = await store.addNode('viewer', { x: 300, y: 0 });
    await store.setParam(blur, 'amount', { Float: 2 } as ParamValue);
    await store.connect(load, 'image', blur, 'image');
    await store.connect(blur, 'image', curves, 'image');
    await store.connect(curves, 'image', viewer, 'image');
    store.refreshDslShadowFromGraph();
    useGraphStore.setState({ lastTransactionOrigin: 'dsl' });

    await store.createGroup([blur, curves], 'Node Group');

    const state = useGraphStore.getState();
    expect(state.lastTransactionOrigin).toBe('ui');
    expect(state.customGroupDefinitions).toHaveLength(1);
    expect(state.dslShadow?.text).toContain('node NodeGroup = group {');
    expect(state.dslShadow?.text).toContain('blur1 = GaussianBlur(amount: 2.0)');
    expect(state.dslShadow?.text).toContain('curves1 = Curves()');
    expect(state.dslShadow?.text).toContain('input.image -> blur1.image');
    expect(state.dslShadow?.text).toContain('curves1.image -> output.image');
    expect(state.dslShadow?.text).toContain('node_group1 = NodeGroup()');
    expect(state.dslShadow?.customDefinitionNames).toContainEqual({
      runtimeId: 'group::user_mock',
      name: 'NodeGroup',
    });
  });

  it('exportGroupAsPackage downloads .cnode files', async () => {
    Object.assign(mockEngine, {
      exportGroupAsPackage: vi.fn(async () => ({
        format_version: '1.0.0',
        package_id: 'pkg',
        nodes: [],
      })),
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cnode');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const link = document.createElement('a');
    const click = vi.spyOn(link, 'click').mockImplementation(() => {});
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(link);

    try {
      await useGraphStore.getState().exportGroupAsPackage('group::My Node');
      expect(link.download).toBe('My_Node.cnode');
    } finally {
      createElement.mockRestore();
      click.mockRestore();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });

  it('importCustomNodes surfaces structured cnode failures', async () => {
    Object.assign(mockEngine, {
      importCustomNodes: vi.fn(async () => {
        throw new Error('InvalidVersion at $.format_version: Missing cnode format_version');
      }),
    });

    const imported = await useGraphStore.getState().importCustomNodes('{"nodes":[]}');

    expect(imported).toEqual([]);
    expect(useGraphStore.getState().lastError?.message).toContain('Missing cnode format_version');
    expect(useGraphStore.getState().toasts[0]).toMatchObject({
      kind: 'error',
      title: 'Import failed',
    });
  });

  it('renaming a group node updates the DSL definition name', async () => {
    const store = useGraphStore.getState();
    const load = await store.addNode('load_image', { x: 0, y: 0 });
    const blur = await store.addNode('gaussian_blur', { x: 200, y: 0 });
    const viewer = await store.addNode('viewer', { x: 400, y: 0 });
    await store.connect(load, 'image', blur, 'image');
    await store.connect(blur, 'image', viewer, 'image');

    await store.createGroup([blur], 'Node Group');
    useGraphStore.getState().refreshDslShadowFromGraph();
    const groupNodeId = Array.from(useGraphStore.getState().nodes.entries())
      .find(([, node]) => node.typeId.startsWith('group::'))?.[0];
    expect(groupNodeId).toBeDefined();

    await useGraphStore.getState().renameGroup(groupNodeId!, 'Cloudy Adjustment');

    const state = useGraphStore.getState();
    expect(state.dslShadow?.customDefinitionNames).toContainEqual({
      runtimeId: 'group::user_mock',
      name: 'CloudyAdjustment',
    });
    expect(state.dslShadow?.text).toContain('node CloudyAdjustment = group {');
    expect(state.dslShadow?.text).toContain('cloudy_adjustment1 = CloudyAdjustment()');
    expect(state.dslShadow?.text).not.toContain('node_group1 = CloudyAdjustment()');
    expect(state.dslShadow?.text).not.toContain('node NodeGroup = group');
  });
});

describe('graphStore DSL shadow hardening', () => {
  it('live param commits retag stale DSL-origin state and refresh DSL shadow', async () => {
    const store = useGraphStore.getState();
    const blur = await store.addNode('gaussian_blur', { x: 0, y: 0 });
    store.refreshDslShadowFromGraph();
    useGraphStore.setState({ lastTransactionOrigin: 'dsl' });

    await store.setParamLive(blur, 'amount', { Float: 2 } as ParamValue);
    await flushPromises(3);
    await store.setParamCommit(blur, 'amount', { Float: 2 } as ParamValue);
    await flushPromises(3);

    const state = useGraphStore.getState();
    expect(state.lastTransactionOrigin).toBe('ui');
    expect(state.nodes.get(blur)?.params.amount).toEqual({ Float: 2 });
    expect(state.nodeSpecs.find(spec => spec.id === 'gaussian_blur')?.params.find(param => param.key === 'amount')?.default).toEqual({ Float: 0.5 });
    expect(serializeGraph({
      nodes: state.nodes,
      connections: state.connections,
      nodeSpecs: state.nodeSpecs,
      handleMap: new HandleMap(),
    })).toContain('GaussianBlur(amount: 2.0)');
    expect(state.dslShadow?.text).toContain('blur1 = GaussianBlur(amount: 2.0)');
  });

  it('loading an image path retags stale DSL-origin state and refreshes asset DSL', async () => {
    const store = useGraphStore.getState();
    const load = await store.addNode('load_image', { x: 0, y: 0 });
    store.refreshDslShadowFromGraph();
    useGraphStore.setState({ lastTransactionOrigin: 'dsl' });

    await store.loadImagePath(load, '/tmp/plate.png');

    const state = useGraphStore.getState();
    expect(state.lastTransactionOrigin).toBe('ui');
    expect(state.dslShadow?.text).toContain('load1 = LoadImage(path: image("file:///tmp/plate.png"))');
  });

  it('loading a video path persists file_path for DSL and save projection', async () => {
    setTauriMode(true);
    const store = useGraphStore.getState();
    const video = await store.addNode('load_video', { x: 0, y: 0 });
    store.refreshDslShadowFromGraph();
    useGraphStore.setState({ lastTransactionOrigin: 'dsl' });

    await store.loadVideoFile(video, '/tmp/reference.mov');

    const state = useGraphStore.getState();
    expect(state.lastTransactionOrigin).toBe('ui');
    expect(state.nodes.get(video)?.params.file_path).toEqual({ String: 'file:///tmp/reference.mov' });
    expect(state.dslShadow?.text).toContain('load1 = LoadVideo(file_path: video("file:///tmp/reference.mov"))');
  });
});

describe('graphStore helper behaviors', () => {
  it('extractGraphData handles document envelope format', async () => {
    const doc = {
    cascade: { format_version: '1.0.0' },
      graph: {
        nodes: [
          { id: 'n1', type_id: 'gaussian_blur', position: [1, 2], params: { amount: { Float: 0.25 } } },
        ],
        connections: [],
      },
    };
  const file = new File([JSON.stringify(doc)], 'project.casc', { type: 'application/json' });
    useGraphStore.getState().loadProject(file);
    await flushPromises(2);
    const node = useGraphStore.getState().nodes.get('n1');
    expect(node?.params.amount).toEqual({ Float: 0.25 } as ParamValue);
    expect(node?.params.radius).toEqual({ Float: 1.0 } as ParamValue);
  });

  it('extractGraphData handles bare graph format', async () => {
    const graph = {
      nodes: [
        { id: 'n2', type_id: 'load_image', position: [3, 4], params: { file: { String: 'path' } } },
      ],
      connections: [],
    };
  const file = new File([JSON.stringify(graph)], 'project.casc', { type: 'application/json' });
    useGraphStore.getState().loadProject(file);
    await flushPromises(2);
    const node = useGraphStore.getState().nodes.get('n2');
    expect(node?.position).toEqual({ x: 3, y: 4 });
    expect(node?.params.file).toEqual({ String: 'path' } as ParamValue);
  });

  it('buildGroupIOSpecs creates group input/output specs with correct ports', async () => {
    const internalGraph: GroupInternalGraph = {
      groupDefId: 'group::test',
      name: 'Test Group',
      nodes: [
        { id: 'inner-1', typeId: 'curves', position: { x: 0, y: 0 }, params: {}, inputDefaults: {} },
      ],
      connections: [],
      inputs: [{ name: 'in', label: 'In', ty: 'Image' }],
      outputs: [{ name: 'out', label: 'Out', ty: 'Image' }],
    };

    mockEngine.getGroupInternalGraph = async () => internalGraph;
    const groupNodeId = await useGraphStore.getState().addNode('group::test', { x: 0, y: 0 });
    await useGraphStore.getState().enterGroup(groupNodeId);
    const specs = useGraphStore.getState().nodeSpecs;
    const groupInput = specs.find(s => s.id === 'group_input');
    const groupOutput = specs.find(s => s.id === 'group_output');
    expect(groupInput?.outputs).toEqual([
      ...internalGraph.inputs,
      { name: addOutputPort, label: '+', ty: 'Image' },
    ] as PortSpec[]);
    expect(groupOutput?.inputs).toEqual([
      ...internalGraph.outputs,
      { name: addInputPort, label: '+', ty: 'Image' },
    ] as PortSpec[]);
  });

  it('enterGroup reconstructs gpu script specs from stored manifest params', async () => {
    const manifest = buildDefaultGpuScriptManifest('gpu_script::group_test');
    const internalGraph: GroupInternalGraph = {
      groupDefId: 'group::gpu-script-test',
      name: 'GPU Script Group',
      nodes: [
        {
          id: 'gpu-inner',
          typeId: 'gpu_script::group_test',
          position: { x: 0, y: 0 },
          params: { __script_manifest: { String: JSON.stringify(manifest) } },
          inputDefaults: {},
        },
      ],
      connections: [],
      inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    };

    mockEngine.getGroupInternalGraph = async () => internalGraph;
    const groupNodeId = await useGraphStore.getState().addNode('group::test', { x: 0, y: 0 });
    await useGraphStore.getState().enterGroup(groupNodeId);

    const state = useGraphStore.getState();
    const gpuSpec = state.nodeSpecs.find(s => s.id === 'gpu_script::group_test');
    expect(gpuSpec).toBeDefined();
    expect(gpuSpec?.inputs.some(port => port.name === 'mask')).toBe(true);
    expect(state.nodes.get('gpu-inner')?.params.__script_manifest).toEqual({
      String: JSON.stringify(manifest),
    } as ParamValue);
  });

  it('compileScriptNode updates specs and scalar input defaults', async () => {
    const nodeId = await useGraphStore.getState().addNode('gpu_script', { x: 0, y: 0 });
    const node = useGraphStore.getState().nodes.get(nodeId);
    expect(node?.typeId.startsWith('gpu_script::')).toBe(true);
    await useGraphStore.getState().setInputDefault(nodeId, 'old_control', { Float: 9 } as ParamValue);

    const manifest = buildGpuScriptManifest(
      node?.typeId ?? 'gpu_script::mock',
      [
        { name: 'image', label: 'Image', ty: 'Image' },
        { name: 'amount', label: 'Amount', ty: 'Float', default: 0.75, min: 0, max: 1, step: 0.01 },
      ],
      [{ name: 'image', label: 'Image', ty: 'Image' }],
      [],
      'return vec4(color.rgb * amount, color.a);',
      true,
    );

    const spec = await useGraphStore.getState().compileScriptNode(nodeId, JSON.stringify(manifest));
    const state = useGraphStore.getState();
    const storedSpec = state.nodeSpecs.find(s => s.id === spec.id);
    const amountPort = storedSpec?.inputs.find(input => input.name === 'amount');

    expect(amountPort).toMatchObject({
      name: 'amount',
      label: 'Amount',
      ty: 'Float',
      default: { Float: 0.75 },
      min: 0,
      max: 1,
      step: 0.01,
      ui_hint: { type: 'Slider' },
    });
    expect(state.nodes.get(nodeId)?.inputDefaults.amount).toEqual({ Float: 0.75 } as ParamValue);
    expect(state.nodes.get(nodeId)?.inputDefaults.old_control).toBeUndefined();
  });

  it('addNode stores gpu script specs by instance id for canvas rendering', async () => {
    const nodeId = await useGraphStore.getState().addNode('gpu_script', { x: 0, y: 0 });
    const state = useGraphStore.getState();
    const node = state.nodes.get(nodeId);

    expect(node?.typeId.startsWith('gpu_script::')).toBe(true);
    expect(state.nodeSpecsById.get(nodeId)?.id).toBe(node?.typeId);
    expect(state.nodeSpecsById.get(nodeId)?.outputs).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'image', ty: 'Image' })]),
    );
  });
});

describe('graphStore project hydration', () => {
  const customGroupSpec: NodeSpec = {
    id: 'group::user_loaded_group',
    display_name: 'Loaded Group',
    category: 'Group',
    description: 'A hydrated custom group',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: [],
  };

  it('requestNewProject prompts when dirty and cancel preserves the graph', async () => {
    const nodeId = await useGraphStore.getState().addNode('gaussian_blur', { x: 0, y: 0 });

    await useGraphStore.getState().requestNewProject();
    expect(useGraphStore.getState().unsavedChangesPrompt).toEqual({ kind: 'new' });

    await useGraphStore.getState().resolveUnsavedChanges('cancel');
    const state = useGraphStore.getState();
    expect(state.unsavedChangesPrompt).toBeNull();
    expect(state.nodes.has(nodeId)).toBe(true);
    expect(state.dirty).toBe(true);
  });

  it('requestNewProject discard clears both store and engine graph', async () => {
    await useGraphStore.getState().addNode('gaussian_blur', { x: 0, y: 0 });
    const initialSessionRevision = useGraphStore.getState().projectSessionRevision;

    await useGraphStore.getState().requestNewProject();
    await useGraphStore.getState().resolveUnsavedChanges('discard');

    expect(useGraphStore.getState().nodes.size).toBe(0);
    expect(useGraphStore.getState().dirty).toBe(false);
    expect(useGraphStore.getState().projectSessionRevision).toBe(initialSessionRevision + 1);
    expect((mockEngine.exportGraph() as { nodes?: unknown[] }).nodes).toEqual([]);
  });

  it('requestOpenProject prompts when dirty and discard loads the selected web file', async () => {
    await useGraphStore.getState().addNode('gaussian_blur', { x: 0, y: 0 });
    const initialSessionRevision = useGraphStore.getState().projectSessionRevision;
    const file = new File([JSON.stringify({
      cascade: { format_version: '1.3.0' },
      graph: {
        nodes: [{
          id: 'load-node',
          type_id: 'load_image',
          position: [12, 24],
          params: {},
        }],
        connections: [],
      },
    })], 'loaded_project.casc', { type: 'application/json' });

    await useGraphStore.getState().requestOpenProject(file);
    expect(useGraphStore.getState().unsavedChangesPrompt).toMatchObject({ kind: 'open' });

    await useGraphStore.getState().resolveUnsavedChanges('discard');
    await flushPromises(3);

    const state = useGraphStore.getState();
    expect(state.unsavedChangesPrompt).toBeNull();
    expect(state.nodes.has('load-node')).toBe(true);
    expect(state.currentProjectName).toBe('loaded_project');
    expect(state.currentProjectPath).toBeNull();
    expect(state.dirty).toBe(false);
    expect(state.projectSessionRevision).toBe(initialSessionRevision + 1);
  });

  const stubExampleFetch = (nodeId = 'example-load-node') => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      cascade: { format_version: '1.4.0' },
      project: { name: 'Fetched Example' },
      asset_storage: 'bundled',
      graph: {
        nodes: [{
          id: nodeId,
          type_id: 'load_image',
          position: [12, 24],
          params: {},
        }],
        connections: [],
        group_definitions: [],
      },
      assets: {},
      scripts: {},
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  it('requestOpenExample opens a clean project as a bundled template copy', async () => {
    const fetchMock = stubExampleFetch();
    const initialSessionRevision = useGraphStore.getState().projectSessionRevision;

    await useGraphStore.getState().requestOpenExample('halftone-shader');
    await flushPromises(3);

    const state = useGraphStore.getState();
    expect(fetchMock).toHaveBeenCalled();
    expect(state.nodes.has('example-load-node')).toBe(true);
    expect(state.currentProjectName).toBe('Halftone Shader');
    expect(state.currentProjectPath).toBeNull();
    expect(state.currentProjectAssetStorage).toBe('bundled');
    expect(state.dirty).toBe(false);
    expect(state.projectSessionRevision).toBe(initialSessionRevision + 1);
  });

  it('requestOpenExample prompts when dirty and discard opens the example', async () => {
    await useGraphStore.getState().addNode('gaussian_blur', { x: 0, y: 0 });
    const fetchMock = stubExampleFetch('discard-example-node');
    const initialSessionRevision = useGraphStore.getState().projectSessionRevision;

    await useGraphStore.getState().requestOpenExample('halftone-shader');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useGraphStore.getState().unsavedChangesPrompt).toEqual({
      kind: 'example',
      exampleId: 'halftone-shader',
    });

    await useGraphStore.getState().resolveUnsavedChanges('discard');
    await flushPromises(3);

    const state = useGraphStore.getState();
    expect(fetchMock).toHaveBeenCalled();
    expect(state.unsavedChangesPrompt).toBeNull();
    expect(state.nodes.has('discard-example-node')).toBe(true);
    expect(state.currentProjectName).toBe('Halftone Shader');
    expect(state.currentProjectPath).toBeNull();
    expect(state.dirty).toBe(false);
    expect(state.projectSessionRevision).toBe(initialSessionRevision + 1);
  });

  it('requestCloseProject prompts when dirty and cancel keeps the desktop window open', async () => {
    setTauriMode(true);
    await useGraphStore.getState().addNode('gaussian_blur', { x: 0, y: 0 });

    await useGraphStore.getState().requestCloseProject();

    expect(useGraphStore.getState().unsavedChangesPrompt).toEqual({ kind: 'close' });
    expect(dialogMocks.close).not.toHaveBeenCalled();

    await useGraphStore.getState().resolveUnsavedChanges('cancel');

    expect(useGraphStore.getState().unsavedChangesPrompt).toBeNull();
    expect(useGraphStore.getState().dirty).toBe(true);
    expect(dialogMocks.close).not.toHaveBeenCalled();
  });

  it('requestCloseProject destroys the desktop window when the project is clean', async () => {
    setTauriMode(true);
    useGraphStore.setState({ dirty: false });

    await useGraphStore.getState().requestCloseProject();

    expect(dialogMocks.close).toHaveBeenCalledTimes(1);
  });

  it('discarding close changes destroys the desktop window', async () => {
    setTauriMode(true);
    await useGraphStore.getState().addNode('gaussian_blur', { x: 0, y: 0 });

    await useGraphStore.getState().requestCloseProject();
    await useGraphStore.getState().resolveUnsavedChanges('discard');

    expect(useGraphStore.getState().unsavedChangesPrompt).toBeNull();
    expect(useGraphStore.getState().dirty).toBe(false);
    expect(dialogMocks.close).toHaveBeenCalledTimes(1);
  });

  it('desktop Save uses the current project path', async () => {
    setTauriMode(true);
    const saveProject = vi.fn(async () => {});
    mockEngine.saveProject = saveProject;
    useGraphStore.setState({
      currentProjectPath: '/tmp/current.casc',
      currentProjectName: 'current',
      dirty: true,
    });

    const saved = await useGraphStore.getState().saveProject();

    expect(saved).toBe(true);
    expect(saveProject).toHaveBeenCalledWith('/tmp/current.casc', undefined, {
      bundleMedia: false,
      assetStorage: 'external',
    });
    expect(useGraphStore.getState().dirty).toBe(false);
  });

  it('desktop Save As updates the current project identity', async () => {
    setTauriMode(true);
    dialogMocks.save.mockResolvedValue('/tmp/saved_as.casc');
    const saveProject = vi.fn(async () => {});
    mockEngine.saveProject = saveProject;
    useGraphStore.setState({ dirty: true, currentProjectName: 'Untitled' });

    const saved = await useGraphStore.getState().saveProjectAs();

    expect(saved).toBe(true);
    expect(saveProject).toHaveBeenCalledWith('/tmp/saved_as.casc', undefined, {
      bundleMedia: false,
      assetStorage: 'external',
    });
    expect(useGraphStore.getState().currentProjectPath).toBe('/tmp/saved_as.casc');
    expect(useGraphStore.getState().currentProjectName).toBe('saved_as');
  });

  it('desktop Save Bundled Copy requests bundled media', async () => {
    setTauriMode(true);
    dialogMocks.save.mockResolvedValue('/tmp/bundled.casc');
    const saveProject = vi.fn(async () => {});
    mockEngine.saveProject = saveProject;
    useGraphStore.setState({ dirty: true, currentProjectName: 'current' });

    const saved = await useGraphStore.getState().saveBundledProject();

    expect(saved).toBe(true);
    expect(saveProject).toHaveBeenCalledWith('/tmp/bundled.casc', undefined, {
      bundleMedia: true,
      assetStorage: 'bundled',
    });
    expect(useGraphStore.getState().currentProjectPath).toBe('/tmp/bundled.casc');
    expect(useGraphStore.getState().dirty).toBe(false);
  });

  it('desktop first Save prompts for asset storage only when asset-backed nodes exist', async () => {
    setTauriMode(true);
    const saveProject = vi.fn(async () => {});
    mockEngine.saveProject = saveProject;
    useGraphStore.setState({
      currentProjectPath: '/tmp/asset_project.casc',
      dirty: true,
      currentProjectAssetStorage: null,
    });
    const load = await useGraphStore.getState().addNode('load_image', { x: 0, y: 0 });
    useGraphStore.setState({
      projectAssets: {
        [load]: {
          type: 'image',
          source: 'external',
          path: 'file:///tmp/plate.png',
          original_filename: 'plate.png',
        },
      },
    });

    const saved = await useGraphStore.getState().saveProject();

    expect(saved).toBe(false);
    expect(useGraphStore.getState().assetStoragePrompt).toBe('save');
    expect(saveProject).not.toHaveBeenCalled();

    const resolved = await useGraphStore.getState().resolveAssetStoragePrompt('bundled');

    expect(resolved).toBe(true);
    expect(useGraphStore.getState().assetStoragePrompt).toBeNull();
    expect(useGraphStore.getState().currentProjectAssetStorage).toBe('bundled');
    expect(saveProject).toHaveBeenCalledWith('/tmp/asset_project.casc', undefined, {
      bundleMedia: true,
      assetStorage: 'bundled',
    });
  });

  it('desktop file-object image loads do not default the project to bundled before first save', async () => {
    setTauriMode(true);
    const saveProject = vi.fn(async () => {});
    mockEngine.saveProject = saveProject;
    useGraphStore.setState({
      currentProjectPath: '/tmp/dragged_image_project.casc',
      dirty: true,
      currentProjectAssetStorage: null,
    });
    const load = await useGraphStore.getState().addNode('load_image', { x: 0, y: 0 });

    useGraphStore.getState().loadImageFile(load, new File([new Uint8Array([1, 2, 3])], 'plate.png'));
    await flushPromises(5);

    expect(useGraphStore.getState().currentProjectAssetStorage).toBeNull();
    expect(useGraphStore.getState().projectAssets[load]?.original_filename).toBe('plate.png');

    const saved = await useGraphStore.getState().saveProject();

    expect(saved).toBe(false);
    expect(useGraphStore.getState().assetStoragePrompt).toBe('save');
    expect(saveProject).not.toHaveBeenCalled();
  });

  it('web file-object image loads do not show the asset storage prompt on save', async () => {
    const originalLoadImageData = mockEngine.loadImageData;
    mockEngine.loadImageData = (nodeId, data) => {
      const transferred = structuredClone(data, { transfer: [data.buffer] });
      expect(data.byteLength).toBe(0);
      return originalLoadImageData(nodeId, transferred);
    };
    const load = await useGraphStore.getState().addNode('load_image', { x: 0, y: 0 });

    useGraphStore.getState().loadImageFile(load, new File([new Uint8Array([1, 2, 3, 4])], 'plate.png'));
    await flushPromises(5);

    expect(useGraphStore.getState().currentProjectAssetStorage).toBeNull();
    expect(useGraphStore.getState().projectAssets[load]?.data).toBe('AQIDBA==');
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cascade-bundled-project');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.fn();
    const link = { href: '', download: '', click };
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(link as unknown as HTMLAnchorElement);

    try {
      const saved = await useGraphStore.getState().saveProject();

      expect(saved).toBe(true);
      expect(useGraphStore.getState().assetStoragePrompt).toBeNull();
      expect(useGraphStore.getState().currentProjectAssetStorage).toBe('bundled');
    } finally {
      createElement.mockRestore();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });

  it('web Save writes non-empty uploaded image assets to a bundled project', async () => {
    const originalLoadImageData = mockEngine.loadImageData;
    mockEngine.loadImageData = (nodeId, data) => {
      const transferred = structuredClone(data, { transfer: [data.buffer] });
      return originalLoadImageData(nodeId, transferred);
    };
    const load = await useGraphStore.getState().addNode('load_image', { x: 0, y: 0 });
    useGraphStore.setState({ currentProjectName: 'web_bundle' });
    useGraphStore.getState().loadImageFile(load, new File([new Uint8Array([5, 6, 7, 8])], 'plate.png'));
    await flushPromises(5);

    const blobs: Blob[] = [];
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:cascade-bundled-project';
    });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.fn();
    const link = { href: '', download: '', click };
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(link as unknown as HTMLAnchorElement);

    try {
      const saved = await useGraphStore.getState().saveProject();

      expect(saved).toBe(true);
      expect(blobs).toHaveLength(1);
      expect(link.download).toBe('web_bundle.casc');
      const zip = await JSZip.loadAsync(await blobs[0].arrayBuffer());
      const manifest = JSON.parse(await zip.file('cascade.json')!.async('text')) as {
        assets: Record<string, { path: string; hash: string; uri: string }>;
        asset_storage: string;
        graph: { nodes: Array<{ id: string; params: Record<string, { String?: string }> }> };
      };
      expect(manifest.asset_storage).toBe('bundled');
      const asset = manifest.assets[load];
      expect(asset.path).toMatch(/^assets\/[a-f0-9]{64}\.png$/);
      expect(asset.uri).toBe(`asset://sha256/${asset.hash}`);
      expect(await zip.file(asset.path)!.async('uint8array')).toEqual(new Uint8Array([5, 6, 7, 8]));
      expect(manifest.graph.nodes.find(node => node.id === load)?.params.path.String).toBe(asset.uri);
    } finally {
      createElement.mockRestore();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });

  it('web Save packs the latest exported AI result over retained project asset data', async () => {
    const ai = await useGraphStore.getState().addNode('ai_generate_image', { x: 0, y: 0 });
    useGraphStore.setState({
      currentProjectName: 'ai_regenerated',
      projectAssets: {
        [ai]: {
          type: 'ai_result',
          source: 'embedded',
          data: btoa('first-result'),
          original_filename: '',
          hash: '',
        },
      },
    });
    mockEngine.exportDocument = async () => ({
      cascade: { format_version: '1.4.0' },
      graph: {
        nodes: [{
          id: ai,
          type_id: 'ai_generate_image',
          params: {},
          input_defaults: {},
          position: [0, 0],
          muted: false,
        }],
        connections: [],
        group_definitions: [],
      },
      assets: {
        [ai]: {
          type: 'ai_result',
          source: 'embedded',
          data: btoa('second-result'),
          original_filename: '',
          hash: '',
        },
      },
    });

    const blobs: Blob[] = [];
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:cascade-ai-regenerated';
    });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.fn();
    const link = { href: '', download: '', click };
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(link as unknown as HTMLAnchorElement);

    try {
      const saved = await useGraphStore.getState().saveProject();

      expect(saved).toBe(true);
      const zip = await JSZip.loadAsync(await blobs[0].arrayBuffer());
      const manifest = JSON.parse(await zip.file('cascade.json')!.async('text')) as {
        assets: Record<string, { path: string }>;
      };
      const asset = manifest.assets[ai];
      expect(await zip.file(asset.path)!.async('uint8array')).toEqual(new TextEncoder().encode('second-result'));
    } finally {
      createElement.mockRestore();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });

  it('project asset storage setting marks the project dirty and warns when internal refs remain external', async () => {
    const load = await useGraphStore.getState().addNode('load_image', { x: 0, y: 0 });
    const uri = 'asset://sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    useGraphStore.setState((state) => {
      const nodes = new Map(state.nodes);
      const node = nodes.get(load);
      if (node) nodes.set(load, { ...node, params: { ...node.params, path: { String: uri } } });
      return { nodes };
    });
    useGraphStore.setState({ dirty: false, toasts: [] });

    useGraphStore.getState().setProjectAssetStorage('external');

    const state = useGraphStore.getState();
    expect(state.currentProjectAssetStorage).toBe('external');
    expect(state.dirty).toBe(true);
    expect(state.toasts[0]?.title).toBe('Some assets remain internal');
    expect(state.dslShadow?.text).toContain(`image("${uri}")`);
  });

  it('web Save downloads a project and marks it clean without tracking a path', async () => {
    await useGraphStore.getState().addNode('gaussian_blur', { x: 0, y: 0 });
    useGraphStore.setState({
      currentProjectName: 'web_project',
      currentProjectPath: '/desktop/path/should-not-stick.casc',
      dirty: true,
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cascade-project');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.fn();
    const link = { href: '', download: '', click };
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(link as unknown as HTMLAnchorElement);

    try {
      const saved = await useGraphStore.getState().saveProject();

      expect(saved).toBe(true);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(link.download).toBe('web_project.casc');
      expect(link.href).toBe('blob:cascade-project');
      expect(click).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:cascade-project');
      expect(useGraphStore.getState().dirty).toBe(false);
      expect(useGraphStore.getState().currentProjectPath).toBeNull();
    } finally {
      createElement.mockRestore();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });

  it('desktop Open uses the native dialog, hydrates identity, and clears dirty state', async () => {
    setTauriMode(true);
    dialogMocks.open.mockResolvedValue('/tmp/opened_project.casc');
    mockEngine.loadProject = vi.fn(async () => {
      const graph = {
        nodes: [{
          id: 'opened-node',
          type_id: 'gaussian_blur',
          position: [16, 32],
          params: {},
        }],
        connections: [],
      };
      mockEngine.importGraph(graph);
      return { cascade: { format_version: '1.3.0' }, graph };
    });
    useGraphStore.setState({ dirty: true });

    const loaded = await useGraphStore.getState().loadProjectFromPath?.();

    const state = useGraphStore.getState();
    expect(loaded).toBe(true);
    expect(mockEngine.loadProject).toHaveBeenCalledWith('/tmp/opened_project.casc');
    expect(state.nodes.has('opened-node')).toBe(true);
    expect(state.currentProjectPath).toBe('/tmp/opened_project.casc');
    expect(state.currentProjectName).toBe('opened_project');
    expect(state.dirty).toBe(false);
  });

  it('desktop dev Save blocks when the native engine graph diverges from visible state', async () => {
    setTauriMode(true);
    const saveProject = vi.fn(async () => {});
    mockEngine.saveProject = saveProject;
    await useGraphStore.getState().addNode('gaussian_blur', { x: 0, y: 0 });
    useGraphStore.setState({
      nodes: new Map(),
      currentProjectPath: '/tmp/diverged.casc',
      dirty: true,
    });

    const saved = await useGraphStore.getState().saveProject();

    expect(saved).toBe(false);
    expect(saveProject).not.toHaveBeenCalled();
    expect(useGraphStore.getState().lastError?.code).toBe('PROJECT_GRAPH_DIVERGED');
    expect(useGraphStore.getState().dirty).toBe(true);
  });

  it('desktop startup hydration restores visible state from a persistent native engine graph', async () => {
    setTauriMode(true);
    mockEngine.importGraph({
      nodes: [{
        id: 'crop-node',
        type_id: 'gaussian_blur',
        position: [30, 40],
        params: { amount: { Float: 2 } },
      }],
      connections: [],
    });
    useGraphStore.setState({ nodes: new Map(), connections: [], dirty: false });

    const hydrated = await useGraphStore.getState().hydrateProjectFromEngine();

    const state = useGraphStore.getState();
    expect(hydrated).toBe(true);
    expect(state.nodes.has('crop-node')).toBe(true);
    expect(state.nodes.get('crop-node')?.position).toEqual({ x: 30, y: 40 });
    expect(state.dirty).toBe(false);
  });

  it('loadProject refreshes custom group specs from the engine and clears stale per-instance specs', async () => {
    const loadedGraph = {
      nodes: [
        {
          id: 'group-node',
          type_id: customGroupSpec.id,
          position: [12, 24],
          params: {},
          input_defaults: {},
        },
      ],
      connections: [],
    };

    mockEngine.importDocument = vi.fn(async () => {
      mockEngine.exportGraph = () => loadedGraph;
      mockEngine.listNodeTypes = () => [...NODE_SPECS, customGroupSpec];
    });

    useGraphStore.setState({
      nodeSpecsById: new Map([['stale-node', NODE_SPECS[0]]]),
    });

    const file = new File([
      JSON.stringify({
        cascade: { format_version: '1.1.0' },
        graph: loadedGraph,
        frames: [],
      }),
    ], 'custom-group.casc', { type: 'application/json' });

    useGraphStore.getState().loadProject(file);
    await flushPromises(10);

    const state = useGraphStore.getState();
    expect(state.lastError).toBeNull();
    expect(state.nodes.get('group-node')?.typeId).toBe(customGroupSpec.id);
    expect(state.nodeSpecs.some(spec => spec.id === customGroupSpec.id)).toBe(true);
    expect(state.nodeSpecsById.size).toBe(0);
  });

  it('loadProject rehydrates persisted image sequence runtime state before rendering', async () => {
    const loadedGraph = {
      nodes: [
        {
          id: 'seq-node',
          type_id: 'load_image_sequence',
          position: [0, 0],
          params: {
            directory: { String: '/tmp/sequence' },
            pattern: { String: '{frame:4}.png' },
          },
          input_defaults: {},
        },
        {
          id: 'viewer-node',
          type_id: 'viewer',
          position: [200, 0],
          params: {},
          input_defaults: {},
        },
      ],
      connections: [
        {
          from_node: 'seq-node',
          from_port: 'image',
          to_node: 'viewer-node',
          to_port: 'value',
        },
      ],
    };
    mockEngine.setSequenceDirectory = vi.fn(async () => ({
      frame_count: 3,
      first_frame: 1001,
      last_frame: 1003,
    }));
    mockEngine.getSequenceInfo = vi.fn(async () => ({
      frame_count: 3,
      first_frame: 1001,
      last_frame: 1003,
    }));

    const file = new File([
      JSON.stringify({
        cascade: { format_version: '1.3.0' },
        graph: loadedGraph,
      }),
    ], 'sequence.casc', { type: 'application/json' });

    useGraphStore.getState().loadProject(file);
    await flushPromises(10);

    const state = useGraphStore.getState();
    expect(mockEngine.setSequenceDirectory).toHaveBeenCalledWith('seq-node', '/tmp/sequence');
    expect(mockEngine.getSequenceInfo).toHaveBeenCalledWith('seq-node', '{frame:4}.png');
    expect(state.sequenceInfoMap.get('seq-node')).toEqual({
      frame_count: 3,
      first_frame: 1001,
      last_frame: 1003,
    });
    expect(state.activeTransportSourceId).toBeNull();
    expect(state.sequenceStart).toBe(0);
    expect(state.sequenceLength).toBe(0);
    expect(state.mediaIteratorInfoMap.get('seq-node')).toMatchObject({
      kind: 'sequence',
      startFrame: 1001,
      endFrame: 1003,
      count: 3,
    });

    state.suggestActiveTransportSourceForViewer('viewer-node');
    const viewerScopedState = useGraphStore.getState();
    expect(viewerScopedState.activeTransportSourceId).toBe('seq-node');
    expect(viewerScopedState.sequenceStart).toBe(1001);
    expect(viewerScopedState.sequenceLength).toBe(1003);
    expect(viewerScopedState.currentFrame).toBe(1001);
  });

  it('loadProject hydrates optional DSL shadow metadata without blocking graph load', async () => {
    const loadedGraph = {
      nodes: [
        {
          id: 'load-node',
          type_id: 'load_image',
          position: [0, 0],
          params: {},
          input_defaults: {},
        },
      ],
      connections: [],
    };
    const dsl = {
      version: 1,
      text: '# preserved comment\ngraph {\n  load1 = LoadImage()\n}',
      graph_hash: 'old-hash',
      handles: [{ node_id: 'load-node', handle: 'load1' }],
      custom_definition_names: [],
    };

    const file = new File([
      JSON.stringify({
        cascade: { format_version: '1.3.0' },
        graph: loadedGraph,
        dsl,
      }),
    ], 'dsl-shadow.casc', { type: 'application/json' });

    useGraphStore.getState().loadProject(file);
    await flushPromises(10);

    const state = useGraphStore.getState();
    expect(state.lastError).toBeNull();
    expect(state.nodes.has('load-node')).toBe(true);
    expect(state.dslShadow?.text).toContain('# preserved comment');
    expect(state.dslShadow?.handles).toEqual([{ nodeId: 'load-node', handle: 'load1' }]);
    expect(state.dslShadow?.status).toBe('valid');
  });

  it('loadProject shows internal asset URIs for bundled projects without losing DSL graph output', async () => {
    useGraphStore.setState({ lastTransactionOrigin: 'dsl' });
    const bundled = await createBundledProjectBlob({
      cascade: { format_version: '1.3.0' },
      graph: {
        nodes: [
          {
            id: 'load-node',
            type_id: 'load_image',
            params: { path: { String: 'file:///Users/me/plate.png' } },
            input_defaults: {},
            position: [0, 0],
            muted: false,
          },
          {
            id: 'viewer-node',
            type_id: 'viewer',
            params: {},
            input_defaults: {},
            position: [240, 0],
            muted: false,
          },
        ],
        connections: [
          {
            from_node: 'load-node',
            from_port: 'image',
            to_node: 'viewer-node',
            to_port: 'image',
          },
        ],
      },
      assets: {
        'load-node': {
          type: 'image',
          source: 'embedded',
          data: btoa('packed-image-bytes'),
          original_filename: 'plate.png',
          hash: '',
        },
      },
    });
    const file = new File([bundled], 'bundled.casc');

    useGraphStore.getState().loadProject(file);
    await flushPromises(10);

    const state = useGraphStore.getState();
    expect(state.nodes.has('load-node')).toBe(true);
    const assetPath = state.nodes.get('load-node')?.params.path;
    expect(assetPath).toMatchObject({ String: expect.stringMatching(/^asset:\/\/sha256\/[a-f0-9]{64}$/) });
    expect(state.connections).toHaveLength(1);
    expect(state.dslShadow).toBeNull();
    expect(state.lastTransactionOrigin).toBeNull();
    expect(state.currentProjectAssetStorage).toBe('bundled');
    expect(state.projectAssets['load-node']?.uri).toBe((assetPath as { String: string }).String);

    const regenerated = serializeGraph({
      nodes: state.nodes,
      connections: state.connections,
      nodeSpecs: state.nodeSpecs,
      handleMap: new HandleMap(),
      groupDefinitions: state.customGroupDefinitions,
    });
    expect(regenerated).toContain(`LoadImage(path: image("${(assetPath as { String: string }).String}"))`);
    expect(regenerated).toContain('Viewer()');
    expect(regenerated).not.toBe('graph {\n\n}');
  });

  it('loadProject treats semantically matching GPU DSL shadow as valid after engine manifest normalization', async () => {
    const gpuManifest = {
      id: 'gpu_script::saved',
      display_name: 'GPU Script',
      category: 'GPU',
      description: 'Custom GPU shader node',
      inputs: [
        { name: 'image', label: 'Image', ty: 'Image', optional: false },
        { name: 'age', label: 'Age', ty: 'Float', optional: false, default: 0, ui: 'Slider' },
      ],
      outputs: [{ name: 'image', label: 'Image', ty: 'Image', optional: false }],
      params: [],
      kernel: '  return color * 2;',
      supports_mask: true,
      pixel_space_params: [],
    };
    const loadedGraph = {
      nodes: [
        {
          id: 'gpu-node',
          type_id: 'gpu_script::saved',
          position: [0, 0],
          params: { __script_manifest: { String: JSON.stringify(gpuManifest) } },
          input_defaults: { age: { Float: 0 } },
        },
        { id: 'load-node', type_id: 'load_image', position: [0, 0], params: {}, input_defaults: {} },
        { id: 'viewer-node', type_id: 'viewer', position: [0, 0], params: {}, input_defaults: {} },
      ],
      connections: [
        { from_node: 'load-node', from_port: 'image', to_node: 'gpu-node', to_port: 'image' },
        { from_node: 'gpu-node', from_port: 'image', to_node: 'viewer-node', to_port: 'value' },
      ],
    };
    const dslText = [
      'node GpuNode1 = gpu {',
      '  inputs {',
      '    image image',
      '    float age',
      '  }',
      '',
      '  outputs {',
      '    image image',
      '  }',
      '',
      '  # keep my shader note',
      '  code """',
      '  return color * 2;',
      '  """',
      '}',
      '',
      'graph {',
      '  gpu1 = GpuNode1()',
      '  load1 = LoadImage()',
      '  load1.image -> gpu1.image',
      '  viewer1 = Viewer()',
      '  gpu1.image -> viewer1.value',
      '}',
    ].join('\n');

    mockEngine.getNodeSpec = async (nodeId: string): Promise<NodeSpec> => {
      if (nodeId === 'gpu-node') {
        return buildGpuScriptNodeSpec(gpuManifest);
      }
      const node = loadedGraph.nodes.find(item => item.id === nodeId);
      const spec = NODE_SPECS.find(item => item.id === node?.type_id);
      if (!spec) throw new Error(`Unknown node ${nodeId}`);
      return spec;
    };

    const file = new File([
      JSON.stringify({
        cascade: { format_version: '1.3.0' },
        graph: loadedGraph,
        dsl: {
          version: 1,
          text: dslText,
          graph_hash: 'legacy-hash-from-before-manifest-normalization',
          handles: [
            { node_id: 'gpu-node', handle: 'gpu1' },
            { node_id: 'load-node', handle: 'load1' },
            { node_id: 'viewer-node', handle: 'viewer1' },
          ],
          custom_definition_names: [{ runtime_id: 'gpu_node_1', name: 'GpuNode1' }],
        },
      }),
    ], 'gpu-dsl-shadow.casc', { type: 'application/json' });

    useGraphStore.getState().loadProject(file);
    await flushPromises(10);

    const state = useGraphStore.getState();
    expect(state.lastError).toBeNull();
    expect(state.dslShadow?.status).toBe('valid');
    expect(state.dslShadow?.text).toContain('# keep my shader note');
    expect(state.dslShadow?.text).toContain('return color * 2;');
  });

  it('loadProject ignores malformed DSL shadow metadata', async () => {
    const loadedGraph = {
      nodes: [],
      connections: [],
    };
    const file = new File([
      JSON.stringify({
        cascade: { format_version: '1.3.0' },
        graph: loadedGraph,
        dsl: 'not valid metadata',
      }),
    ], 'bad-dsl-shadow.casc', { type: 'application/json' });

    useGraphStore.getState().loadProject(file);
    await flushPromises(10);

    const state = useGraphStore.getState();
    expect(state.lastError).toBeNull();
    expect(state.dslShadow).toBeNull();
  });

  it('loadProject preserves the current graph on invalid JSON', async () => {
    const baselineId = await useGraphStore.getState().addNode('gaussian_blur', { x: 5, y: 5 });

    const file = new File(['{invalid'], 'broken.casc', { type: 'application/json' });
    useGraphStore.getState().loadProject(file);
    await flushPromises(5);

    const state = useGraphStore.getState();
    expect(state.nodes.has(baselineId)).toBe(true);
    expect(state.lastError).not.toBeNull();
    expect(state.toasts[0]?.title).toBe('Project load failed');
  });

  it('loadProject aborts when migration fails and preserves the current graph', async () => {
    const baselineId = await useGraphStore.getState().addNode('gaussian_blur', { x: 10, y: 10 });

    mockEngine.needsMigration = () => true;
    mockEngine.migrateDocument = () => {
      throw new Error('Migration exploded');
    };

    const file = new File([
      JSON.stringify({
        cascade: { format_version: '1.0.0' },
        graph: { nodes: [], connections: [] },
      }),
    ], 'needs-migration.casc', { type: 'application/json' });

    useGraphStore.getState().loadProject(file);
    await flushPromises(5);

    const state = useGraphStore.getState();
    expect(state.nodes.has(baselineId)).toBe(true);
    expect(state.lastError?.message).toContain('Migration exploded');
    expect(state.toasts[0]?.title).toBe('Project load failed');
  });

  it('loadProject fails fast when refreshed specs still cannot resolve a node type', async () => {
    const baselineId = await useGraphStore.getState().addNode('gaussian_blur', { x: 20, y: 20 });
    const unresolvedGraph = {
      nodes: [
        {
          id: 'missing-node',
          type_id: 'group::missing_after_load',
          position: [0, 0],
          params: {},
          input_defaults: {},
        },
      ],
      connections: [],
    };

    mockEngine.importDocument = vi.fn(async () => {
      mockEngine.exportGraph = () => unresolvedGraph;
      mockEngine.listNodeTypes = () => NODE_SPECS;
      mockEngine.getNodeSpec = undefined;
    });

    const file = new File([
      JSON.stringify({
        cascade: { format_version: '1.1.0' },
        graph: unresolvedGraph,
        frames: [],
      }),
    ], 'missing-type.casc', { type: 'application/json' });

    useGraphStore.getState().loadProject(file);
    await flushPromises(10);

    const state = useGraphStore.getState();
    expect(state.nodes.has(baselineId)).toBe(true);
    expect(state.nodes.has('missing-node')).toBe(false);
    expect(state.lastError?.code).toBe('UNKNOWN_NODE_TYPE');
    expect(state.lastError?.message).toContain('group::missing_after_load');
    expect(state.toasts[0]?.title).toBe('Project load failed');
  });
});

describe('graphStore AI node operations', () => {
  it('runAiNode sets status to running then complete', async () => {
    const id = await useGraphStore.getState().addNode('ai_depth_estimate', { x: 0, y: 0 });
    const runPromise = useGraphStore.getState().runAiNode(id);
    expect(useGraphStore.getState().aiNodeStatuses[id]).toBe('running');
    await runPromise;
    expect(useGraphStore.getState().aiNodeStatuses[id]).toBe('complete');
  });

  it('runAiNode sets error status on failure', async () => {
    const id = await useGraphStore.getState().addNode('ai_depth_estimate', { x: 0, y: 0 });
    mockEngine.runAiNode = async () => { throw new Error('API failure'); };
    mockEngine.getNodeExecutionState = () => ({ status: 'error', isStale: false, error: 'API failure' });
    await useGraphStore.getState().runAiNode(id);
    expect(useGraphStore.getState().aiNodeStatuses[id]).toMatch(/^error:/);
    expect(useGraphStore.getState().toasts[0]?.title).toBe('AI node failed');
    expect(useGraphStore.getState().toasts[0]?.message).toBe('API failure');
  });

  it('runAiNode clears stale flag on success', async () => {
    const id = await useGraphStore.getState().addNode('ai_depth_estimate', { x: 0, y: 0 });
    useGraphStore.setState({
      aiNodeStatuses: { [id]: 'complete' },
      aiNodeStale: { [id]: true },
    });
    await useGraphStore.getState().runAiNode(id);
    expect(useGraphStore.getState().aiNodeStale[id]).toBe(false);
  });

  it('runAiNode preserves the engine this binding while polling state', async () => {
    const id = await useGraphStore.getState().addNode('ai_depth_estimate', { x: 0, y: 0 });
    const engineWithState = mockEngine as typeof mockEngine & {
      executionState: { status: string; isStale: boolean; error: string };
    };
    engineWithState.executionState = { status: 'complete', isStale: false, error: '' };
    mockEngine.getNodeExecutionState = function getNodeExecutionState(this: typeof engineWithState) {
      return this.executionState;
    };

    await useGraphStore.getState().runAiNode(id);

    expect(useGraphStore.getState().aiNodeStatuses[id]).toBe('complete');
  });

  it('runAiNode stays running while desktop background execution is still running', async () => {
    vi.useFakeTimers();
    try {
      const id = await useGraphStore.getState().addNode('ai_depth_estimate', { x: 0, y: 0 });
      mockEngine.runAiNode = async () => {};
      let polls = 0;
      mockEngine.getNodeExecutionState = () => {
        polls += 1;
        return polls === 1
          ? { status: 'running', isStale: false, error: '' }
          : { status: 'complete', isStale: false, error: '' };
      };

      const runPromise = useGraphStore.getState().runAiNode(id);
      await Promise.resolve();
      expect(useGraphStore.getState().aiNodeStatuses[id]).toBe('running');

      await vi.advanceTimersByTimeAsync(500);
      await runPromise;
      expect(useGraphStore.getState().aiNodeStatuses[id]).toBe('complete');
    } finally {
      vi.useRealTimers();
    }
  });

  it('runAiNode preserves stale status reported by the engine on completion', async () => {
    const id = await useGraphStore.getState().addNode('ai_depth_estimate', { x: 0, y: 0 });
    mockEngine.getNodeExecutionState = () => ({ status: 'complete', isStale: true, error: '' });

    await useGraphStore.getState().runAiNode(id);

    expect(useGraphStore.getState().aiNodeStatuses[id]).toBe('complete');
    expect(useGraphStore.getState().aiNodeStale[id]).toBe(true);
  });

  it('refreshAiNodeStale updates stale flags from engine', async () => {
    const id = await useGraphStore.getState().addNode('ai_depth_estimate', { x: 0, y: 0 });
    useGraphStore.setState({
      aiNodeStatuses: { [id]: 'complete' },
      aiNodeStale: { [id]: false },
    });
    mockEngine.getNodeExecutionState = () => ({ status: 'complete', isStale: true, error: '' });
    await useGraphStore.getState().refreshAiNodeStale();
    expect(useGraphStore.getState().aiNodeStale[id]).toBe(true);
  });

  it('newProject clears AI node state', async () => {
    const id = await useGraphStore.getState().addNode('ai_depth_estimate', { x: 0, y: 0 });
    useGraphStore.setState({
      aiNodeStatuses: { [id]: 'complete' },
      aiNodeStale: { [id]: true },
    });
    await useGraphStore.getState().newProject();
    const state = useGraphStore.getState();
    expect(Object.keys(state.aiNodeStatuses).length).toBe(0);
    expect(Object.keys(state.aiNodeStale).length).toBe(0);
  });

  it('runAiNode reports an error when engine lacks runAiNode', async () => {
    const id = await useGraphStore.getState().addNode('ai_depth_estimate', { x: 0, y: 0 });
    const originalRunAiNode = mockEngine.runAiNode;
    const mutableEngine = mockEngine as { runAiNode?: typeof mockEngine.runAiNode };
    delete mutableEngine.runAiNode;
    await useGraphStore.getState().runAiNode(id);
    expect(useGraphStore.getState().aiNodeStatuses[id]).toBe('error:AI node execution is not supported in this build.');
    expect(useGraphStore.getState().toasts[0]?.title).toBe('AI node failed');
    mockEngine.runAiNode = originalRunAiNode;
  });
});

describe('graphStore error states', () => {
  it('getEngine throws when engine not initialized', async () => {
    vi.resetModules();
    mockEngine = createMockEngine();
    const mod = await import('../store/graphStore');
    const store = mod.useGraphStore;
    store.setState(createInitialState());
    resetNodeCounter();
    await expect(store.getState().addNode('curves', { x: 0, y: 0 })).rejects.toThrow('Engine not initialized');
  });

  it('renderSequence uses the web ZIP path when a WASM engine exposes an unsupported native job stub', async () => {
    const s = useGraphStore.getState();
    const sequence = await s.addNode('load_image_sequence', { x: 0, y: 0 });
    const exportNode = await s.addNode('export_image_sequence', { x: 200, y: 0 });
    await s.connect(sequence, 'image', exportNode, 'image');
    await s.setSequenceFiles(sequence, [
      new File([new Uint8Array([11])], 'frame_0001.png'),
      new File([new Uint8Array([22])], 'frame_0002.png'),
    ]);

    const nativeRenderSequence = vi.fn(async () => {
      throw new Error('Sequence rendering is not supported in WASM engine');
    });
    const exportedFrames: number[] = [];
    const exportImage = vi.fn(async (_nodeId: string, frame: number) => {
      exportedFrames.push(frame);
      return new Uint8Array([frame]);
    });
    Object.assign(mockEngine, {
      renderSequence: nativeRenderSequence,
      exportImage,
    });

    const blobs: Blob[] = [];
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:sequence-export';
    });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.fn();
    const link = { href: '', download: '', click };
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(link as unknown as HTMLAnchorElement);

    try {
      await s.renderSequence(exportNode);

      expect(nativeRenderSequence).not.toHaveBeenCalled();
      expect(exportImage).toHaveBeenCalledTimes(2);
      expect(exportedFrames).toEqual([1, 2]);
      expect(mockEngine._sequenceFrameLoads.map(load => load.frame)).toEqual(expect.arrayContaining([1, 2]));
      expect(useGraphStore.getState().lastError).toBeNull();
      expect(link.download).toBe('sequence.zip');
      expect(blobs).toHaveLength(1);

      const zip = await JSZip.loadAsync(await blobs[0].arrayBuffer());
      expect(await zip.file('0001.png')!.async('uint8array')).toEqual(new Uint8Array([1]));
      expect(await zip.file('0002.png')!.async('uint8array')).toEqual(new Uint8Array([2]));
    } finally {
      createElement.mockRestore();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });

  it('renderVideo sets error when engine does not support it', async () => {
    const id = await useGraphStore.getState().addNode('export_image', { x: 0, y: 0 });
    await useGraphStore.getState().renderVideo(id);
    expect(useGraphStore.getState().lastError?.message).toBe('Video rendering is only available in the desktop app');
  });

  it('cancelRender sets isRendering to false', async () => {
    useGraphStore.setState({ isRendering: true });
    await useGraphStore.getState().cancelRender();
    expect(useGraphStore.getState().isRendering).toBe(false);
  });
});
