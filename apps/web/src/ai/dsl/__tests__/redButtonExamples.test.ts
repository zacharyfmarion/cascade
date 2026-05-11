import { describe, expect, it } from 'vitest';
import { parseDsl } from '../parser';
import { validateAst } from '../validator';
import { mockSpecs } from './helpers';

const imageA = 'asset://sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const imageB = 'asset://sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const imageC = 'asset://sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const logo = 'asset://sha256/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

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

  it('validates the watermark root graph with math-driven param connections', () => {
    const ast = parseAndValidate([
      'graph {',
      `  background = LoadImage(path: image("${imageA}"))`,
      `  logo = LoadImage(path: image("${logo}"))`,
      '  background_info = ImageInfo()',
      '  logo_target_width = Math(operation: "multiply", b: 0.16)',
      '  logo_resize = Resize(mode: "fit_within", height: 8192, allow_upscale: true)',
      '  logo_info = ImageInfo()',
      '  x_without_margin = Math(operation: "subtract")',
      '  x = Math(operation: "subtract", b: 48.0)',
      '  y_without_margin = Math(operation: "subtract")',
      '  y = Math(operation: "subtract", b: 48.0)',
      '  logo_position = Translate()',
      '  over = AlphaOver(opacity: 0.82)',
      '  view = Viewer()',
      '  export = ExportImage(output_path: "watermarked.png")',
      '',
      '  background.image -> background_info.image',
      '  background_info.width -> logo_target_width.a',
      '  logo.image -> logo_resize.image',
      '  logo_target_width.value -> logo_resize.width',
      '  logo_resize.image -> logo_info.image',
      '  background_info.width -> x_without_margin.a',
      '  logo_info.width -> x_without_margin.b',
      '  x_without_margin.value -> x.a',
      '  background_info.height -> y_without_margin.a',
      '  logo_info.height -> y_without_margin.b',
      '  y_without_margin.value -> y.a',
      '  logo_resize.image -> logo_position.image',
      '  x.value -> logo_position.x',
      '  y.value -> logo_position.y',
      '  background.image -> over.background',
      '  logo_position.image -> over.foreground',
      '  over.image -> view.value',
      '  over.image -> export.image',
      '}',
    ].join('\n'));

    expect(ast.nodes.get('over')?.nodeTypeId).toBe('gpu_kernel::alpha_over');
    expect(ast.connections).toContainEqual(expect.objectContaining({
      fromHandle: 'logo_target_width',
      fromPort: 'value',
      toHandle: 'logo_resize',
      toPort: 'width',
    }));
    expect(ast.connections).toContainEqual(expect.objectContaining({
      fromHandle: 'x',
      fromPort: 'value',
      toHandle: 'logo_position',
      toPort: 'x',
    }));
  });

  it('validates the social variant graph with multiple ExportImage nodes', () => {
    const ast = parseAndValidate([
      'graph {',
      `  source = LoadImage(path: image("${imageB}"))`,
      '  square_crop = Crop(width: 1080, height: 1080)',
      '  square = Resize(width: 1080, height: 1080)',
      '  portrait_crop = Crop(x: 240, width: 960, height: 1200)',
      '  portrait = Resize(width: 1080, height: 1350)',
      '  landscape_crop = Crop(width: 1600, height: 900)',
      '  landscape = Resize(width: 1200, height: 675)',
      '  view = Viewer()',
      '  square_export = ExportImage(output_path: "square.png")',
      '  portrait_export = ExportImage(output_path: "portrait.png")',
      '  landscape_export = ExportImage(output_path: "landscape.png")',
      '',
      '  source.image -> square_crop.image',
      '  square_crop.image -> square.image',
      '  square.image -> view.value',
      '  square.image -> square_export.image',
      '  source.image -> portrait_crop.image',
      '  portrait_crop.image -> portrait.image',
      '  portrait.image -> portrait_export.image',
      '  source.image -> landscape_crop.image',
      '  landscape_crop.image -> landscape.image',
      '  landscape.image -> landscape_export.image',
      '}',
    ].join('\n'));

    const exportNodes = Array.from(ast.nodes.values()).filter(node => node.nodeTypeId === 'export_image');
    expect(exportNodes).toHaveLength(3);
  });
});
