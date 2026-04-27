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

  it('registers a gpu custom definition before applying root graph nodes', async () => {
    const registerGpuKernel = vi.spyOn(mockEngine as EngineBridge, 'registerGpuKernel');
    const handleMap = new HandleMap();
    const result = await applyDsl(
      [
        'node FilmGlow = gpu {',
        '  inputs {',
        '    image image',
        '    float gain = 1.5 min 0.0 max 4.0 step 0.01',
        '  }',
        '',
        '  outputs {',
        '    image image',
        '  }',
        '',
        '  code """',
        '  return vec4(color.rgb * gain, color.a);',
        '  """',
        '}',
        '',
        'graph {',
        '  glow1 = FilmGlow(gain: 2.0)',
        '}',
      ].join('\n'),
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    expect(result.success).toBe(true);
    expect(registerGpuKernel).toHaveBeenCalledOnce();
    const manifest = JSON.parse(registerGpuKernel.mock.calls[0]?.[0] ?? '{}') as { id?: string; params?: unknown[] };
    expect(manifest.id).toBe('film_glow');
    expect(manifest.params).toMatchObject([{ key: 'gain', default: 1.5 }]);
    expect(useGraphStore.getState().nodes.get(handleMap.getNodeId('glow1') ?? '')?.typeId).toBe('film_glow');
  });

  it('registers a group custom definition before applying root graph nodes', async () => {
    const registerGroupDefinition = vi.spyOn(mockEngine as EngineBridge, 'registerGroupDefinition');
    const handleMap = new HandleMap();
    const result = await applyDsl(
      [
        'node SoftBlur = group {',
        '  inputs {',
        '    image image',
        '  }',
        '',
        '  outputs {',
        '    image image',
        '  }',
        '',
        '  params {',
        '    float amount = 1.0 min 0.0 max 5.0 step 0.01',
        '  }',
        '',
        '  graph {',
        '    blur = GaussianBlur(amount: param.amount)',
        '    input.image -> blur.image',
        '    blur.image -> output.image',
        '  }',
        '}',
        '',
        'graph {',
        '  blur1 = SoftBlur(amount: 2.0)',
        '}',
      ].join('\n'),
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    expect(result.success).toBe(true);
    expect(registerGroupDefinition).toHaveBeenCalledOnce();
    const definition = JSON.parse(registerGroupDefinition.mock.calls[0]?.[0] ?? '{}') as {
      id?: string;
      promotions?: Array<{ group_param_key?: string; internal_node_id?: string; internal_param_key?: string }>;
    };
    expect(definition.id).toBe('group::soft_blur');
    expect(definition.promotions).toMatchObject([
      { group_param_key: 'amount', internal_node_id: 'blur', internal_param_key: 'amount' },
    ]);
    expect(useGraphStore.getState().nodes.get(handleMap.getNodeId('blur1') ?? '')?.typeId).toBe('group::soft_blur');
  });
});

// Helper DSL text for a gpu definition with an optional display_name override
const makeGpuDsl = (options: {
  defName?: string;
  inputs?: string;
  outputs?: string;
  code?: string;
  handle?: string;
  scalarParams?: string;
}) => {
  const {
    defName = 'CrazyThing',
    inputs = '    image image',
    outputs = '    image image',
    code = '  return color;',
    handle = 'crazy_thing1',
    scalarParams = '',
  } = options;
  const inputsBlock = scalarParams ? `${inputs}\n${scalarParams}` : inputs;
  return [
    `node ${defName} = gpu {`,
    '  inputs {',
    inputsBlock,
    '  }',
    '',
    '  outputs {',
    outputs,
    '  }',
    '',
    '  code """',
    code,
    '  """',
    '}',
    '',
    'graph {',
    `  ${handle} = ${defName}()`,
    '}',
  ].join('\n');
};

