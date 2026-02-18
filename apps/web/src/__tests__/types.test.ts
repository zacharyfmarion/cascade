import { beforeEach, describe, expect, it } from 'vitest';
import { createParamValue, extractParamValue } from '../store/types';

beforeEach(() => {
  localStorage.clear();
});

describe('store types helpers', () => {
  it('extractParamValue with Float returns the number', () => {
    expect(extractParamValue({ Float: 1.5 })).toBe(1.5);
  });

  it('extractParamValue with Int returns the number', () => {
    expect(extractParamValue({ Int: 3 })).toBe(3);
  });

  it('extractParamValue with Bool returns the boolean', () => {
    expect(extractParamValue({ Bool: true })).toBe(true);
  });

  it('extractParamValue with Color returns the color array', () => {
    const color: [number, number, number, number] = [0.1, 0.2, 0.3, 1];
    expect(extractParamValue({ Color: color })).toEqual(color);
  });

  it('extractParamValue with ColorRamp returns the stops array', () => {
    const stops = [{ position: 0, color: [0, 0, 0, 1] as [number, number, number, number] }];
    expect(extractParamValue({ ColorRamp: stops })).toEqual(stops);
  });

  it('extractParamValue with String returns the string', () => {
    expect(extractParamValue({ String: 'hello' })).toBe('hello');
  });

  it('createParamValue with Float type wraps in Float', () => {
    expect(createParamValue('Float', 2.25)).toEqual({ Float: 2.25 });
  });

  it('createParamValue with Int type wraps in Int and rounds', () => {
    expect(createParamValue('Int', 2.7)).toEqual({ Int: 3 });
  });

  it('createParamValue with Bool type wraps in Bool', () => {
    expect(createParamValue('Bool', 1)).toEqual({ Bool: true });
  });

  it('createParamValue with Color type wraps in Color', () => {
    const color: [number, number, number, number] = [0.2, 0.4, 0.6, 1];
    expect(createParamValue('Color', color)).toEqual({ Color: color });
  });

  it('createParamValue with unknown type defaults to String', () => {
    expect(createParamValue('Unknown', 123)).toEqual({ String: '123' });
  });
});
