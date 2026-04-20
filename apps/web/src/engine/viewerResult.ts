import { isPixelResult, type ViewerResult } from '../store/types';

type DecodeViewerResultOptions = {
  copyPixels?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function decodePixels(rawPixels: unknown, copyPixels: boolean): Uint8ClampedArray | null {
  if (rawPixels instanceof Uint8ClampedArray) {
    return copyPixels ? new Uint8ClampedArray(rawPixels) : rawPixels;
  }

  if (!rawPixels || typeof rawPixels !== 'object' || !('length' in rawPixels)) {
    return null;
  }

  const pixels = new Uint8ClampedArray(rawPixels as ArrayLike<number>);
  return pixels.length > 0 ? pixels : null;
}

export function decodeViewerResult(
  raw: unknown,
  nodeId: string,
  options: DecodeViewerResultOptions = {},
): ViewerResult | null {
  if (!isRecord(raw)) {
    return null;
  }

  const type = raw.type;
  if (type !== 'image'
    && type !== 'mask'
    && type !== 'field'
    && type !== 'float'
    && type !== 'int'
    && type !== 'bool'
    && type !== 'color'
    && type !== 'string'
    && type !== 'none') {
    return null;
  }

  switch (type) {
    case 'image':
    case 'mask':
    case 'field': {
      const pixels = decodePixels(raw.pixels, options.copyPixels ?? false);
      if (!pixels) {
        return null;
      }
      return {
        type,
        nodeId,
        width: raw.width as number,
        height: raw.height as number,
        pixels,
      };
    }
    case 'float':
    case 'int':
      return { type, nodeId, value: raw.value as number };
    case 'bool':
      return { type: 'bool', nodeId, value: raw.value as boolean };
    case 'color':
      return { type: 'color', nodeId, value: raw.value as [number, number, number, number] };
    case 'string':
      return { type: 'string', nodeId, value: raw.value as string };
    case 'none':
      return { type: 'none', nodeId };
  }
}

export function collectViewerResultTransferables(result: ViewerResult): ArrayBuffer[] {
  if (!isPixelResult(result)) {
    return [];
  }
  return [result.pixels.buffer as ArrayBuffer];
}