describe('applyDsl — gpu_script instance recompile', () => {
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

  it('calls compileScriptNode for an existing gpu_script instance when definition changes', async () => {
    const store = useGraphStore.getState();
    const nodeId = await store.addNode('gpu_script', { x: 0, y: 0 });
    const handleMap = new HandleMap();
    handleMap.set('crazy_thing1', nodeId);

    const compileScriptNode = vi.spyOn(mockEngine as EngineBridge, 'compileScriptNode');
    const result = await applyDsl(
      makeGpuDsl({ code: '  return vec4(1.0);' }),
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    expect(result.success).toBe(true);
    expect(compileScriptNode).toHaveBeenCalledOnce();
    const manifest = JSON.parse(compileScriptNode.mock.calls[0]?.[1] ?? '{}') as { kernel?: string };
    expect(manifest.kernel).toBe('  return vec4(1.0);');
  });

  it('does NOT call registerGpuKernel for a definition that maps to an existing instance', async () => {
    const store = useGraphStore.getState();
    const nodeId = await store.addNode('gpu_script', { x: 0, y: 0 });
    const handleMap = new HandleMap();
    handleMap.set('crazy_thing1', nodeId);

    const registerGpuKernel = vi.spyOn(mockEngine as EngineBridge, 'registerGpuKernel');
    const result = await applyDsl(
      makeGpuDsl({}),
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    expect(result.success).toBe(true);
    expect(registerGpuKernel).not.toHaveBeenCalled();
  });

  it('preserves display_name from existing manifest when recompiling', async () => {
    const store = useGraphStore.getState();
    const nodeId = await store.addNode('gpu_script', { x: 0, y: 0 });
    // Simulate user having renamed the node to 'Film Glow'
    const typeId = useGraphStore.getState().nodes.get(nodeId)!.typeId;
    const existingManifest = {
      id: typeId,
      display_name: 'Film Glow',
      category: 'GPU',
      description: 'Custom GPU shader node',
      inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      params: [],
      kernel: 'return color;',
      supports_mask: true,
    };
    useGraphStore.getState().nodes.get(nodeId)!.params.__script_manifest = {
      String: JSON.stringify(existingManifest),
    };

    const handleMap = new HandleMap();
    handleMap.set('crazy_thing1', nodeId);
    const compileScriptNode = vi.spyOn(mockEngine as EngineBridge, 'compileScriptNode');

    const result = await applyDsl(
      makeGpuDsl({ code: '  return vec4(0.5);' }),
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    expect(result.success).toBe(true);
    const manifest = JSON.parse(compileScriptNode.mock.calls[0]?.[1] ?? '{}') as {
      display_name?: string;
      id?: string;
    };
    expect(manifest.display_name).toBe('Film Glow');
    expect(manifest.id).toBe(typeId);
  });

  it('propagates a new input port added in the definition', async () => {
    const store = useGraphStore.getState();
    const nodeId = await store.addNode('gpu_script', { x: 0, y: 0 });
    const handleMap = new HandleMap();
    handleMap.set('crazy_thing1', nodeId);

    const compileScriptNode = vi.spyOn(mockEngine as EngineBridge, 'compileScriptNode');
    const result = await applyDsl(
      makeGpuDsl({ scalarParams: '    float gain = 1.0 min 0.0 max 4.0 step 0.01' }),
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    expect(result.success).toBe(true);
    const manifest = JSON.parse(compileScriptNode.mock.calls[0]?.[1] ?? '{}') as {
      inputs?: Array<{ name: string; ty: string }>;
    };
    expect(manifest.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'image', ty: 'Image' }),
        expect.objectContaining({ name: 'gain', ty: 'Float' }),
      ]),
    );
  });

  it('propagates a removed input port', async () => {
    const store = useGraphStore.getState();
    const nodeId = await store.addNode('gpu_script', { x: 0, y: 0 });
    // Start with two inputs
    const typeId = useGraphStore.getState().nodes.get(nodeId)!.typeId;
    const existingManifest = {
      id: typeId,
      display_name: 'GPU Script',
      category: 'GPU',
      description: 'Custom GPU shader node',
      inputs: [
        { name: 'image', label: 'Image', ty: 'Image' },
        { name: 'mask', label: 'Mask', ty: 'Mask' },
      ],
      outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      params: [],
      kernel: 'return color;',
      supports_mask: false,
    };
    useGraphStore.getState().nodes.get(nodeId)!.params.__script_manifest = {
      String: JSON.stringify(existingManifest),
    };

    const handleMap = new HandleMap();
    handleMap.set('crazy_thing1', nodeId);
    const compileScriptNode = vi.spyOn(mockEngine as EngineBridge, 'compileScriptNode');

    // New DSL removes the mask input
    const result = await applyDsl(
      makeGpuDsl({ inputs: '    image image' }),
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    expect(result.success).toBe(true);
    const manifest = JSON.parse(compileScriptNode.mock.calls[0]?.[1] ?? '{}') as {
      inputs?: Array<{ name: string }>;
    };
    expect(manifest.inputs?.map(i => i.name)).toEqual(['image']);
  });

  it('surfaces a GLSL compile error as a DSL error at the definition line', async () => {
    const store = useGraphStore.getState();
    const nodeId = await store.addNode('gpu_script', { x: 0, y: 0 });
    const handleMap = new HandleMap();
    handleMap.set('crazy_thing1', nodeId);

    vi.spyOn(mockEngine as EngineBridge, 'compileScriptNode').mockRejectedValue(
      new Error('undefined variable: foo'),
    );

    const result = await applyDsl(
      makeGpuDsl({ code: '  return foo;' }),
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.message).toContain('undefined variable: foo');
      expect(result.errors[0]?.line).toBeGreaterThan(0);
    }
  });

  it('updates the __script_manifest param after successful recompile', async () => {
    const store = useGraphStore.getState();
    const nodeId = await store.addNode('gpu_script', { x: 0, y: 0 });
    const handleMap = new HandleMap();
    handleMap.set('crazy_thing1', nodeId);

    const newCode = '  return vec4(color.rgb * 0.5, color.a);';
    const result = await applyDsl(
      makeGpuDsl({ code: newCode }),
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    expect(result.success).toBe(true);
    const updatedNode = useGraphStore.getState().nodes.get(nodeId);
    const manifestJson = updatedNode?.params.__script_manifest;
    expect(manifestJson).toBeDefined();
    const manifest = JSON.parse(
      (manifestJson && 'String' in manifestJson ? manifestJson.String : '') ?? ''
    ) as { kernel?: string };
    expect(manifest.kernel).toBe(newCode);
  });

  it('scalar params go into inputs (not params) in the instance manifest', async () => {
    const store = useGraphStore.getState();
    const nodeId = await store.addNode('gpu_script', { x: 0, y: 0 });
    const handleMap = new HandleMap();
    handleMap.set('crazy_thing1', nodeId);

    const compileScriptNode = vi.spyOn(mockEngine as EngineBridge, 'compileScriptNode');
    await applyDsl(
      makeGpuDsl({ scalarParams: '    int steps = 8 min 1 max 32' }),
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    const manifest = JSON.parse(compileScriptNode.mock.calls[0]?.[1] ?? '{}') as {
      inputs?: Array<{ name: string; ty: string; default?: unknown }>;
      params?: unknown[];
    };
    const stepsPort = manifest.inputs?.find(i => i.name === 'steps');
    expect(stepsPort).toMatchObject({ name: 'steps', ty: 'Int', default: 8 });
    expect(manifest.params).toEqual([]);
  });

  it('recompiles independently when multiple gpu_script instances exist', async () => {
    const store = useGraphStore.getState();
    const nodeId1 = await store.addNode('gpu_script', { x: 0, y: 0 });
    const nodeId2 = await store.addNode('gpu_script', { x: 200, y: 0 });
    const typeId2 = useGraphStore.getState().nodes.get(nodeId2)!.typeId;
    const existingManifest2 = {
      id: typeId2,
      display_name: 'GPU Script',
      category: 'GPU',
      description: 'Custom GPU shader node',
      inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      params: [],
      kernel: 'return color;',
      supports_mask: true,
    };
    useGraphStore.getState().nodes.get(nodeId2)!.params.__script_manifest = {
      String: JSON.stringify(existingManifest2),
    };

    const handleMap = new HandleMap();
    handleMap.set('gpu1', nodeId1);
    handleMap.set('vignette1', nodeId2);

    const compileScriptNode = vi.spyOn(mockEngine as EngineBridge, 'compileScriptNode');
    const result = await applyDsl(
      [
        'node GpuNode1 = gpu {',
        '  inputs { image image }',
        '  outputs { image image }',
        '  code """',
        '  return vec4(1.0);',
        '  """',
        '}',
        '',
        'node Vignette = gpu {',
        '  inputs { image image }',
        '  outputs { image image }',
        '  code """',
        '  return vec4(0.5);',
        '  """',
        '}',
        '',
        'graph {',
        '  gpu1 = GpuNode1()',
        '  vignette1 = Vignette()',
        '}',
      ].join('\n'),
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    expect(result.success).toBe(true);
    expect(compileScriptNode).toHaveBeenCalledTimes(2);
    const kernels = compileScriptNode.mock.calls.map(
      call => (JSON.parse(call[1] ?? '{}') as { kernel?: string }).kernel
    );
    expect(kernels).toContain('  return vec4(1.0);');
    expect(kernels).toContain('  return vec4(0.5);');
  });

  it('calls registerGpuKernel for a new named gpu definition with no existing instance', async () => {
    const handleMap = new HandleMap();
    const registerGpuKernel = vi.spyOn(mockEngine as EngineBridge, 'registerGpuKernel');
    const compileScriptNode = vi.spyOn(mockEngine as EngineBridge, 'compileScriptNode');

    const result = await applyDsl(
      makeGpuDsl({ defName: 'NewKernel', handle: 'new_kernel1' }),
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    expect(result.success).toBe(true);
    expect(registerGpuKernel).toHaveBeenCalledOnce();
    expect(compileScriptNode).not.toHaveBeenCalled();
  });

  it('handles a mixed graph: one instance recompile + one new named kernel registration', async () => {
    const store = useGraphStore.getState();
    const instanceNodeId = await store.addNode('gpu_script', { x: 0, y: 0 });
    const handleMap = new HandleMap();
    handleMap.set('existing1', instanceNodeId);

    const registerGpuKernel = vi.spyOn(mockEngine as EngineBridge, 'registerGpuKernel');
    const compileScriptNode = vi.spyOn(mockEngine as EngineBridge, 'compileScriptNode');

    const result = await applyDsl(
      [
        'node ExistingGpu = gpu {',
        '  inputs { image image }',
        '  outputs { image image }',
        '  code """',
        '  return vec4(1.0);',
        '  """',
        '}',
        '',
        'node NewKernel = gpu {',
        '  inputs { image image }',
        '  outputs { image image }',
        '  code """',
        '  return color;',
        '  """',
        '}',
        '',
        'graph {',
        '  existing1 = ExistingGpu()',
        '  new1 = NewKernel()',
        '}',
      ].join('\n'),
      handleMap,
      useGraphStore.getState().nodeSpecs,
      useGraphStore.getState().nodes,
      useGraphStore.getState().connections,
    );

    expect(result.success).toBe(true);
    expect(compileScriptNode).toHaveBeenCalledOnce();
    const compiledManifest = JSON.parse(
      compileScriptNode.mock.calls[0]?.[1] ?? '{}'
    ) as { kernel?: string };
    expect(compiledManifest.kernel).toBe('  return vec4(1.0);');
    expect(registerGpuKernel).toHaveBeenCalledOnce();
    const registeredManifest = JSON.parse(
      registerGpuKernel.mock.calls[0]?.[0] ?? '{}'
    ) as { id?: string };
    expect(registeredManifest.id).toBe('new_kernel');
  });
});
