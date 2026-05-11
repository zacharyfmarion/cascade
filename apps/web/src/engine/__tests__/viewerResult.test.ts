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
      bufferWidth: 1,
      bufferHeight: 1,
      displayWidth: 1,
      displayHeight: 1,
      beforePixels,
      afterPixels,
    });
  });

  it('keeps preview buffer dimensions separate from display dimensions', () => {
    const pixels = new Uint8ClampedArray(800 * 600 * 4);

    const result = decodeViewerResult({
      type: 'image',
      width: 800,
      height: 600,
      bufferWidth: 800,
      bufferHeight: 600,
      displayWidth: 3200,
      displayHeight: 2400,
      originalWidth: 3200,
      originalHeight: 2400,
      pixels,
    }, 'viewer-1');

    expect(result).toMatchObject({
      type: 'image',
      nodeId: 'viewer-1',
      width: 800,
      height: 600,
      bufferWidth: 800,
      bufferHeight: 600,
      displayWidth: 3200,
      displayHeight: 2400,
      originalWidth: 3200,
      originalHeight: 2400,
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
