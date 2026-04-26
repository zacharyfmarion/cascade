import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, NodeInstance, NodeSpec } from '../../../store/types';
import type { EngineBridge } from '../../../engine/bridge';
import { createMockEngine, resetNodeCounter } from '../../../__tests__/engineMock';
import { HandleMap } from '../handleMap';

if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true });
}

let mockEngine = createMockEngine();

vi.mock('../../../engine/wasmEngine', () => ({
  initWasmEngine: vi.fn(),
  get wasmEngine() {
    return mockEngine;
  },
}));

type GraphStore = typeof import('../../../store/graphStore')['useGraphStore'];
type ApplyDsl = typeof import('../executor')['applyDsl'];

let useGraphStore: GraphStore;
let applyDsl: ApplyDsl;

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
  hasSequenceNodes: false,
  sequenceLength: 0,
  sequenceStart: 0,
  sequenceInfoMap: new Map(),
  isPlaying: false,
  fps: 24,
  loopPlayback: true,
  playbackFps: null as number | null,
  toasts: [],
  editingStack: [{ id: 'root', label: 'Root' }],
  nodeTimings: new Map(),
  nodeErrors: new Map(),
  graphRevision: 0,
  lastTransactionOrigin: null,
});

describe('applyDsl', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockEngine = createMockEngine();
    const storeMod = await import('../../../store/graphStore');
    const executorMod = await import('../executor');
    useGraphStore = storeMod.useGraphStore;
    applyDsl = executorMod.applyDsl;
    useGraphStore.setState(createInitialState());
    resetNodeCounter();
    await useGraphStore.getState().initEngine();
  });

  it('loads a new desktop image path when a LoadImage image() constructor changes', async () => {
    const store = useGraphStore.getState();
    const nodeId = await store.addNode('load_image', { x: 0, y: 0 });
    const node = useGraphStore.getState().nodes.get(nodeId);
    expect(node).toBeDefined();
    node!.params.path = { String: 'file:///tmp/old.png' };

    const loadImagePath = vi.spyOn(mockEngine as EngineBridge, 'loadImagePath');
    const handleMap = new HandleMap();
    handleMap.set('load1', nodeId);
    const result = await applyDsl(
      'graph {\n  load1 = LoadImage(path: image("file:///tmp/new.png"))\n}',
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    expect(result.success).toBe(true);
    expect(loadImagePath).toHaveBeenCalledWith(nodeId, 'file:///tmp/new.png');
    expect(useGraphStore.getState().nodes.get(nodeId)?.params.path).toEqual({ String: 'file:///tmp/new.png' });
  });

  it('returns a visible DSL error when loading an image path fails', async () => {
    const store = useGraphStore.getState();
    const nodeId = await store.addNode('load_image', { x: 0, y: 0 });
    const node = useGraphStore.getState().nodes.get(nodeId);
    expect(node).toBeDefined();
    node!.params.path = { String: 'file:///tmp/old.png' };

    vi.spyOn(mockEngine as EngineBridge, 'loadImagePath').mockRejectedValue(new Error('No such file or directory'));
    const handleMap = new HandleMap();
    handleMap.set('load1', nodeId);
    const result = await applyDsl(
      'graph {\n  load1 = LoadImage(path: image("file:///tmp/missing.png"))\n}',
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toEqual([{ line: 2, message: 'No such file or directory' }]);
    }
    expect(useGraphStore.getState().nodes.get(nodeId)?.params.path).toEqual({ String: 'file:///tmp/old.png' });
  });
});
