/**
 * Integration tests: full DSL graphs that exercise parse → validate → diff pipeline.
 * These test realistic AI-generated DSL strings end-to-end.
 */
import { describe, it, expect } from 'vitest';
import { parseDsl } from '../parser';
import { validateAst } from '../validator';
import { diffAst } from '../differ';
import { mockSpecs } from './helpers';

const graph = (body: string): string =>
  `graph {\n${body.split('\n').map((line) => (line ? `  ${line}` : '')).join('\n')}\n}`;

/**
 * Helper: parse + validate a DSL string, assert zero errors.
 * Returns the AST for further assertions.
 */
function parseAndValidate(dsl: string) {
  const parseResult = parseDsl(graph(dsl), mockSpecs);
  expect(parseResult.errors, `Parse errors: ${JSON.stringify(parseResult.errors)}`).toHaveLength(0);
  expect(parseResult.ast).not.toBeNull();

  const validation = validateAst(parseResult.ast!, mockSpecs);
  expect(validation.errors, `Validation errors: ${JSON.stringify(validation.errors)}`).toHaveLength(0);

  return parseResult.ast!;
}

/**
 * Helper: parse + validate, expect specific errors.
 */
function expectErrors(dsl: string, expectedCount?: number) {
  const parseResult = parseDsl(graph(dsl), mockSpecs);
  if (parseResult.errors.length > 0) {
    return { errors: parseResult.errors, source: 'parse' as const };
  }
  const validation = validateAst(parseResult.ast!, mockSpecs);
  if (expectedCount !== undefined) {
    expect(validation.errors).toHaveLength(expectedCount);
  } else {
    expect(validation.errors.length).toBeGreaterThan(0);
  }
  return { errors: validation.errors, source: 'validate' as const };
}

