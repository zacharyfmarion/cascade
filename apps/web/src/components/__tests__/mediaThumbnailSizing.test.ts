import { describe, expect, it } from 'vitest';
import { aspectThumbnailSize, containRect, readPngDimensions } from '../mediaThumbnailSizing';

const pngBytes = (width: number, height: number) => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
};

describe('media thumbnail sizing', () => {
  it('computes variable widths with a fixed thumbnail height', () => {
    expect(aspectThumbnailSize(1600, 900, 46)).toEqual({ width: 82, height: 46 });
    expect(aspectThumbnailSize(900, 1600, 46)).toEqual({ width: 34, height: 46 });
    expect(aspectThumbnailSize(1000, 1000, 46)).toEqual({ width: 46, height: 46 });
  });

  it('contains extreme aspects inside bounded thumbnail tiles', () => {
    expect(aspectThumbnailSize(10000, 1000, 46)).toEqual({ width: 144, height: 46 });
    expect(containRect(10000, 1000, 144, 46)).toEqual({
      x: 0,
      y: 16,
      width: 144,
      height: 14,
    });
  });

  it('reads PNG dimensions without decoding image pixels', () => {
    expect(readPngDimensions(pngBytes(1208, 2624))).toEqual({ width: 1208, height: 2624 });
    expect(readPngDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
