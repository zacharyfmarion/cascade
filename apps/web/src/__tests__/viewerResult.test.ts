import { describe, expect, it } from 'vitest';
import {
  collectViewerResultTransferables,
  decodeViewerResult,
} from '../engine/viewerResult';

describe('decodeViewerResult', () => {
  it('copies pixel buffers when requested', () => {
    const sourcePixels = new Uint8ClampedArray([1, 2, 3, 4]);

    const result = decodeViewerResult(
      { type: 'image', width: 1, height: 1, pixels: sourcePixels },
      'viewer-1',
      { copyPixels: true },
    );

    expect(result).not.toBeNull();
    expect(result?.type).toBe('image');
    expect('pixels' in (result ?? {})).toBe(true);
    if (!result || !('pixels' in result)) {
      throw new Error('expected pixel result');
    }
    expect(result.pixels).not.toBe(sourcePixels);
    expect(Array.from(result.pixels)).toEqual([1, 2, 3, 4]);
    expect(result.pixels.buffer).not.toBe(sourcePixels.buffer);
  });

  it('reuses Uint8ClampedArray buffers when copying is disabled', () => {
    const sourcePixels = new Uint8ClampedArray([5, 6, 7, 8]);

    const result = decodeViewerResult(
      { type: 'image', width: 1, height: 1, pixels: sourcePixels },
      'viewer-2',
    );

    expect(result).not.toBeNull();
    if (!result || !('pixels' in result)) {
      throw new Error('expected pixel result');
    }
    expect(result.pixels).toBe(sourcePixels);
  });

  it('normalizes array-like pixel payloads', () => {
    const result = decodeViewerResult(
      { type: 'field', width: 1, height: 1, pixels: [9, 10, 11, 12] },
      'viewer-3',
      { copyPixels: true },
    );

    expect(result).not.toBeNull();
    if (!result || !('pixels' in result)) {
      throw new Error('expected pixel result');
    }
    expect(result.pixels).toBeInstanceOf(Uint8ClampedArray);
    expect(Array.from(result.pixels)).toEqual([9, 10, 11, 12]);
  });

  it('decodes scalar viewer results', () => {
    const result = decodeViewerResult(
      { type: 'float', value: 3.5 },
      'viewer-4',
    );

    expect(result).toEqual({ type: 'float', nodeId: 'viewer-4', value: 3.5 });
  });

  it('returns transferables only for pixel results', () => {
    const imageResult = decodeViewerResult(
      { type: 'mask', width: 1, height: 1, pixels: [1, 2, 3, 4] },
      'viewer-5',
      { copyPixels: true },
    );
    const scalarResult = decodeViewerResult(
      { type: 'string', value: 'hello' },
      'viewer-6',
    );

    expect(imageResult).not.toBeNull();
    expect(scalarResult).not.toBeNull();
    expect(imageResult && collectViewerResultTransferables(imageResult)).toHaveLength(1);
    expect(scalarResult && collectViewerResultTransferables(scalarResult)).toHaveLength(0);
  });
});
