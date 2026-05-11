import { describe, expect, it } from 'vitest';

import {
  annotateEnginePreviewResult,
  getEffectivePreviewScaleForResult,
  getEffectivePreviewScaleForResults,
  getPreviewDownscaleSize,
  getPreviewScaleFromDimensions,
} from '../store/graphStore/kernel';
import type { ViewerResult } from '../store/types';

type ImageViewerResult = Extract<ViewerResult, { type: 'image' }>;

const imageResult = (width: number, height: number): ImageViewerResult => ({
  type: 'image',
  nodeId: 'viewer',
  width,
  height,
  pixels: new Uint8ClampedArray(Math.min(width * height * 4, 4)),
});

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

  it('annotates an engine-scaled preview result without resizing it again', () => {
    const previous = imageResult(4096, 3072);
    const enginePreview = imageResult(1024, 768);

    const annotated = annotateEnginePreviewResult(enginePreview, 0.25, previous);

    expect(annotated).toMatchObject({
      type: 'image',
      width: 1024,
      height: 768,
      bufferWidth: 1024,
      bufferHeight: 768,
      displayWidth: 4096,
      displayHeight: 3072,
      previewScale: 0.25,
      originalWidth: 4096,
      originalHeight: 3072,
    });
  });

  it('does not treat a smaller mixed-size frame as a preview of the previous frame', () => {
    const previous = imageResult(2048, 2048);
    const landscape = imageResult(746, 442);

    const annotated = annotateEnginePreviewResult(landscape, 0.25, previous);

    expect(annotated).toBe(landscape);
    expect(annotated).not.toHaveProperty('displayWidth');
    expect(annotated).not.toHaveProperty('previewScale');
  });

  it('trusts explicit current-frame dimensions even when they match the previous aspect ratio', () => {
    const previous = imageResult(2048, 2048);
    const smallerSquare: ImageViewerResult = {
      ...imageResult(1024, 1024),
      bufferWidth: 1024,
      bufferHeight: 1024,
      displayWidth: 1024,
      displayHeight: 1024,
      originalWidth: 1024,
      originalHeight: 1024,
    };

    const annotated = annotateEnginePreviewResult(smallerSquare, 0.25, previous);
    if (annotated.type !== 'image') {
      throw new Error('expected image result');
    }

    expect(annotated).toBe(smallerSquare);
    expect(annotated).toMatchObject({
      width: 1024,
      height: 1024,
      displayWidth: 1024,
      displayHeight: 1024,
      originalWidth: 1024,
      originalHeight: 1024,
    });
    expect(annotated.previewScale).toBeUndefined();
  });

  it('uses explicit display dimensions from engine preview results', () => {
    const enginePreview: ViewerResult = {
      ...imageResult(903, 600),
      bufferWidth: 903,
      bufferHeight: 600,
      displayWidth: 3200,
      displayHeight: 2126,
      originalWidth: 3200,
      originalHeight: 2126,
    };

    const annotated = annotateEnginePreviewResult(enginePreview, 0.25);
    if (annotated.type !== 'image') {
      throw new Error('expected image result');
    }

    expect(annotated).toMatchObject({
      width: 903,
      height: 600,
      bufferWidth: 903,
      bufferHeight: 600,
      displayWidth: 3200,
      displayHeight: 2126,
      originalWidth: 3200,
      originalHeight: 2126,
    });
    expect(annotated.previewScale).toBeCloseTo(600 / 2126);
  });

  it('does not invent preview metadata without a previous full-size result', () => {
    const enginePreview = imageResult(1024, 768);

    expect(annotateEnginePreviewResult(enginePreview, 0.25)).toBe(enginePreview);
  });

  it('raises requested preview scale to the actual minimum-edge scale', () => {
    const previous = imageResult(1200, 900);

    expect(getEffectivePreviewScaleForResult(0.25, previous)).toBeCloseTo(600 / 900);
  });

  it('uses full scale when the current image size is unknown', () => {
    expect(getEffectivePreviewScaleForResult(0.25)).toBe(1);
    expect(getEffectivePreviewScaleForResults(0.25, [])).toBe(1);
  });

  it('uses full scale for images smaller than the minimum edge', () => {
    const small = imageResult(400, 300);

    expect(getEffectivePreviewScaleForResult(0.25, small)).toBe(1);
  });

  it('uses the largest effective scale needed by current viewer results', () => {
    const small = imageResult(1200, 900);
    const large = imageResult(4096, 3072);

    expect(getEffectivePreviewScaleForResults(0.25, [small, large])).toBeCloseTo(600 / 900);
  });
});
