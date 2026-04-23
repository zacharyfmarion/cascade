import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, NodeInstance, NodeSpec, ParamValue, PortSpec, GroupInternalGraph } from '../store/types';
import { createMockEngine, resetNodeCounter, NODE_SPECS } from './engineMock';
import { useSettingsStore } from '../store/settingsStore';

if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true });
}

let mockEngine = createMockEngine();
let addOutputPort: string;
let addInputPort: string;
const trackAnalyticsEvent = vi.fn();

const setTauriMode = (enabled: boolean) => {
  if (enabled) {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
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

type GraphStore = typeof import('../store/graphStore')['useGraphStore'];

let useGraphStore: GraphStore;

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
  fps: useSettingsStore.getState().defaultFps,
  loopPlayback: useSettingsStore.getState().loopPlayback,
  playbackFps: null as number | null,
  toasts: [],
  editingStack: [{ id: 'root', label: 'Root' }],
  nodeTimings: new Map(),
  nodeErrors: new Map(),
  graphRevision: 0,
  lastTransactionOrigin: null,
});

const flushPromises = async (ticks = 1) => {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

beforeEach(async () => {
  vi.resetModules();
  setTauriMode(false);
  mockEngine = createMockEngine();
  trackAnalyticsEvent.mockClear();
  const mod = await import('../store/graphStore');
  useGraphStore = mod.useGraphStore;
  addOutputPort = mod.ADD_OUTPUT_PORT;
  addInputPort = mod.ADD_INPUT_PORT;
  useGraphStore.setState(createInitialState());
  resetNodeCounter();
  await useGraphStore.getState().initEngine();
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

  it('runAiNode is a no-op when engine lacks runAiNode', async () => {
    const id = await useGraphStore.getState().addNode('ai_depth_estimate', { x: 0, y: 0 });
    const originalRunAiNode = mockEngine.runAiNode;
    const mutableEngine = mockEngine as { runAiNode?: typeof mockEngine.runAiNode };
    delete mutableEngine.runAiNode;
    await useGraphStore.getState().runAiNode(id);
    expect(useGraphStore.getState().aiNodeStatuses[id]).toBeUndefined();
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
