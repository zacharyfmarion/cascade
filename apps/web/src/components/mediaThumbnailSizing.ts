export interface ThumbnailDimensions {
  width: number;
  height: number;
}

export interface ThumbnailRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MEDIA_THUMBNAIL_MIN_WIDTH = 34;
export const MEDIA_THUMBNAIL_MAX_WIDTH = 144;

export const aspectThumbnailSize = (
  sourceWidth: number,
  sourceHeight: number,
  height: number,
  minWidth = MEDIA_THUMBNAIL_MIN_WIDTH,
  maxWidth = MEDIA_THUMBNAIL_MAX_WIDTH,
): ThumbnailDimensions => {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: Math.round(height * 1.45), height };
  }
  const rawWidth = Math.round((sourceWidth / sourceHeight) * height);
  return {
    width: Math.max(minWidth, Math.min(maxWidth, rawWidth)),
    height,
  };
};

export const containRect = (
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): ThumbnailRect => {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;
  if (sourceAspect > targetAspect) {
    const height = Math.max(1, Math.round(targetWidth / sourceAspect));
    return {
      x: 0,
      y: Math.floor((targetHeight - height) / 2),
      width: targetWidth,
      height,
    };
  }

  const width = Math.max(1, Math.round(targetHeight * sourceAspect));
  return {
    x: Math.floor((targetWidth - width) / 2),
    y: 0,
    width,
    height: targetHeight,
  };
};

export const readPngDimensions = (bytes: Uint8Array): ThumbnailDimensions | null => {
  if (bytes.byteLength < 24) return null;
  const isPng = bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
  const isIhdr = bytes[12] === 0x49
    && bytes[13] === 0x48
    && bytes[14] === 0x44
    && bytes[15] === 0x52;
  if (!isPng || !isIhdr) return null;

  const width = ((bytes[16] << 24) >>> 0)
    + (bytes[17] << 16)
    + (bytes[18] << 8)
    + bytes[19];
  const height = ((bytes[20] << 24) >>> 0)
    + (bytes[21] << 16)
    + (bytes[22] << 8)
    + bytes[23];

  if (width <= 0 || height <= 0) return null;
  return { width, height };
};
