import { describe, expect, it } from 'vitest';

import {
  getPreviewDownscaleSize,
  getPreviewScaleFromDimensions,
} from '../store/graphStore/kernel';

describe('preview downscale sizing', () => {
  it('keeps already-small images at full resolution', () => {
    expect(getPreviewDownscaleSize(400, 300, 0.25)).toBeNull();
  });

  it('clamps aggressive preview scales to a readable minimum edge', () => {
    expect(getPreviewDownscaleSize(1200, 900, 0.25)).toEqual({
      width: 800,
      height: 600,
      scale: 600 / 900,
    });
  });

  it('preserves the requested preview scale for large images', () => {
    expect(getPreviewDownscaleSize(4096, 3072, 0.25)).toEqual({
      width: 1024,
      height: 768,
      scale: 0.25,
    });
  });

  it('does not stretch narrow images to satisfy the minimum edge', () => {
    expect(getPreviewDownscaleSize(400, 100, 0.25)).toBeNull();
  });

  it('derives the actual live preview scale from returned dimensions', () => {
    expect(getPreviewScaleFromDimensions(800, 600, 1200, 900)).toBeCloseTo(800 / 1200);
    expect(getPreviewScaleFromDimensions(200, 150, 200, 150)).toBe(1);
  });
});
