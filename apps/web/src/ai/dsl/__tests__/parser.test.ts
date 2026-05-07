import { describe, it, expect } from 'vitest';
import { parseDsl, splitTopLevelParams } from '../parser';
import { mockSpecs } from './helpers';
import { HandleMap } from '../handleMap';
import { buildDefaultGpuScriptManifest, buildGpuScriptNodeSpec } from '../../gpuScript';
import type { NodeSpec } from '../../../store/types';

const graph = (body: string): string => {
  if (!body.trim()) return '';
  if (/^\s*(cascade\s+\d+\s*)?graph\s*\{/.test(body)) return body;
  return `graph {\n${body}\n}`;
};

const parseGraph = (...args: Parameters<typeof parseDsl>) =>
  parseDsl(graph(args[0]), args[1], args[2]);

describe('parseDsl', () => {
  it('parses empty input to empty ast', () => {
    const result = parseGraph('', mockSpecs);
    expect(result.errors).toHaveLength(0);
    expect(result.ast?.nodes.size).toBe(0);
    expect(result.ast?.connections).toHaveLength(0);
  });

  it('parses single node without params', () => {
    const result = parseGraph('viewer1 = Viewer()', mockSpecs);
    expect(result.errors).toHaveLength(0);
    const node = result.ast?.nodes.get('viewer1');
    expect(node?.nodeType).toBe('Viewer');
    expect(node?.nodeTypeId).toBe('viewer');
    expect(node?.params.size).toBe(0);
    expect(node?.inputDefaults.size).toBe(0);
  });

  it('parses scalar input defaults separately from params', () => {
    const result = parseGraph('math1 = Math(a: 3.0, b: 7.0, operation: "multiply")', mockSpecs);
    expect(result.errors).toHaveLength(0);
    const node = result.ast?.nodes.get('math1');
    expect(node?.params.get('operation')).toEqual({ type: 'dropdown', value: 'multiply', index: 2 });
    expect(node?.inputDefaults.get('a')).toEqual({ type: 'float', value: 3 });
    expect(node?.inputDefaults.get('b')).toEqual({ type: 'float', value: 7 });
  });

  it('uses input prefix to target colliding input defaults', () => {
    const collisionSpec: NodeSpec = {
      id: 'collision_node',
      display_name: 'Collision Node',
      category: 'Utility',
      description: 'Has a param and input with the same name',
      inputs: [{ name: 'amount', label: 'Amount Input', ty: 'Float', default: { Float: 0 } }],
      outputs: [],
      params: [{
        key: 'amount',
        label: 'Amount Param',
        ty: 'Float',
        default: { Float: 1 },
        ui_hint: { type: 'NumberInput' },
        promotable: false,
      }],
    };
    const result = parseGraph('collision1 = CollisionNode(amount: 2.0, input.amount: 3.0)', [...mockSpecs, collisionSpec]);
    expect(result.errors).toHaveLength(0);
    const node = result.ast?.nodes.get('collision1');
    expect(node?.params.get('amount')).toEqual({ type: 'float', value: 2 });
    expect(node?.inputDefaults.get('amount')).toEqual({ type: 'float', value: 3 });
  });

  it('rejects non-scalar input defaults in node calls', () => {
    const result = parseGraph('load1 = LoadImage(image: 1.0)', mockSpecs);
    expect(result.errors.some(error => error.message.includes("Unknown param 'image' on LoadImage"))).toBe(true);
  });

  it('rejects non-empty DSL without a graph block', () => {
    const result = parseDsl('viewer1 = Viewer()', mockSpecs);
    expect(result.errors).toEqual([{ line: 1, message: 'Expected a graph { ... } block' }]);
  });

  it('parses versioned graph blocks', () => {
    const result = parseGraph([
      'cascade 1',
      '',
      'graph {',
      '  load1 = LoadImage(path: image("file:///img/photo.jpg", color_space: "sRGB"))',
      '  blur1 = GaussianBlur(amount: 5.0)',
      '',
      '  load1.image -> blur1.image',
      '}',
    ].join('\n'), mockSpecs);

    expect(result.errors).toHaveLength(0);
    expect(result.ast?.nodes.size).toBe(2);
    expect(result.ast?.nodes.get('load1')?.params.get('path')).toEqual({
      type: 'string',
      value: 'file:///img/photo.jpg',
    });
    expect(result.ast?.connections).toEqual([
      { fromHandle: 'load1', fromPort: 'image', toHandle: 'blur1', toPort: 'image', line: 7 },
    ]);
  });

  it('parses gpu custom node definitions before the root graph', () => {
    const result = parseDsl([
      'cascade 1',
      '',
      'node FilmGlow = gpu {',
      '  inputs {',
      '    image image',
      '    mask mask?',
      '    float gain = 1.2 min 0.0 max 4.0 step 0.01',
      '  }',
      '',
      '  outputs {',
      '    image image',
      '  }',
      '',
      '  code """',
      '  vec3 glow = color.rgb * gain;',
      '  return vec4(glow, color.a);',
      '  """',
      '}',
      '',
      'graph {',
      '  glow1 = FilmGlow(gain: 1.5)',
      '}',
    ].join('\n'), mockSpecs);

    expect(result.errors).toHaveLength(0);
    const definition = result.ast?.customNodes?.get('FilmGlow');
    expect(definition?.kind).toBe('gpu');
    if (definition?.kind !== 'gpu') throw new Error('expected gpu definition');
    expect(definition.inputs).toMatchObject([
      { valueType: 'image', name: 'image', optional: false },
      { valueType: 'mask', name: 'mask', optional: true },
      { valueType: 'float', name: 'gain', defaultValue: { type: 'float', value: 1.2 }, min: 0, max: 4, step: 0.01 },
    ]);
    expect(definition.outputs).toMatchObject([{ valueType: 'image', name: 'image' }]);
    expect(definition.code).toContain('return vec4(glow, color.a);');
    expect(result.ast?.nodes.get('glow1')?.nodeTypeId).toBe('film_glow');
  });

  it('parses group custom node definitions with internal graph syntax', () => {
    const result = parseDsl([
      'node KeyMix = group {',
      '  inputs {',
      '    image plate',
      '    image foreground',
      '    mask matte',
      '  }',
      '',
      '  outputs {',
      '    image image',
      '  }',
      '',
      '  params {',
      '    float opacity = 1.0 min 0.0 max 1.0 step 0.01',
      '    bool invert_matte = false',
      '  }',
      '',
      '  graph {',
      '    inv = InvertMask(enabled: param.invert_matte)',
      '    over = AlphaOver(opacity: param.opacity)',
      '',
      '    input.matte -> inv.mask',
      '    input.plate -> over.background',
      '    input.foreground -> over.foreground',
      '    inv.mask -> over.mask',
      '    over.image -> output.image',
      '  }',
      '}',
      '',
      'graph {',
      '  key1 = KeyMix(opacity: 0.8)',
      '}',
    ].join('\n'), [
      ...mockSpecs,
      {
        id: 'invert_mask',
        display_name: 'Invert Mask',
        category: 'Mask',
        description: 'Invert a mask',
        inputs: [{ name: 'mask', label: 'Mask', ty: 'Mask' }],
        outputs: [{ name: 'mask', label: 'Mask', ty: 'Mask' }],
        params: [{
          key: 'enabled',
          label: 'Enabled',
          ty: 'Bool',
          default: { Bool: true },
          ui_hint: { type: 'Checkbox' },
          promotable: true,
        }],
      },
      {
        id: 'alpha_over',
        display_name: 'Alpha Over',
        category: 'Composite',
        description: 'Composite foreground over background',
        inputs: [
          { name: 'background', label: 'Background', ty: 'Image' },
          { name: 'foreground', label: 'Foreground', ty: 'Image' },
          { name: 'mask', label: 'Mask', ty: 'Mask' },
        ],
        outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        params: [{
          key: 'opacity',
          label: 'Opacity',
          ty: 'Float',
          default: { Float: 1 },
          min: 0,
          max: 1,
          step: 0.01,
          ui_hint: { type: 'Slider' },
          promotable: true,
        }],
      },
    ]);

    expect(result.errors).toHaveLength(0);
    const definition = result.ast?.customNodes?.get('KeyMix');
    expect(definition?.kind).toBe('group');
    if (definition?.kind !== 'group') throw new Error('expected group definition');
    expect(definition.params).toMatchObject([
      { valueType: 'float', name: 'opacity', defaultValue: { type: 'float', value: 1 }, min: 0, max: 1, step: 0.01 },
      { valueType: 'bool', name: 'invert_matte', defaultValue: { type: 'bool', value: false } },
    ]);
    expect(definition.graph.nodes.get('inv')?.nodeTypeId).toBe('invert_mask');
    expect(definition.graph.connections).toContainEqual({
      fromHandle: 'over',
      fromPort: 'image',
      toHandle: 'output',
      toPort: 'image',
      line: 25,
    });
    expect(result.ast?.nodes.get('key1')?.nodeTypeId).toBe('group::key_mix');
  });

  it('parses a production golden document with comments, assets, refs, wrappers, arrows, and custom definitions', () => {
    const specs: NodeSpec[] = [
      ...mockSpecs,
      {
        id: 'load_image_sequence',
        display_name: 'Load Image Sequence',
        category: 'Input',
        description: 'Loads an image sequence',
        inputs: [],
        outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        params: [{
          key: 'path',
          label: 'Path',
          ty: 'String',
          default: { String: '' },
          ui_hint: { type: 'FilePicker' },
          promotable: false,
        }],
      },
      {
        id: 'load_video',
        display_name: 'Load Video',
        category: 'Input',
        description: 'Loads a video file',
        inputs: [],
        outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        params: [{
          key: 'path',
          label: 'Path',
          ty: 'String',
          default: { String: '' },
          ui_hint: { type: 'FilePicker' },
          promotable: false,
        }],
      },
      {
        id: 'load_image_batch',
        display_name: 'Load Image Batch',
        category: 'Input',
        description: 'Loads multiple images',
        inputs: [],
        outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        params: [{
          key: 'files',
          label: 'Files',
          ty: 'String',
          default: { String: '' },
          ui_hint: { type: 'FilePicker' },
          promotable: false,
        }],
      },
    ];
    const result = parseDsl([
      'cascade 1',
      '',
      '# Preserve a custom GPU definition comment.',
      'node FilmGlow = gpu {',
      '  inputs {',
      '    image image',
      '    float gain = 1.2 min 0.0 max 4.0 step 0.01',
      '  }',
      '',
      '  outputs {',
      '    image image',
      '  }',
      '',
      '  code """',
      '  return color * gain;',
      '  """',
      '}',
      '',
      'node KeyMix = group {',
      '  inputs {',
      '    image plate',
      '    image foreground',
      '  }',
      '',
      '  outputs {',
      '    image image',
      '  }',
      '',
      '  params {',
      '    float opacity = 0.75 min 0.0 max 1.0 step 0.01',
      '  }',
      '',
      '  graph {',
      '    blur = GaussianBlur(amount: param.opacity)',
      '    input.foreground -> blur.image',
      '    blur.image -> output.image',
      '  }',
      '}',
      '',
      'graph {',
      '  plate = LoadImage(path: image("file:///shots/a/plate.exr", color_space: "sRGB"))',
      '  seq = LoadImageSequence(path: sequence("file:///shot.%04d.exr", first: 1001, last: 1100))',
      '  clip = LoadVideo(path: video("file:///ref.mov"))',
      '  batch = LoadImageBatch(files: images([',
      '    "file:///a.png",',
      '    "file:///b.png"',
      '  ]))',
      '  ramp = ColorRamp(stops: [0.0: rgba(0.0, 0.0, 0.0, 1.0), 1.0: rgba(1.0, 1.0, 1.0, 1.0)])',
      '  curve = Curves(master_curve: [(0.0, 0.0), (0.5, 0.7), (1.0, 1.0)])',
      '  blur = muted(GaussianBlur(amount: 12.0)) # wrapper syntax',
      '  glow = FilmGlow(gain: 1.5)',
      '  key = KeyMix(opacity: 0.8)',
      '  view = Viewer()',
      '',
      '  plate.image -> blur.image',
      '  blur.image -> glow.image',
      '  glow.image -> key.foreground',
      '  key.image -> view.image',
      '}',
    ].join('\n'), specs);

    expect(result.errors).toHaveLength(0);
    expect(result.ast?.customNodes?.get('FilmGlow')?.kind).toBe('gpu');
    expect(result.ast?.customNodes?.get('KeyMix')?.kind).toBe('group');
    const keyMix = result.ast?.customNodes?.get('KeyMix');
    if (keyMix?.kind !== 'group') throw new Error('expected group definition');
    expect(keyMix.graph.nodes.get('blur')?.params.get('amount')).toEqual({ type: 'ref', value: 'param.opacity' });
    expect(result.ast?.nodes.get('plate')?.params.get('path')).toEqual({ type: 'string', value: 'file:///shots/a/plate.exr' });
    expect(result.ast?.nodes.get('seq')?.params.get('path')).toEqual({ type: 'string', value: 'file:///shot.%04d.exr' });
    expect(result.ast?.nodes.get('clip')?.params.get('path')).toEqual({ type: 'string', value: 'file:///ref.mov' });
    expect(result.ast?.nodes.get('batch')?.params.get('files')).toEqual({
      type: 'string',
      value: 'images([\n    "file:///a.png",\n    "file:///b.png"\n  ])',
    });
    expect(result.ast?.nodes.get('ramp')?.params.get('stops')).toMatchObject({ type: 'ramp' });
    expect(result.ast?.nodes.get('curve')?.params.get('master_curve')).toMatchObject({ type: 'curve' });
    expect(result.ast?.nodes.get('blur')?.muted).toBe(true);
    expect(result.ast?.nodes.get('glow')?.nodeTypeId).toBe('film_glow');
    expect(result.ast?.nodes.get('key')?.nodeTypeId).toBe('group::key_mix');
    expect(result.ast?.connections.map(connection => `${connection.fromHandle}.${connection.fromPort}->${connection.toHandle}.${connection.toPort}`)).toEqual([
      'plate.image->blur.image',
      'blur.image->glow.image',
      'glow.image->key.foreground',
      'key.image->view.image',
    ]);
  });

  it('parses virtual load image path when runtime spec only exposes image_data', () => {
    const runtimeSpecs = mockSpecs.map((spec) => spec.id === 'load_image'
      ? {
          ...spec,
          params: [{
            key: 'image_data',
            label: 'Image Data',
            ty: 'String' as const,
            default: { String: '' },
            ui_hint: { type: 'Hidden' as const },
            promotable: true,
          }],
        }
      : spec);
    const result = parseGraph('load1 = LoadImage(path: image("file:///Users/test/plate.png"))', runtimeSpecs);
    expect(result.errors).toHaveLength(0);
    expect(result.ast?.nodes.get('load1')?.params.get('path')).toEqual({
      type: 'string',
      value: 'file:///Users/test/plate.png',
    });
  });

  it('parses internal asset URIs inside asset constructors as string params', () => {
    const imageUri = 'asset://sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const sequenceUri = 'asset://sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const videoUri = 'asset://sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    const specs: NodeSpec[] = [
      ...mockSpecs,
      {
        id: 'load_image_sequence',
        display_name: 'Load Image Sequence',
        category: 'Input',
        description: 'Loads an image sequence',
        inputs: [],
        outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        params: [{
          key: 'directory',
          label: 'Directory',
          ty: 'String',
          default: { String: '' },
          ui_hint: { type: 'FilePicker' },
          promotable: false,
        }],
      },
      {
        id: 'load_video',
        display_name: 'Load Video',
        category: 'Input',
        description: 'Loads a video file',
        inputs: [],
        outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        params: [{
          key: 'file_path',
          label: 'Path',
          ty: 'String',
          default: { String: '' },
          ui_hint: { type: 'FilePicker' },
          promotable: false,
        }],
      },
      {
        id: 'load_image_batch',
        display_name: 'Load Image Batch',
        category: 'Input',
        description: 'Loads an image batch',
        inputs: [],
        outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
        params: [{
          key: 'files',
          label: 'Files',
          ty: 'String',
          default: { String: '' },
          ui_hint: { type: 'FilePicker' },
          promotable: false,
        }],
      },
    ];
    const result = parseGraph([
      `load1 = LoadImage(path: image("${imageUri}"))`,
      `seq1 = LoadImageSequence(directory: sequence("${sequenceUri}"))`,
      `clip1 = LoadVideo(file_path: video("${videoUri}"))`,
      `batch1 = LoadImageBatch(files: images(["${imageUri}", "${sequenceUri}"]))`,
    ].join('\n'), specs);

    expect(result.errors).toHaveLength(0);
    expect(result.ast?.nodes.get('load1')?.params.get('path')).toEqual({ type: 'string', value: imageUri });
    expect(result.ast?.nodes.get('seq1')?.params.get('directory')).toEqual({ type: 'string', value: sequenceUri });
    expect(result.ast?.nodes.get('clip1')?.params.get('file_path')).toEqual({ type: 'string', value: videoUri });
    expect(result.ast?.nodes.get('batch1')?.params.get('files')).toEqual({
      type: 'string',
      value: `images(["${imageUri}", "${sequenceUri}"])`,
    });
  });

  it('parses single node with float param', () => {
    const result = parseGraph('blur1 = GaussianBlur(amount: 5.0)', mockSpecs);
    const node = result.ast?.nodes.get('blur1');
    expect(node?.params.get('amount')).toEqual({ type: 'float', value: 5 });
  });

  it('parses multiple params', () => {
    const result = parseGraph('grade1 = GaussianBlur(amount: 0.5, radius: 2.0)', mockSpecs);
    const node = result.ast?.nodes.get('grade1');
    expect(node?.params.get('amount')).toEqual({ type: 'float', value: 0.5 });
    expect(node?.params.get('radius')).toEqual({ type: 'float', value: 2.0 });
  });

  it('parses string params', () => {
    const result = parseGraph('load1 = LoadImage(path: "/img/photo.jpg")', mockSpecs);
    const node = result.ast?.nodes.get('load1');
    expect(node?.params.get('path')).toEqual({ type: 'string', value: '/img/photo.jpg' });
  });

  it('parses load image batch directory params', () => {
    const result = parseGraph('batch1 = LoadImageBatch(directory: "/Users/test/Pictures/batch")', mockSpecs);
    const node = result.ast?.nodes.get('batch1');
    expect(result.errors).toHaveLength(0);
    expect(node?.params.get('directory')).toEqual({ type: 'string', value: '/Users/test/Pictures/batch' });
  });

  it('parses bool params', () => {
    const result = parseGraph('thresh1 = Threshold(invert: true)', mockSpecs);
    const node = result.ast?.nodes.get('thresh1');
    expect(node?.params.get('invert')).toEqual({ type: 'bool', value: true });
  });

  it('parses color params', () => {
    const result = parseGraph('solid1 = SolidColor(color: rgba(1.0, 0.0, 0.0, 1.0))', mockSpecs);
    const node = result.ast?.nodes.get('solid1');
    expect(node?.params.get('color')).toEqual({ type: 'color', value: [1, 0, 0, 1] });
  });

  it('parses palette param', () => {
    const input =
      'pal1 = ColorPalette(colors: [rgba(1.0, 0.0, 0.0, 1.0), rgba(0.0, 1.0, 0.0, 1.0)])';
    const result = parseGraph(input, mockSpecs);
    const node = result.ast?.nodes.get('pal1');
    expect(node?.params.get('colors')).toEqual({ type: 'palette', value: [[1, 0, 0, 1], [0, 1, 0, 1]] });
  });

  it('parses ramp param', () => {
    const input =
      'ramp1 = ColorRamp(stops: [0.0: rgba(0.0, 0.0, 0.0, 1.0), 1.0: rgba(1.0, 1.0, 1.0, 1.0)])';
    const result = parseGraph(input, mockSpecs);
    const node = result.ast?.nodes.get('ramp1');
    expect(node?.params.get('stops')).toEqual({
      type: 'ramp',
      value: [
        { position: 0, color: [0, 0, 0, 1] },
        { position: 1, color: [1, 1, 1, 1] },
      ],
    });
  });

  it('parses curve param', () => {
    const input = 'curves1 = Curves(master_curve: [(0.0, 0.0), (0.5, 0.7), (1.0, 1.0)])';
    const result = parseGraph(input, mockSpecs);
    const node = result.ast?.nodes.get('curves1');
    expect(node?.params.get('master_curve')).toEqual({
      type: 'curve',
      value: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.7 },
        { x: 1, y: 1 },
      ],
    });
  });

  it('parses empty palette', () => {
    const result = parseGraph('pal1 = ColorPalette(colors: [])', mockSpecs);
    const node = result.ast?.nodes.get('pal1');
    expect(node?.params.get('colors')).toEqual({ type: 'palette', value: [] });
  });

  it('parses empty ramp', () => {
    const result = parseGraph('ramp1 = ColorRamp(stops: [])', mockSpecs);
    const node = result.ast?.nodes.get('ramp1');
    expect(node?.params.get('stops')).toEqual({ type: 'ramp', value: [] });
  });

  it('parses empty curve', () => {
    const result = parseGraph('curves1 = Curves(master_curve: [])', mockSpecs);
    const node = result.ast?.nodes.get('curves1');
    expect(node?.params.get('master_curve')).toEqual({ type: 'curve', value: [] });
  });

  it('parses connections', () => {
    const input = ['blur1 = GaussianBlur()', 'load1 = LoadImage()', 'load1.image -> blur1.image'].join('\n');
    const result = parseGraph(input, mockSpecs);
    expect(result.errors).toHaveLength(0);
    expect(result.ast?.connections).toEqual([
      { fromHandle: 'load1', fromPort: 'image', toHandle: 'blur1', toPort: 'image', line: 4 },
    ]);
  });

  it('parses multiple connections', () => {
    const input = [
      'blend1 = Blend()',
      'load1 = LoadImage()',
      'solid1 = SolidColor()',
      'load1.image -> blend1.base',
      'solid1.image -> blend1.overlay',
    ].join('\n');
    const result = parseGraph(input, mockSpecs);
    expect(result.errors).toHaveLength(0);
    expect(result.ast?.connections).toHaveLength(2);
    expect(result.ast?.connections[0]).toMatchObject({ toHandle: 'blend1', toPort: 'base' });
    expect(result.ast?.connections[1]).toMatchObject({ toHandle: 'blend1', toPort: 'overlay' });
  });

  it('ignores comment lines', () => {
    const input = ['# comment', 'viewer1 = Viewer()'].join('\n');
    const result = parseGraph(input, mockSpecs);
    expect(result.errors).toHaveLength(0);
    expect(result.ast?.nodes.size).toBe(1);
  });

  it('strips inline comments', () => {
    const input = 'blur1 = GaussianBlur(amount: 5.0) # fast blur';
    const result = parseGraph(input, mockSpecs);
    const node = result.ast?.nodes.get('blur1');
    expect(node?.params.get('amount')).toEqual({ type: 'float', value: 5 });
  });

  it('captures comments and blank lines as source-map trivia', () => {
    const result = parseDsl([
      '# file comment',
      'graph {',
      '',
      '  # node comment',
      '  blur1 = GaussianBlur(amount: 5.0) # inline node comment',
      '  viewer1 = Viewer()',
      '  blur1.image -> viewer1.image # inline connection comment',
      '}',
    ].join('\n'), mockSpecs);

    expect(result.errors).toHaveLength(0);
    expect(result.sourceMap?.trivia).toEqual([
      expect.objectContaining({ kind: 'comment', text: '# file comment', inline: false }),
      expect.objectContaining({ kind: 'blank', span: expect.objectContaining({ startLine: 3 }), inline: false }),
      expect.objectContaining({ kind: 'comment', text: '# node comment', inline: false }),
      expect.objectContaining({
        kind: 'comment',
        text: '# inline node comment',
        inline: true,
        targetKind: 'node',
        targetKey: 'blur1',
      }),
      expect.objectContaining({
        kind: 'comment',
        text: '# inline connection comment',
        inline: true,
        targetKind: 'connection',
        targetKey: 'blur1.image->viewer1.image',
      }),
    ]);
  });

  it('rejects legacy muted annotation', () => {
    const input = '@muted blur1 = GaussianBlur(amount: 5.0)';
    const result = parseGraph(input, mockSpecs);
    expect(result.errors.some((error) => error.message.includes('Unrecognized'))).toBe(true);
  });

  it('parses functional muted wrapper', () => {
    const input = 'blur1 = muted(GaussianBlur(amount: 5.0))';
    const result = parseGraph(input, mockSpecs);
    const node = result.ast?.nodes.get('blur1');
    expect(result.errors).toHaveLength(0);
    expect(node?.muted).toBe(true);
    expect(node?.params.get('amount')).toEqual({ type: 'float', value: 5 });
  });

  it('parses arrow connections left-to-right', () => {
    const input = ['load1 = LoadImage()', 'blur1 = GaussianBlur()', 'load1.image -> blur1.image'].join('\n');
    const result = parseGraph(input, mockSpecs);
    expect(result.errors).toHaveLength(0);
    expect(result.ast?.connections).toEqual([
      { fromHandle: 'load1', fromPort: 'image', toHandle: 'blur1', toPort: 'image', line: 4 },
    ]);
  });

  it('errors on duplicate handle', () => {
    const input = ['viewer1 = Viewer()', 'viewer1 = Viewer()'].join('\n');
    const result = parseGraph(input, mockSpecs);
    expect(result.errors.some((error) => error.message.includes('Duplicate handle'))).toBe(true);
  });

  it('errors on duplicate custom node definitions', () => {
    const result = parseDsl([
      'node FilmGlow = gpu {',
      '  inputs { image image }',
      '  outputs { image image }',
      '  code """',
      '  return color;',
      '  """',
      '}',
      '',
      'node FilmGlow = gpu {',
      '  inputs { image image }',
      '  outputs { image image }',
      '  code """',
      '  return color;',
      '  """',
      '}',
      '',
      'graph {',
      '  glow1 = FilmGlow()',
      '}',
    ].join('\n'), mockSpecs);

    expect(result.errors.some((error) => error.message.includes("Duplicate custom node 'FilmGlow'"))).toBe(true);
  });

  it('errors on unknown node type with type name', () => {
    const result = parseGraph('foo1 = NotARealNode()', mockSpecs);
    expect(result.errors.some((error) => error.message.includes("Unknown node type 'NotARealNode'"))).toBe(true);
  });

  it('errors on unknown param with suggestion of valid params', () => {
    const result = parseGraph('blur1 = GaussianBlur(unknown: 5.0)', mockSpecs);
    expect(result.errors.some((error) => error.message.includes("Unknown param 'unknown'"))).toBe(true);
  });

  it('errors on invalid param value', () => {
    const result = parseGraph('blur1 = GaussianBlur(amount: abc)', mockSpecs);
    expect(result.errors.some((error) => error.message.includes("Invalid value for 'amount'"))).toBe(true);
  });

  it('errors on invalid palette syntax', () => {
    const result = parseGraph('pal1 = ColorPalette(colors: [notacolor])', mockSpecs);
    expect(result.errors.some((error) => error.message.includes("Invalid value for 'colors'"))).toBe(true);
  });

  it('errors on invalid ramp syntax', () => {
    const result = parseGraph('ramp1 = ColorRamp(stops: [bad: stuff])', mockSpecs);
    expect(result.errors.some((error) => error.message.includes("Invalid value for 'stops'"))).toBe(true);
  });

  it('errors on invalid curve syntax', () => {
    const result = parseGraph('curves1 = Curves(master_curve: [notapoint])', mockSpecs);
    expect(result.errors.some((error) => error.message.includes("Invalid value for 'master_curve'"))).toBe(true);
  });

  it('errors on unrecognized lines with line number', () => {
    const result = parseGraph(['viewer1 = Viewer()', 'not a dsl line'].join('\n'), mockSpecs);
    expect(result.errors.some((error) => error.line === 3 && error.message.includes('Unrecognized'))).toBe(true);
  });

  it('reports an unclosed graph block with a useful live-edit diagnostic', () => {
    const result = parseDsl(['graph {', '  viewer1 = Viewer()'].join('\n'), mockSpecs);
    expect(result.errors.some((error) => error.message.includes("Expected closing '}'"))).toBe(true);
  });

  it('reports an unclosed node call with a useful live-edit diagnostic', () => {
    const result = parseDsl(['graph {', '  viewer1 = Viewer(', '}'].join('\n'), mockSpecs);
    expect(result.errors.some((error) => error.message.includes("Expected closing ')'"))).toBe(true);
  });

  it('reports malformed params as param syntax errors', () => {
    const result = parseGraph('blur1 = GaussianBlur(amount 5.0)', mockSpecs);
    expect(result.errors.some((error) => error.message.includes('Invalid param syntax'))).toBe(true);
  });

  it('keeps partial invalid documents non-fatal while reporting diagnostics', () => {
    const result = parseDsl([
      'node FilmGlow = gpu {',
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
      '  glow1 = FilmGlow(',
      '}',
    ].join('\n'), mockSpecs);

    expect(result.ast?.customNodes?.get('FilmGlow')?.kind).toBe('gpu');
    expect(result.errors.some((error) => error.message.includes('Expected code'))).toBe(true);
    expect(result.errors.some((error) => error.message.includes("Expected closing ')'"))).toBe(true);
  });

  it('handles blank lines and mixed whitespace', () => {
    const input = ['  ', 'blur1 = GaussianBlur( amount: 5.0 )', '', 'viewer1 = Viewer()  '].join('\n');
    const result = parseGraph(input, mockSpecs);
    expect(result.errors).toHaveLength(0);
    expect(result.ast?.nodes.size).toBe(2);
  });

  it('parses int params', () => {
    const result = parseGraph('solid1 = SolidColor(width: 1024)', mockSpecs);
    const node = result.ast?.nodes.get('solid1');
    expect(node?.params.get('width')).toEqual({ type: 'int', value: 1024 });
  });

  it('parses dropdown params as snake_case strings with resolved index', () => {
    const result = parseGraph('blend1 = Blend(mode: "multiply")', mockSpecs);
    const node = result.ast?.nodes.get('blend1');
    expect(node?.params.get('mode')).toEqual({ type: 'dropdown', value: 'multiply', index: 1 });
  });

  it('parses dropdown with exact label match (case-insensitive)', () => {
    const result = parseGraph('blend1 = Blend(mode: "Overlay")', mockSpecs);
    const node = result.ast?.nodes.get('blend1');
    expect(node?.params.get('mode')).toEqual({ type: 'dropdown', value: 'overlay', index: 3 });
  });

  it('parses dropdown with legacy integer index', () => {
    const result = parseGraph('blend1 = Blend(mode: 2)', mockSpecs);
    const node = result.ast?.nodes.get('blend1');
    expect(node?.params.get('mode')).toEqual({ type: 'dropdown', value: 'screen', index: 2 });
  });

  it('parses multi-word dropdown option as snake_case', () => {
    const result = parseGraph('grad1 = Gradient(direction: "radial")', mockSpecs);
    const node = result.ast?.nodes.get('grad1');
    expect(node?.params.get('direction')).toEqual({ type: 'dropdown', value: 'radial', index: 2 });
  });

  it('errors on invalid dropdown value', () => {
    const result = parseGraph('blend1 = Blend(mode: "invalid_mode")', mockSpecs);
    expect(result.errors.some((e) => e.message.includes("Invalid value for 'mode'"))).toBe(true);
  });

  it('parses gpu script source as a multiline string for existing nodes', () => {
    const manifest = buildDefaultGpuScriptManifest('gpu_script::demo');
    const specs = [...mockSpecs, buildGpuScriptNodeSpec(manifest)];
    const nodes = new Map([
      ['node-1', {
        id: 'node-1',
        typeId: 'gpu_script::demo',
        params: {},
        inputDefaults: {},
        position: { x: 0, y: 0 },
        muted: false,
      }],
    ]);
    const handleMap = new HandleMap();
    handleMap.set('gpu1', 'node-1');

    const result = parseGraph(
      'gpu1 = GpuScript(script: """\nfloat gain = 1.2;\nreturn vec4(color.rgb * gain, color.a);\n""")',
      specs,
      { currentNodes: nodes, handleMap },
    );

    expect(result.errors).toHaveLength(0);
    const node = result.ast?.nodes.get('gpu1');
    expect(node?.nodeTypeId).toBe('gpu_script::demo');
    expect(node?.params.get('script')).toEqual({
      type: 'string',
      value: 'float gain = 1.2;\nreturn vec4(color.rgb * gain, color.a);',
    });
  });
});

describe('splitTopLevelParams', () => {
  it('splits simple params', () => {
    expect(splitTopLevelParams('a: 1, b: 2')).toEqual(['a: 1', 'b: 2']);
  });

  it('splits params with nested parens', () => {
    expect(splitTopLevelParams('color: rgba(1.0, 0.0, 0.0, 1.0), sigma: 5.0')).toEqual([
      'color: rgba(1.0, 0.0, 0.0, 1.0)',
      'sigma: 5.0',
    ]);
  });

  it('does not split commas inside strings', () => {
    expect(splitTopLevelParams('path: "a,b.jpg"')).toEqual(['path: "a,b.jpg"']);
  });

  it('does not split commas inside multiline strings', () => {
    expect(splitTopLevelParams('script: """\nvec3 c = vec3(1.0, 0.0, 0.0);\nreturn vec4(c, color.a);\n"""')).toEqual([
      'script: """\nvec3 c = vec3(1.0, 0.0, 0.0);\nreturn vec4(c, color.a);\n"""',
    ]);
  });
});
