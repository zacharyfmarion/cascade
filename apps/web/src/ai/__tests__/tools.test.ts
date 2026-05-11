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

  it('reports ExportImageBatch output_dir as a string in get_node_schema', async () => {
    const result = await executeCascadeTool('get_node_schema', { node_type: 'ExportImageBatch' }) as Record<string, unknown>;
    const params = result.params as Array<{ key: string; type: string }>;

    expect(result.type).toBe('ExportImageBatch');
    expect(params.find(param => param.key === 'output_dir')?.type).toBe('String');
    expect(params.find(param => param.key === 'filename_template')?.type).toBe('String');
  });

  it('edits a graph containing ExportImageBatch without changing export params', async () => {
    const dsl = [
      'graph {',
      '  load1 = LoadImage()',
      '  export1 = ExportImageBatch(output_dir: "/tmp/out", filename_template: "{index1}_{name}")',
      '',
      '  load1.image -> export1.image',
      '}',
    ].join('\n');

    const writeResult = await executeCascadeTool('write_graph', { dsl }) as Record<string, unknown>;
    expect(writeResult.success).toBe(true);

    const editResult = await executeCascadeTool('edit_graph', {
      old_text: '  load1.image -> export1.image',
      new_text: [
        '  blur1 = GaussianBlur(amount: 2.0)',
        '',
        '  load1.image -> blur1.image',
        '  blur1.image -> export1.image',
      ].join('\n'),
    }) as Record<string, unknown>;

    expect(editResult.success).toBe(true);
    expect(editResult.graph).toContain('ExportImageBatch(output_dir: "/tmp/out", filename_template: "{index1}_{name}")');
    expect(editResult.graph).toContain('blur1 = GaussianBlur(amount: 2.0)');

    const exportNode = Array.from(useGraphStore.getState().nodes.values())
      .find(node => node.typeId === 'export_image_batch');
    expect(exportNode?.params.output_dir).toEqual({ String: '/tmp/out' });
    expect(exportNode?.params.filename_template).toEqual({ String: '{index1}_{name}' });
  });
});
