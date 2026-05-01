import type { ParamValue, SerializableGroupDefinition } from '../../../../store/types';

export interface RuntimeFixtureNode {
  handle: string;
  typeId: string;
  params?: Record<string, ParamValue>;
  inputDefaults?: Record<string, ParamValue>;
  muted?: boolean;
}

export interface RuntimeFixtureConnection {
  fromHandle: string;
  fromPort: string;
  toHandle: string;
  toPort: string;
}

export interface SemanticEquivalenceFixture {
  name: string;
  dsl: string;
  runtime: {
    groupDefinitions?: SerializableGroupDefinition[];
    nodes: RuntimeFixtureNode[];
    connections: RuntimeFixtureConnection[];
  };
}

const amountParamSpec = {
  key: 'amount',
  label: 'Amount',
  ty: 'Float' as const,
  default: { Float: 1.0 },
  min: 0,
  max: 5,
  step: 0.01,
  ui_hint: { type: 'Slider' as const },
  promotable: true,
};

const softBlurGroupDefinition: SerializableGroupDefinition = {
  id: 'group::soft_blur',
  name: 'Soft Blur',
  category: 'Custom',
  description: 'Custom group node defined in DSL',
  internal_graph: {
    nodes: [
      { id: 'input', type_id: 'group_input', params: {}, input_defaults: {}, position: [-240, 0], muted: false },
      { id: 'output', type_id: 'group_output', params: {}, input_defaults: {}, position: [240, 0], muted: false },
      { id: 'blur', type_id: 'gaussian_blur', params: {}, input_defaults: {}, position: [0, 0], muted: false },
    ],
    connections: [
      { from_node: 'input', from_port: 'image', to_node: 'blur', to_port: 'image' },
      { from_node: 'blur', from_port: 'image', to_node: 'output', to_port: 'image' },
    ],
  },
  promotions: [
    {
      group_param_key: 'amount',
      internal_node_id: 'blur',
      internal_param_key: 'amount',
      spec: amountParamSpec,
    },
  ],
  is_builtin: false,
  explicit_inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  explicit_outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
};

export const semanticEquivalenceFixtures: SemanticEquivalenceFixture[] = [
  {
    name: 'node group with promoted parameter',
    dsl: [
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
      '  plate = LoadImage()',
      '  soft = SoftBlur(amount: 2.0)',
      '  viewer = Viewer()',
      '',
      '  plate.image -> soft.image',
      '  soft.image -> viewer.image',
      '}',
    ].join('\n'),
    runtime: {
      groupDefinitions: [softBlurGroupDefinition],
      nodes: [
        { handle: 'plate', typeId: 'load_image' },
        {
          handle: 'soft',
          typeId: 'group::soft_blur',
          inputDefaults: { amount: { Float: 2.0 } },
        },
        { handle: 'viewer', typeId: 'viewer' },
      ],
      connections: [
        { fromHandle: 'plate', fromPort: 'image', toHandle: 'soft', toPort: 'image' },
        { fromHandle: 'soft', fromPort: 'image', toHandle: 'viewer', toPort: 'image' },
      ],
    },
  },
  {
    name: 'typed connection into a promotable parameter',
    dsl: [
      'graph {',
      '  plate = LoadImage()',
      '  amount = FloatConstant(value: 2.0)',
      '  blur = GaussianBlur()',
      '  viewer = Viewer()',
      '',
      '  plate.image -> blur.image',
      '  amount.value -> blur.amount',
      '  blur.image -> viewer.image',
      '}',
    ].join('\n'),
    runtime: {
      nodes: [
        { handle: 'plate', typeId: 'load_image' },
        { handle: 'amount', typeId: 'float_constant', params: { value: { Float: 2.0 } } },
        { handle: 'blur', typeId: 'gaussian_blur' },
        { handle: 'viewer', typeId: 'viewer' },
      ],
      connections: [
        { fromHandle: 'plate', fromPort: 'image', toHandle: 'blur', toPort: 'image' },
        { fromHandle: 'amount', fromPort: 'value', toHandle: 'blur', toPort: 'amount' },
        { fromHandle: 'blur', fromPort: 'image', toHandle: 'viewer', toPort: 'image' },
      ],
    },
  },
  {
    name: 'parameter coercion for numeric and dropdown params',
    dsl: [
      'graph {',
      '  plate = LoadImage()',
      '  blur = GaussianBlur(amount: 3)',
      '  export = ExportImage(format: "jpg")',
      '  viewer = Viewer()',
      '',
      '  plate.image -> blur.image',
      '  blur.image -> export.image',
      '  blur.image -> viewer.image',
      '}',
    ].join('\n'),
    runtime: {
      nodes: [
        { handle: 'plate', typeId: 'load_image' },
        { handle: 'blur', typeId: 'gaussian_blur', inputDefaults: { amount: { Float: 3.0 } } },
        { handle: 'export', typeId: 'export_image', params: { format: { Int: 1 } } },
        { handle: 'viewer', typeId: 'viewer' },
      ],
      connections: [
        { fromHandle: 'plate', fromPort: 'image', toHandle: 'blur', toPort: 'image' },
        { fromHandle: 'blur', fromPort: 'image', toHandle: 'export', toPort: 'image' },
        { fromHandle: 'blur', fromPort: 'image', toHandle: 'viewer', toPort: 'image' },
      ],
    },
  },
];