describe('integration: full graph DSL end-to-end', () => {
  describe('realistic AI-generated graphs', () => {
    it('AI generates sunset image, pixelates, and applies 8-color warm palette', () => {
      const dsl = [
        '# Generate a sunset, pixelate it, limit to 8 warm colors',
        'gen1 = AiGenerateImage(prompt: "A beautiful sunset over the ocean")',
        'pixelate1 = GpuKernel::Pixelate(pixel_size: 16)',
        'palette1 = ColorPalette(colors: [rgba(1.0, 0.18, 0.02, 1.0), rgba(1.0, 0.42, 0.02, 1.0), rgba(1.0, 0.62, 0.05, 1.0), rgba(1.0, 0.82, 0.18, 1.0), rgba(0.72, 0.08, 0.18, 1.0), rgba(0.42, 0.04, 0.28, 1.0), rgba(0.18, 0.02, 0.22, 1.0), rgba(0.95, 0.30, 0.08, 1.0)])',
        'viewer1 = Viewer()',
        '',
        'gen1.image -> pixelate1.image',
        'pixelate1.image -> viewer1.image',
      ].join('\n');

      const ast = parseAndValidate(dsl);
      expect(ast.nodes.size).toBe(4);
      expect(ast.connections).toHaveLength(2);

      // Verify the palette has 8 colors
      const palette = ast.nodes.get('palette1');
      expect(palette).toBeDefined();
      const colors = palette!.params.get('colors');
      expect(colors?.type).toBe('palette');
      if (colors?.type === 'palette') {
        expect(colors.value).toHaveLength(8);
        // Verify first color
        expect(colors.value[0]).toEqual([1.0, 0.18, 0.02, 1.0]);
      }
    });

    it('load image → blur → brightness/contrast → viewer', () => {
      const dsl = [
        'load1 = LoadImage(path: "/photos/sunset.jpg")',
        'blur1 = GaussianBlur(amount: 3.5)',
        'posterize1 = Posterize(levels: 8)',
        'viewer1 = Viewer()',
        '',
        'load1.image -> blur1.image',
        'blur1.image -> posterize1.image',
        'posterize1.image -> viewer1.image',
      ].join('\n');

      const ast = parseAndValidate(dsl);
      expect(ast.nodes.size).toBe(4);
      expect(ast.connections).toHaveLength(3);
    });

    it('blend two images with multiply mode and dropdown param', () => {
      const dsl = [
        'load1 = LoadImage(path: "/bg.jpg")',
        'load2 = LoadImage(path: "/fg.png")',
        'blend1 = Blend(mode: "multiply", opacity: 0.75)',
        'viewer1 = Viewer()',
        '',
        'load1.image -> blend1.base',
        'load2.image -> blend1.overlay',
        'blend1.image -> viewer1.image',
      ].join('\n');

      const ast = parseAndValidate(dsl);
      expect(ast.nodes.get('blend1')?.params.get('mode')).toEqual({ type: 'dropdown', value: 'multiply', index: 1 });
      expect(ast.nodes.get('blend1')?.params.get('opacity')).toEqual({ type: 'float', value: 0.75 });
    });

    it('color ramp with 3 stops', () => {
      const dsl = [
        'load1 = LoadImage(path: "/photo.jpg")',
        'ramp1 = ColorRamp(stops: [0.0: rgba(0.0, 0.0, 0.2, 1.0), 0.5: rgba(1.0, 0.5, 0.0, 1.0), 1.0: rgba(1.0, 1.0, 0.8, 1.0)])',
        'viewer1 = Viewer()',
        '',
        'load1.image -> ramp1.image',
        'ramp1.image -> viewer1.image',
      ].join('\n');

      const ast = parseAndValidate(dsl);
      const stops = ast.nodes.get('ramp1')?.params.get('stops');
      expect(stops?.type).toBe('ramp');
      if (stops?.type === 'ramp') {
        expect(stops.value).toHaveLength(3);
        expect(stops.value[1]).toEqual({ position: 0.5, color: [1.0, 0.5, 0.0, 1.0] });
      }
    });

    it('curves adjustment with 4 control points', () => {
      const dsl = [
        'load1 = LoadImage(path: "/photo.jpg")',
        'curves1 = Curves(master_curve: [(0.0, 0.0), (0.25, 0.15), (0.75, 0.9), (1.0, 1.0)])',
        'viewer1 = Viewer()',
        '',
        'load1.image -> curves1.image',
        'curves1.image -> viewer1.image',
      ].join('\n');

      const ast = parseAndValidate(dsl);
      const curve = ast.nodes.get('curves1')?.params.get('master_curve');
      expect(curve?.type).toBe('curve');
      if (curve?.type === 'curve') {
        expect(curve.value).toHaveLength(4);
        expect(curve.value[2]).toEqual({ x: 0.75, y: 0.9 });
      }
    });

    it('muted nodes in a pipeline', () => {
      const dsl = [
        'load1 = LoadImage(path: "/photo.jpg")',
        'blur1 = muted(GaussianBlur(amount: 5.0))',
        'viewer1 = Viewer()',
        '',
        'load1.image -> blur1.image',
        'blur1.image -> viewer1.image',
      ].join('\n');

      const ast = parseAndValidate(dsl);
      expect(ast.nodes.get('blur1')?.muted).toBe(true);
      expect(ast.nodes.get('load1')?.muted).toBe(false);
    });

    it('namespaced GPU kernel node with params', () => {
      const dsl = [
        'load1 = LoadImage(path: "/photo.jpg")',
        'pixelate1 = GpuKernel::Pixelate(pixel_size: 32)',
        'viewer1 = Viewer()',
        '',
        'load1.image -> pixelate1.image',
        'pixelate1.image -> viewer1.image',
      ].join('\n');

      const ast = parseAndValidate(dsl);
      expect(ast.nodes.get('pixelate1')?.nodeTypeId).toBe('gpu_kernel::pixelate');
      expect(ast.nodes.get('pixelate1')?.params.get('pixel_size')).toEqual({ type: 'int', value: 32 });
    });

    it('complex multi-branch graph with blend', () => {
      const dsl = [
        'load1 = LoadImage(path: "/bg.jpg")',
        'solid1 = SolidColor(color: rgba(1.0, 0.0, 0.0, 0.5), width: 1024, height: 768)',
        'blur1 = GaussianBlur(amount: 4.0)',
        'blend1 = Blend(mode: "screen", opacity: 0.5)',
        'posterize1 = Posterize(levels: 4)',
        'viewer1 = Viewer()',
        '',
        'load1.image -> blur1.image',
        'blur1.image -> blend1.base',
        'solid1.image -> blend1.overlay',
        'blend1.image -> posterize1.image',
        'posterize1.image -> viewer1.image',
      ].join('\n');

      const ast = parseAndValidate(dsl);
      expect(ast.nodes.size).toBe(6);
      expect(ast.connections).toHaveLength(5);
    });
  });

  describe('diff produces correct mutations from DSL edits', () => {
    it('adding a palette node to existing graph produces addNode mutation', () => {
      const before = [
        'load1 = LoadImage(path: "/photo.jpg")',
        'viewer1 = Viewer()',
        '',
        'load1.image -> viewer1.image',
      ].join('\n');

      const after = [
        'load1 = LoadImage(path: "/photo.jpg")',
        'palette1 = ColorPalette(colors: [rgba(1.0, 0.0, 0.0, 1.0), rgba(0.0, 1.0, 0.0, 1.0), rgba(0.0, 0.0, 1.0, 1.0)])',
        'viewer1 = Viewer()',
        '',
        'load1.image -> viewer1.image',
      ].join('\n');

      const beforeAst = parseAndValidate(before);
      const afterAst = parseAndValidate(after);

      const mutations = diffAst(beforeAst, afterAst);
      expect(mutations.some(m => m.type === 'addNode' && m.handle === 'palette1')).toBe(true);
    });

    it('changing palette colors produces setParam mutation', () => {
      const before = [
        'palette1 = ColorPalette(colors: [rgba(1.0, 0.0, 0.0, 1.0), rgba(0.0, 1.0, 0.0, 1.0)])',
        'viewer1 = Viewer()',
      ].join('\n');

      const after = [
        'palette1 = ColorPalette(colors: [rgba(0.5, 0.5, 0.5, 1.0), rgba(0.8, 0.2, 0.1, 1.0), rgba(0.1, 0.3, 0.9, 1.0)])',
        'viewer1 = Viewer()',
      ].join('\n');

      const beforeAst = parseAndValidate(before);
      const afterAst = parseAndValidate(after);

      const mutations = diffAst(beforeAst, afterAst);
      const setParam = mutations.find(m => m.type === 'setParam' && m.handle === 'palette1');
      expect(setParam).toBeDefined();
      if (setParam?.type === 'setParam') {
        expect(setParam.paramKey).toBe('colors');
        expect(setParam.value.type).toBe('palette');
      }
    });

    it('changing dropdown param produces setParam mutation', () => {
      const before = 'blend1 = Blend(mode: "normal")';
      const after = 'blend1 = Blend(mode: "overlay")';
      const beforeAst = parseAndValidate(before);
      const afterAst = parseAndValidate(after);

      const mutations = diffAst(beforeAst, afterAst);
      const setParam = mutations.find(m => m.type === 'setParam' && m.paramKey === 'mode');
      expect(setParam).toBeDefined();
      if (setParam?.type === 'setParam') {
        expect(setParam.value).toEqual({ type: 'dropdown', value: 'overlay', index: 3 });
      }
    });
  });

  describe('error cases the AI might produce', () => {
    it('rejects invalid color in palette (not rgba)', () => {
      const dsl = 'pal1 = ColorPalette(colors: [red, green, blue])';
      const result = expectErrors(dsl);
      expect(result.errors[0].message).toContain('colors');
    });

    it('rejects wrong param type on ColorPalette (number instead of palette array)', () => {
      const dsl = 'pal1 = ColorPalette(colors: 42)';
      const result = expectErrors(dsl);
      expect(result.errors[0].message).toContain('colors');
    });

    // Cycle detection is handled by Rust via validate_edits() (see semanticValidator.ts).

    it('rejects unknown node type with helpful suggestion', () => {
      // Parser catches unknown types, so validation suggestion comes from there
      const dsl = 'blur1 = GausianBlur(amount: 5.0)';
      const parseResult = parseDsl(graph(dsl), mockSpecs);
      // Parser reports unknown type; validator also catches it if AST is produced
      if (parseResult.errors.length > 0) {
        expect(parseResult.errors[0].message).toContain('Unknown node type');
      } else {
        const validation = validateAst(parseResult.ast!, mockSpecs);
        expect(validation.errors[0].message).toContain('Did you mean "GaussianBlur"');
      }
    });

    it('rejects duplicate input connections', () => {
      const dsl = [
        'load1 = LoadImage()',
        'load2 = LoadImage()',
        'viewer1 = Viewer()',
        '',
        'load1.image -> viewer1.image',
        'load2.image -> viewer1.image',
      ].join('\n');

      const parseResult = parseDsl(graph(dsl), mockSpecs);
      expect(parseResult.errors).toHaveLength(0);
      const validation = validateAst(parseResult.ast!, mockSpecs);
      expect(validation.errors.some(e => e.message.includes('already connected'))).toBe(true);
    });
  });

  describe('complex param type validation', () => {
    it('validates ColorPalette with 8 colors passes', () => {
      const dsl = 'pal1 = ColorPalette(colors: [rgba(1.0, 0.0, 0.0, 1.0), rgba(0.0, 1.0, 0.0, 1.0), rgba(0.0, 0.0, 1.0, 1.0), rgba(1.0, 1.0, 0.0, 1.0), rgba(1.0, 0.0, 1.0, 1.0), rgba(0.0, 1.0, 1.0, 1.0), rgba(0.5, 0.5, 0.5, 1.0), rgba(1.0, 0.5, 0.0, 1.0)])';
      parseAndValidate(dsl);
    });

    it('validates ColorRamp with multiple stops passes', () => {
      const dsl = 'ramp1 = ColorRamp(stops: [0.0: rgba(0.0, 0.0, 0.0, 1.0), 0.33: rgba(1.0, 0.0, 0.0, 1.0), 0.66: rgba(0.0, 1.0, 0.0, 1.0), 1.0: rgba(1.0, 1.0, 1.0, 1.0)])';
      parseAndValidate(dsl);
    });

    it('validates CurveEditor with multiple points passes', () => {
      const dsl = 'curves1 = Curves(master_curve: [(0.0, 0.0), (0.25, 0.15), (0.5, 0.5), (0.75, 0.85), (1.0, 1.0)])';
      parseAndValidate(dsl);
    });

    it('validates empty palette passes', () => {
      const dsl = 'pal1 = ColorPalette(colors: [])';
      parseAndValidate(dsl);
    });

    it('validates Dropdown with quoted snake_case string passes', () => {
      const dsl = 'blend1 = Blend(mode: "multiply")';
      parseAndValidate(dsl);
    });

    it('validates Dropdown with unquoted snake_case string passes', () => {
      const dsl = 'blend1 = Blend(mode: multiply)';
      parseAndValidate(dsl);
    });
  });
});
