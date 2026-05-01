import { describe, expect, it } from 'vitest';
import {
  collectViewerResultTransferables,
  decodeViewerResult,
} from '../viewerResult';

describe('viewerResult', () => {
  it('decodes compare viewer payloads', () => {
    const beforePixels = new Uint8ClampedArray([255, 0, 0, 255]);
    const afterPixels = new Uint8ClampedArray([0, 255, 0, 255]);

    const result = decodeViewerResult({
      type: 'compare',
      width: 1,
      height: 1,
      beforePixels,
      afterPixels,
    }, 'compare-1');

    expect(result).toEqual({
      type: 'compare',
      nodeId: 'compare-1',
      width: 1,
      height: 1,
      beforePixels,
      afterPixels,
    });
  });

  it('collects both compare pixel buffers as transferables', () => {
    const beforePixels = new Uint8ClampedArray([255, 0, 0, 255]);
    const afterPixels = new Uint8ClampedArray([0, 255, 0, 255]);

    const transferables = collectViewerResultTransferables({
      type: 'compare',
      nodeId: 'compare-1',
      width: 1,
      height: 1,
      beforePixels,
      afterPixels,
    });

    expect(transferables).toEqual([beforePixels.buffer, afterPixels.buffer]);
  });
});
