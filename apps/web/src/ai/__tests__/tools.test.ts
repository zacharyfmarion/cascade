import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, NodeInstance, NodeSpec } from '../../store/types';
import { createMockEngine, resetNodeCounter } from '../../__tests__/engineMock';

if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true });
}

let mockEngine = createMockEngine();

vi.mock('../../engine/wasmEngine', () => ({
  initWasmEngine: vi.fn(),
  get wasmEngine() {
    return mockEngine;
  },
}));

type GraphStore = typeof import('../../store/graphStore')['useGraphStore'];
type ExecuteCascadeTool = typeof import('../tools')['executeCascadeTool'];

let useGraphStore: GraphStore;
let executeCascadeTool: ExecuteCascadeTool;

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
  projectSessionRevision: 0,
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
  dslShadow: null,
  customGroupDefinitions: [],
  graphRevision: 0,
  lastTransactionOrigin: null,
});

const invertDsl = (definitionName: string) => [
  `node ${definitionName} = gpu {`,
  '  inputs {',
  '    image image',
  '  }',
  '',
  '  outputs {',
  '    image image',
  '  }',
  '',
  '  code """',
  '  return vec4(1.0 - color.rgb, color.a);',
  '  """',
  '}',
  '',
  'graph {',
  '  load1 = LoadImage()',
  `  invert1 = ${definitionName}()`,
  '  viewer1 = Viewer()',
  '',
  '  load1.image -> invert1.image',
  '  invert1.image -> viewer1.value',
  '}',
].join('\n');

const builtinInvertSpec: NodeSpec = {
  id: 'gpu_kernel::invert',
  display_name: 'Invert',
  category: 'Color',
  description: 'Invert colors',
  inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  params: [],
};

describe('Cascade AI tools', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockEngine = createMockEngine();
    const storeMod = await import('../../store/graphStore');
    const toolsMod = await import('../tools');
    useGraphStore = storeMod.useGraphStore;
    executeCascadeTool = toolsMod.executeCascadeTool;
    useGraphStore.setState(createInitialState());
    resetNodeCounter();
    await useGraphStore.getState().initEngine();
  });

  it('applies custom GPU definitions through the shared DSL executor', async () => {
    const dsl = invertDsl('InvertImage');
    const result = await executeCascadeTool('write_graph', { dsl }) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.graph).toContain('node InvertImage = gpu {');
    expect(result.graph).toContain('invert1 = InvertImage()');
    expect(useGraphStore.getState().nodeSpecs.some(spec => spec.id === 'invert_image')).toBe(true);
    expect(Array.from(useGraphStore.getState().nodes.values()).some(node => node.typeId === 'invert_image')).toBe(true);
    expect(useGraphStore.getState().dslShadow?.text).toBe(dsl);
    expect(useGraphStore.getState().lastTransactionOrigin).toBe('ai');
  });

  it('rejects custom GPU definitions that collide with built-in node names', async () => {
    useGraphStore.setState({
      nodeSpecs: [...useGraphStore.getState().nodeSpecs, builtinInvertSpec],
    });

    const result = await executeCascadeTool('write_graph', { dsl: invertDsl('Invert') }) as Record<string, unknown>;
    const errors = result.errors as Array<{ message: string }>;

    expect(result.success).toBe(false);
    expect(errors.some(error => error.message.includes('Custom node "Invert" conflicts with a built-in node type'))).toBe(true);
  });
});
