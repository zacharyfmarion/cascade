import { describe, expect, it } from 'vitest';
import { parseDsl } from '../parser';
import { dslShadowMatchesGraph, graphSemanticHash, hydrateDslShadowMetadata, reconcileDslShadowText } from '../shadow';
import type { Connection, DslShadowDocument, NodeInstance, NodeSpec, SerializableGroupDefinition } from '../../../store/types';

const specs: NodeSpec[] = [
  {
    id: 'gaussian_blur',
    display_name: 'Gaussian Blur',
    category: 'Filter',
    description: '',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: [
      {
        key: 'amount',
        label: 'Amount',
        ty: 'Float',
        default: { Float: 1.0 },
        ui_hint: { type: 'Slider' },
        promotable: true,
      },
    ],
  },
  {
    id: 'viewer',
    display_name: 'Viewer',
    category: 'Output',
    description: '',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [{ name: 'display', label: 'Display', ty: 'Image' }],
    params: [],
  },
];

const gpuSpecs: NodeSpec[] = [
  {
    id: 'gpu_script',
    display_name: 'GPU Script',
    category: 'GPU',
    description: '',
    inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: [],
  },
  {
    id: 'load_image',
    display_name: 'Load Image',
    category: 'Input',
    description: '',
    inputs: [],
    outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
    params: [],
  },
  {
    id: 'viewer',
    display_name: 'Viewer',
    category: 'Output',
    description: '',
    inputs: [{ name: 'value', label: 'Value', ty: 'Image' }],
    outputs: [],
    params: [],
  },
];

