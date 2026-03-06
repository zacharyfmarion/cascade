import { describe, it, expect } from 'vitest';
import { parseDsl, splitTopLevelParams } from '../parser';
import { mockSpecs } from './helpers';

describe('parseDsl', () => {
  it('parses empty input to empty ast', () => {
    const result = parseDsl('', mockSpecs);
    expect(result.errors).toHaveLength(0);
    expect(result.ast?.nodes.size).toBe(0);
    expect(result.ast?.connections).toHaveLength(0);
  });

  it('parses single node without params', () => {
    const result = parseDsl('viewer1 = Viewer()', mockSpecs);
    expect(result.errors).toHaveLength(0);
    const node = result.ast?.nodes.get('viewer1');
    expect(node?.nodeType).toBe('Viewer');
    expect(node?.nodeTypeId).toBe('viewer');
    expect(node?.params.size).toBe(0);
  });

  it('parses single node with float param', () => {
    const result = parseDsl('blur1 = GaussianBlur(amount: 5.0)', mockSpecs);
    const node = result.ast?.nodes.get('blur1');
    expect(node?.params.get('amount')).toEqual({ type: 'float', value: 5 });
  });

  it('parses multiple params', () => {
    const result = parseDsl('grade1 = GaussianBlur(amount: 0.5, radius: 2.0)', mockSpecs);
    const node = result.ast?.nodes.get('grade1');
    expect(node?.params.get('amount')).toEqual({ type: 'float', value: 0.5 });
    expect(node?.params.get('radius')).toEqual({ type: 'float', value: 2.0 });
  });

  it('parses string params', () => {
    const result = parseDsl('load1 = LoadImage(path: "/img/photo.jpg")', mockSpecs);
    const node = result.ast?.nodes.get('load1');
    expect(node?.params.get('path')).toEqual({ type: 'string', value: '/img/photo.jpg' });
  });

  it('parses bool params', () => {
    const result = parseDsl('thresh1 = Threshold(invert: true)', mockSpecs);
    const node = result.ast?.nodes.get('thresh1');
    expect(node?.params.get('invert')).toEqual({ type: 'bool', value: true });
  });

  it('parses color params', () => {
    const result = parseDsl('solid1 = SolidColor(color: rgba(1.0, 0.0, 0.0, 1.0))', mockSpecs);
    const node = result.ast?.nodes.get('solid1');
    expect(node?.params.get('color')).toEqual({ type: 'color', value: [1, 0, 0, 1] });
  });

  it('parses palette param', () => {
    const input =
      'pal1 = ColorPalette(colors: [rgba(1.0, 0.0, 0.0, 1.0), rgba(0.0, 1.0, 0.0, 1.0)])';
    const result = parseDsl(input, mockSpecs);
    const node = result.ast?.nodes.get('pal1');
    expect(node?.params.get('colors')).toEqual({ type: 'palette', value: [[1, 0, 0, 1], [0, 1, 0, 1]] });
  });

  it('parses ramp param', () => {
    const input =
      'ramp1 = ColorRamp(stops: [0.0: rgba(0.0, 0.0, 0.0, 1.0), 1.0: rgba(1.0, 1.0, 1.0, 1.0)])';
    const result = parseDsl(input, mockSpecs);
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
    const result = parseDsl(input, mockSpecs);
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
    const result = parseDsl('pal1 = ColorPalette(colors: [])', mockSpecs);
    const node = result.ast?.nodes.get('pal1');
    expect(node?.params.get('colors')).toEqual({ type: 'palette', value: [] });
  });

  it('parses empty ramp', () => {
    const result = parseDsl('ramp1 = ColorRamp(stops: [])', mockSpecs);
    const node = result.ast?.nodes.get('ramp1');
    expect(node?.params.get('stops')).toEqual({ type: 'ramp', value: [] });
  });

  it('parses empty curve', () => {
    const result = parseDsl('curves1 = Curves(master_curve: [])', mockSpecs);
    const node = result.ast?.nodes.get('curves1');
    expect(node?.params.get('master_curve')).toEqual({ type: 'curve', value: [] });
  });

  it('parses connections', () => {
    const input = ['blur1 = GaussianBlur()', 'load1 = LoadImage()', 'blur1.image <- load1.image'].join('\n');
    const result = parseDsl(input, mockSpecs);
    expect(result.errors).toHaveLength(0);
    expect(result.ast?.connections).toEqual([
      { fromHandle: 'load1', fromPort: 'image', toHandle: 'blur1', toPort: 'image', line: 3 },
    ]);
  });

  it('parses multiple connections', () => {
    const input = [
      'blend1 = Blend()',
      'load1 = LoadImage()',
      'solid1 = SolidColor()',
      'blend1.base <- load1.image',
      'blend1.overlay <- solid1.image',
    ].join('\n');
    const result = parseDsl(input, mockSpecs);
    expect(result.errors).toHaveLength(0);
    expect(result.ast?.connections).toHaveLength(2);
    expect(result.ast?.connections[0]).toMatchObject({ toHandle: 'blend1', toPort: 'base' });
    expect(result.ast?.connections[1]).toMatchObject({ toHandle: 'blend1', toPort: 'overlay' });
  });

  it('ignores comment lines', () => {
    const input = ['# comment', 'viewer1 = Viewer()'].join('\n');
    const result = parseDsl(input, mockSpecs);
    expect(result.errors).toHaveLength(0);
    expect(result.ast?.nodes.size).toBe(1);
  });

  it('strips inline comments', () => {
    const input = 'blur1 = GaussianBlur(amount: 5.0) # fast blur';
    const result = parseDsl(input, mockSpecs);
    const node = result.ast?.nodes.get('blur1');
    expect(node?.params.get('amount')).toEqual({ type: 'float', value: 5 });
  });

  it('parses muted nodes', () => {
    const input = '@muted blur1 = GaussianBlur(amount: 5.0)';
    const result = parseDsl(input, mockSpecs);
    const node = result.ast?.nodes.get('blur1');
    expect(node?.muted).toBe(true);
  });

  it('errors on duplicate handle', () => {
    const input = ['viewer1 = Viewer()', 'viewer1 = Viewer()'].join('\n');
    const result = parseDsl(input, mockSpecs);
    expect(result.errors.some((error) => error.message.includes('Duplicate handle'))).toBe(true);
  });

  it('errors on unknown node type with type name', () => {
    const result = parseDsl('foo1 = NotARealNode()', mockSpecs);
    expect(result.errors.some((error) => error.message.includes("Unknown node type 'NotARealNode'"))).toBe(true);
  });

  it('errors on unknown param with suggestion of valid params', () => {
    const result = parseDsl('blur1 = GaussianBlur(unknown: 5.0)', mockSpecs);
    expect(result.errors.some((error) => error.message.includes("Unknown param 'unknown'"))).toBe(true);
  });

  it('errors on invalid param value', () => {
    const result = parseDsl('blur1 = GaussianBlur(amount: abc)', mockSpecs);
    expect(result.errors.some((error) => error.message.includes("Invalid value for 'amount'"))).toBe(true);
  });

  it('errors on invalid palette syntax', () => {
    const result = parseDsl('pal1 = ColorPalette(colors: [notacolor])', mockSpecs);
    expect(result.errors.some((error) => error.message.includes("Invalid value for 'colors'"))).toBe(true);
  });

  it('errors on invalid ramp syntax', () => {
    const result = parseDsl('ramp1 = ColorRamp(stops: [bad: stuff])', mockSpecs);
    expect(result.errors.some((error) => error.message.includes("Invalid value for 'stops'"))).toBe(true);
  });

  it('errors on invalid curve syntax', () => {
    const result = parseDsl('curves1 = Curves(master_curve: [notapoint])', mockSpecs);
    expect(result.errors.some((error) => error.message.includes("Invalid value for 'master_curve'"))).toBe(true);
  });

  it('errors on unrecognized lines with line number', () => {
    const result = parseDsl(['viewer1 = Viewer()', 'not a dsl line'].join('\n'), mockSpecs);
    expect(result.errors.some((error) => error.line === 2 && error.message.includes('Unrecognized'))).toBe(true);
  });

  it('handles blank lines and mixed whitespace', () => {
    const input = ['  ', 'blur1 = GaussianBlur( amount: 5.0 )', '', 'viewer1 = Viewer()  '].join('\n');
    const result = parseDsl(input, mockSpecs);
    expect(result.errors).toHaveLength(0);
    expect(result.ast?.nodes.size).toBe(2);
  });

  it('parses int params', () => {
    const result = parseDsl('solid1 = SolidColor(width: 1024)', mockSpecs);
    const node = result.ast?.nodes.get('solid1');
    expect(node?.params.get('width')).toEqual({ type: 'int', value: 1024 });
  });

  it('parses dropdown params as snake_case strings with resolved index', () => {
    const result = parseDsl('blend1 = Blend(mode: "multiply")', mockSpecs);
    const node = result.ast?.nodes.get('blend1');
    expect(node?.params.get('mode')).toEqual({ type: 'dropdown', value: 'multiply', index: 1 });
  });

  it('parses dropdown with exact label match (case-insensitive)', () => {
    const result = parseDsl('blend1 = Blend(mode: "Overlay")', mockSpecs);
    const node = result.ast?.nodes.get('blend1');
    expect(node?.params.get('mode')).toEqual({ type: 'dropdown', value: 'overlay', index: 3 });
  });

  it('parses dropdown with legacy integer index', () => {
    const result = parseDsl('blend1 = Blend(mode: 2)', mockSpecs);
    const node = result.ast?.nodes.get('blend1');
    expect(node?.params.get('mode')).toEqual({ type: 'dropdown', value: 'screen', index: 2 });
  });

  it('parses multi-word dropdown option as snake_case', () => {
    const result = parseDsl('grad1 = Gradient(direction: "radial")', mockSpecs);
    const node = result.ast?.nodes.get('grad1');
    expect(node?.params.get('direction')).toEqual({ type: 'dropdown', value: 'radial', index: 2 });
  });

  it('errors on invalid dropdown value', () => {
    const result = parseDsl('blend1 = Blend(mode: "invalid_mode")', mockSpecs);
    expect(result.errors.some((e) => e.message.includes("Invalid value for 'mode'"))).toBe(true);
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
});
