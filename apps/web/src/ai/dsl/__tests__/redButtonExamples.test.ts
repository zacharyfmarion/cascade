import { describe, expect, it } from 'vitest';
import { parseDsl } from '../parser';
import { validateAst } from '../validator';
import { mockSpecs } from './helpers';

const imageA = 'asset://sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const imageB = 'asset://sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const imageC = 'asset://sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

const parseAndValidate = (source: string) => {
  const parsed = parseDsl(source, mockSpecs);
  expect(parsed.errors).toHaveLength(0);
  expect(parsed.ast).not.toBeNull();
  const validation = validateAst(parsed.ast!, mockSpecs);
  expect(validation.errors).toHaveLength(0);
  expect(validation.valid).toBe(true);
  return parsed.ast!;
};

describe('red button example DSL fixtures', () => {
  it('validates the batch resize/export root graph shape', () => {
    const ast = parseAndValidate([
      'graph {',
      `  batch = LoadImageBatch(files: images(["${imageA}", "${imageB}", "${imageC}"]))`,
      '  resize = Resize(mode: "fit_within", width: 1600, height: 1600)',
      '  export = ExportImageBatch(filename_template: "{name}_resized")',
      '',
      '  batch.image -> resize.image',
      '  resize.image -> export.image',
      '  batch.filename -> export.filename',
      '}',
    ].join('\n'));

    expect(ast.nodes.get('batch')?.nodeTypeId).toBe('load_image_batch');
    expect(ast.nodes.get('resize')?.params.get('mode')).toMatchObject({ type: 'dropdown', value: 'fit_within' });
    expect(ast.nodes.get('export')?.nodeTypeId).toBe('export_image_batch');
  });

  it('validates the watermark root graph with rasterized text overlay', () => {
    const ast = parseAndValidate([
      'graph {',
      `  background = LoadImage(path: image("${imageA}"))`,
      '  watermark = Text(text: "CASCADE", font_size: 96.0, width: 640, height: 160)',
      '  position = Translate(x: 48, y: 48)',
      '  over = AlphaOver(opacity: 0.15)',
      '  view = Viewer()',
      '  export = ExportImage(output_path: "watermarked.png")',
      '',
      '  watermark.image -> position.image',
      '  background.image -> over.background',
      '  position.image -> over.foreground',
      '  over.image -> view.value',
      '  over.image -> export.image',
      '}',
    ].join('\n'));

    expect(ast.nodes.get('over')?.nodeTypeId).toBe('gpu_kernel::alpha_over');
    expect(ast.nodes.get('watermark')?.nodeTypeId).toBe('text');
    expect(ast.nodes.get('over')?.params.get('opacity')).toEqual({
      type: 'float',
      value: 0.15,
    });
    expect(ast.connections).toContainEqual(expect.objectContaining({
      fromHandle: 'watermark',
      fromPort: 'image',
      toHandle: 'position',
      toPort: 'image',
    }));
  });

  it('validates the social variant graph with multiple ExportImage nodes', () => {
    const ast = parseAndValidate([
      'graph {',
      `  source = LoadImage(path: image("${imageB}"))`,
      '  square = Resize(mode: "cover", width: 1080, allow_upscale: true)',
      '  portrait = Resize(mode: "cover", width: 1080, height: 1350, allow_upscale: true)',
      '  landscape = Resize(mode: "cover", width: 1200, height: 675, allow_upscale: true)',
      '  view = Viewer()',
      '  square_export = ExportImage(output_path: "square.png")',
      '  portrait_export = ExportImage(output_path: "portrait.png")',
      '  landscape_export = ExportImage(output_path: "landscape.png")',
      '',
      '  source.image -> square.image',
      '  square.image -> view.value',
      '  square.image -> square_export.image',
      '  source.image -> portrait.image',
      '  portrait.image -> portrait_export.image',
      '  source.image -> landscape.image',
      '  landscape.image -> landscape_export.image',
      '}',
    ].join('\n'));

    const exportNodes = Array.from(ast.nodes.values()).filter(node => node.nodeTypeId === 'export_image');
    expect(exportNodes).toHaveLength(3);
    expect(Array.from(ast.nodes.values()).filter(node => node.nodeTypeId === 'crop')).toHaveLength(0);
    expect(ast.nodes.get('square')?.params.get('mode')).toMatchObject({ type: 'dropdown', value: 'cover' });
  });
});