const gpuDslText = [
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
  '  # Testing a comment',
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

const gpuManifest = (kernel: string) => ({
  id: 'gpu_script::8193a1c3-2cdb-4a40-8a3b-1243944a6e00',
  display_name: 'GPU Script',
  category: 'GPU',
  description: 'Custom GPU shader node',
  inputs: [
    { name: 'image', label: 'Image', ty: 'Image', optional: false },
    { name: 'age', label: 'Age', ty: 'Float', optional: false, default: 0, ui: 'Slider' },
  ],
  outputs: [{ name: 'image', label: 'Image', ty: 'Image', optional: false }],
  params: [],
  kernel,
  supports_mask: true,
  pixel_space_params: [],
});

const gpuNodes = (kernel = '  return color * 2;'): Map<string, NodeInstance> => {
  const gpuNode: NodeInstance = {
    id: 'gpu-node',
    typeId: 'gpu_script::8193a1c3-2cdb-4a40-8a3b-1243944a6e00',
    params: { __script_manifest: { String: JSON.stringify(gpuManifest(kernel)) } },
    inputDefaults: { age: { Float: 0 } },
    position: { x: 0, y: 0 },
    muted: false,
  };
  const loadNode: NodeInstance = {
    id: 'load-node',
    typeId: 'load_image',
    params: {},
    inputDefaults: {},
    position: { x: 0, y: 0 },
    muted: false,
  };
  const viewerNode: NodeInstance = {
    id: 'viewer-node',
    typeId: 'viewer',
    params: {},
    inputDefaults: {},
    position: { x: 0, y: 0 },
    muted: false,
  };
  return new Map([
    ['gpu-node', gpuNode],
    ['load-node', loadNode],
    ['viewer-node', viewerNode],
  ]);
};

const gpuConnections: Connection[] = [
  { id: 'c1', fromNode: 'load-node', fromPort: 'image', toNode: 'gpu-node', toPort: 'image' },
  { id: 'c2', fromNode: 'gpu-node', fromPort: 'image', toNode: 'viewer-node', toPort: 'value' },
];

const gpuShadow = (status: DslShadowDocument['status'] = 'stale'): DslShadowDocument => ({
  version: 1,
  text: gpuDslText,
  graphHash: 'legacy-hash-from-older-normalization',
  graphRevision: 1,
  handles: [
    { nodeId: 'gpu-node', handle: 'gpu1' },
    { nodeId: 'load-node', handle: 'load1' },
    { nodeId: 'viewer-node', handle: 'viewer1' },
  ],
  customDefinitionNames: [{ runtimeId: 'gpu_node_1', name: 'GpuNode1' }],
  status,
});

describe('reconcileDslShadowText', () => {
  it('patches changed node lines while preserving comments and spacing', () => {
    const oldText = [
      '# top comment',
      'graph {',
      '  # keep this comment',
      '    blur1   =   GaussianBlur( amount: 1.0 )   # keep inline node note',
      '',
      '    viewer1   =   Viewer()',
      '}',
    ].join('\n');
    const newText = [
      'graph {',
      '  blur1 = GaussianBlur(amount: 2.0)',
      '  viewer1 = Viewer()',
      '}',
    ].join('\n');

    const oldParse = parseDsl(oldText, specs);
    const newParse = parseDsl(newText, specs);
    const reconciled = reconcileDslShadowText(oldText, oldParse.sourceMap, newText, newParse.sourceMap);

    expect(reconciled).toBe([
      '# top comment',
      'graph {',
      '  # keep this comment',
      '    blur1 = GaussianBlur(amount: 2.0)   # keep inline node note',
      '',
      '    viewer1   =   Viewer()',
      '}',
    ].join('\n'));
  });

  it('preserves untouched connection formatting and inline comments', () => {
    const oldText = [
      'graph {',
      '  blur1 = GaussianBlur()',
      '  viewer1 = Viewer()',
      '    blur1.image   ->   viewer1.image   # display result',
      '}',
    ].join('\n');
    const newText = [
      'graph {',
      '  blur1 = GaussianBlur()',
      '  viewer1 = Viewer()',
      '  blur1.image -> viewer1.image',
      '}',
    ].join('\n');

    const oldParse = parseDsl(oldText, specs);
    const newParse = parseDsl(newText, specs);
    const reconciled = reconcileDslShadowText(oldText, oldParse.sourceMap, newText, newParse.sourceMap);

    expect(reconciled).toBe([
      'graph {',
      '  blur1 = GaussianBlur()',
      '  viewer1 = Viewer()',
      '    blur1.image   ->   viewer1.image   # display result',
      '}',
    ].join('\n'));
  });

  it('appends new semantic lines before the graph close', () => {
    const oldText = [
      'graph {',
      '  blur1 = GaussianBlur()',
      '}',
    ].join('\n');
    const newText = [
      'graph {',
      '  blur1 = GaussianBlur()',
      '  viewer1 = Viewer()',
      '  blur1.image -> viewer1.image',
      '}',
    ].join('\n');

    const oldParse = parseDsl(oldText, specs);
    const newParse = parseDsl(newText, specs);
    const reconciled = reconcileDslShadowText(oldText, oldParse.sourceMap, newText, newParse.sourceMap);

    expect(reconciled).toBe(newText);
  });

  it('removes deleted node and connection lines', () => {
    const oldText = [
      'graph {',
      '  blur1 = GaussianBlur()',
      '  viewer1 = Viewer()',
      '  blur1.image -> viewer1.image',
      '}',
    ].join('\n');
    const newText = [
      'graph {',
      '  viewer1 = Viewer()',
      '}',
    ].join('\n');

    const oldParse = parseDsl(oldText, specs);
    const newParse = parseDsl(newText, specs);
    const reconciled = reconcileDslShadowText(oldText, oldParse.sourceMap, newText, newParse.sourceMap);

    expect(reconciled).toBe(newText);
  });

  it('falls back when custom group definition names change', () => {
    const oldText = [
      'node NiceGroup = group {',
      '  inputs {',
      '    image image',
      '  }',
      '',
      '  outputs {',
      '    image image',
      '  }',
      '}',
      '',
      'graph {',
      '  group1 = NiceGroup()',
      '}',
    ].join('\n');
    const newText = oldText.replaceAll('NiceGroup', 'BetterGroup');

    const oldParse = parseDsl(oldText, specs);
    const newParse = parseDsl(newText, specs);
    const reconciled = reconcileDslShadowText(oldText, oldParse.sourceMap, newText, newParse.sourceMap);

    expect(reconciled).toBeNull();
  });

  it('falls back when GPU script code changes outside the shadow text', () => {
    const oldText = [
      'node GpuNode1 = gpu {',
      '  inputs {',
      '    image image',
      '  }',
      '',
      '  outputs {',
      '    image image',
      '  }',
      '',
      '  # keep this definition comment',
      '  code """',
      '  return color;',
      '  """',
      '}',
      '',
      'graph {',
      '  gpu1 = GpuNode1()',
      '}',
    ].join('\n');
    const newText = oldText.replace('return color;', 'return color * 2.0;');

    const oldParse = parseDsl(oldText, gpuSpecs);
    const newParse = parseDsl(newText, gpuSpecs);
    const reconciled = reconcileDslShadowText(oldText, oldParse.sourceMap, newText, newParse.sourceMap);

    expect(reconciled).toBeNull();
  });

  it('preserves custom definition comments when only the root graph changes', () => {
    const oldText = [
      'node GpuNode1 = gpu {',
      '  inputs {',
      '    image image',
      '  }',
      '',
      '  outputs {',
      '    image image',
      '  }',
      '',
      '  # keep this definition comment',
      '  code """',
      '  return color;',
      '  """',
      '}',
      '',
      'graph {',
      '  gpu1 = GpuNode1()',
      '}',
    ].join('\n');
    const newText = [
      'node GpuNode1 = gpu {',
      '  inputs {',
      '    image image',
      '  }',
      '',
      '  outputs {',
      '    image image',
      '  }',
      '',
      '  code """',
      '  return color;',
      '  """',
      '}',
      '',
      'graph {',
      '  gpu1 = GpuNode1()',
      '  viewer1 = Viewer()',
      '  gpu1.image -> viewer1.value',
      '}',
    ].join('\n');

    const oldParse = parseDsl(oldText, gpuSpecs);
    const newParse = parseDsl(newText, gpuSpecs);
    const reconciled = reconcileDslShadowText(oldText, oldParse.sourceMap, newText, newParse.sourceMap);

    expect(reconciled).toContain('# keep this definition comment');
    expect(reconciled).toContain('  viewer1 = Viewer()');
    expect(reconciled).toContain('  gpu1.image -> viewer1.value');
  });

  it('falls back to canonical serialization when new custom definitions are introduced', () => {
    const oldText = [
      'graph {',
      '  load1 = LoadImage()',
      '}',
    ].join('\n');
    const newText = [
      'node GpuNode1 = gpu {',
      '  inputs {',
      '    image image',
      '  }',
      '',
      '  outputs {',
      '    image image',
      '  }',
      '',
      '  code """',
      '  return color;',
      '  """',
      '}',
      '',
      'graph {',
      '  gpu1 = GpuNode1()',
      '  load1 = LoadImage()',
      '  load1.image -> gpu1.image',
      '}',
    ].join('\n');

    const oldParse = parseDsl(oldText, gpuSpecs);
    const newParse = parseDsl(newText, gpuSpecs);
    const reconciled = reconcileDslShadowText(oldText, oldParse.sourceMap, newText, newParse.sourceMap);

    expect(reconciled).toBeNull();
  });
});

describe('DSL shadow graph matching', () => {
  it('includes custom group definitions in the semantic hash', () => {
    const nodes = new Map<string, NodeInstance>([
      ['group-node', {
        id: 'group-node',
        typeId: 'group::user_123',
        params: {},
        inputDefaults: {},
        position: { x: 0, y: 0 },
        muted: false,
      }],
    ]);
    const baseDefinition: SerializableGroupDefinition = {
      id: 'group::user_123',
      name: 'Node Group',
      category: 'User',
      description: '',
      internal_graph: {
        nodes: [
          { id: 'blur-internal', type_id: 'gaussian_blur', params: { amount: { Float: 1 } }, input_defaults: {}, position: [0, 0] },
          { id: 'gi', type_id: 'group_input', params: {}, input_defaults: {}, position: [0, 0] },
          { id: 'go', type_id: 'group_output', params: {}, input_defaults: {}, position: [0, 0] },
        ],
        connections: [],
      },
      promotions: [],
      is_builtin: false,
      explicit_inputs: null,
      explicit_outputs: null,
    };
    const editedDefinition: SerializableGroupDefinition = {
      ...baseDefinition,
      internal_graph: {
        ...baseDefinition.internal_graph,
        nodes: baseDefinition.internal_graph.nodes.map(node => (
          node.id === 'blur-internal'
            ? { ...node, params: { amount: { Float: 2 } } }
            : node
        )),
      },
    };

    expect(graphSemanticHash(nodes, [], [baseDefinition]))
      .not.toBe(graphSemanticHash(nodes, [], [editedDefinition]));
  });

  it('ignores unused runtime group definitions in the semantic hash', () => {
    const nodes = new Map<string, NodeInstance>([
      ['group-node', {
        id: 'group-node',
        typeId: 'group::active',
        params: {},
        inputDefaults: {},
        position: { x: 0, y: 0 },
        muted: false,
      }],
    ]);
    const active: SerializableGroupDefinition = {
      id: 'group::active',
      name: 'Active',
      category: 'User',
      description: '',
      internal_graph: { nodes: [], connections: [] },
      promotions: [],
      is_builtin: false,
      explicit_inputs: null,
      explicit_outputs: null,
    };
    const stale: SerializableGroupDefinition = {
      ...active,
      id: 'group::stale',
      name: 'Stale',
      internal_graph: {
        nodes: [{ id: 'blur1', type_id: 'gaussian_blur', params: { amount: { Float: 99 } }, input_defaults: {}, position: [0, 0] }],
        connections: [],
      },
    };

    expect(graphSemanticHash(nodes, [], [active]))
      .toBe(graphSemanticHash(nodes, [], [active, stale]));
  });

  it('treats saved GPU DSL with comments as current when graph manifests only differ by serialization defaults', () => {
    const shadow = gpuShadow();

    expect(dslShadowMatchesGraph(shadow, gpuNodes(), gpuConnections, gpuSpecs)).toBe(true);
  });

  it('does not treat GPU DSL as current when the persisted graph has different GLSL code', () => {
    const shadow = gpuShadow();

    expect(dslShadowMatchesGraph(shadow, gpuNodes('  return color;'), gpuConnections, gpuSpecs)).toBe(false);
  });

  it('hydrates semantically matching GPU DSL as valid so comments and code survive save/load', () => {
    const hydrated = hydrateDslShadowMetadata(
      {
        version: 1,
        text: gpuDslText,
        graph_hash: 'legacy-hash-from-older-normalization',
        handles: [
          { node_id: 'gpu-node', handle: 'gpu1' },
          { node_id: 'load-node', handle: 'load1' },
          { node_id: 'viewer-node', handle: 'viewer1' },
        ],
        custom_definition_names: [{ runtime_id: 'gpu_node_1', name: 'GpuNode1' }],
      },
      gpuNodes(),
      gpuConnections,
      gpuSpecs,
      42,
    );

    expect(hydrated?.status).toBe('valid');
    expect(hydrated?.graphHash).toBe(graphSemanticHash(gpuNodes(), gpuConnections));
    expect(hydrated?.text).toContain('# Testing a comment');
    expect(hydrated?.text).toContain('return color * 2;');
  });

  it('treats LoadImage asset constructor text as valid when desktop graph stores the image as an embedded asset', () => {
    const nodesWithoutPath = gpuNodes();
    const loadNode = nodesWithoutPath.get('load-node');
    expect(loadNode).toBeDefined();
    loadNode!.params = {};
    const textWithPath = gpuDslText.replace('load1 = LoadImage()', 'load1 = LoadImage(path: image("file:///tmp/plate.png"))');
    const shadow: DslShadowDocument = {
      ...gpuShadow(),
      text: textWithPath,
      graphHash: 'hash-before-desktop-asset-embedding',
    };

    expect(dslShadowMatchesGraph(shadow, nodesWithoutPath, gpuConnections, gpuSpecs)).toBe(true);
  });

  it('hydrates non-matching GPU DSL as stale rather than silently accepting wrong code', () => {
    const hydrated = hydrateDslShadowMetadata(
      {
        version: 1,
        text: gpuDslText,
        graph_hash: 'legacy-hash-from-older-normalization',
        handles: [
          { node_id: 'gpu-node', handle: 'gpu1' },
          { node_id: 'load-node', handle: 'load1' },
          { node_id: 'viewer-node', handle: 'viewer1' },
        ],
        custom_definition_names: [{ runtime_id: 'gpu_node_1', name: 'GpuNode1' }],
      },
      gpuNodes('  return color;'),
      gpuConnections,
      gpuSpecs,
      42,
    );

    expect(hydrated?.status).toBe('stale');
    expect(hydrated?.graphHash).toBe('legacy-hash-from-older-normalization');
  });
});
