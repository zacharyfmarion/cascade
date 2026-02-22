const MAX_THUMBNAIL_WIDTH = 512;
const JPEG_QUALITY = 0.7;

const isCanvasUsable = (canvas: HTMLCanvasElement): boolean =>
  canvas.width > 0 && canvas.height > 0;

const pickLargestCanvas = (canvases: HTMLCanvasElement[]): HTMLCanvasElement | null => {
  if (canvases.length === 0) return null;
  return canvases.reduce((best, current) => {
    const bestArea = best.width * best.height;
    const currentArea = current.width * current.height;
    return currentArea > bestArea ? current : best;
  });
};

export const captureViewerThumbnail = (): string | null => {
  if (typeof document === 'undefined') return null;

  const taggedCanvas = document.querySelector('canvas[data-viewer-canvas]') as HTMLCanvasElement | null;
  let canvas = taggedCanvas;

  if (!canvas) {
    const candidates = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
    const usable = candidates.filter(isCanvasUsable);
    canvas = pickLargestCanvas(usable);
  }

  if (!canvas || !isCanvasUsable(canvas)) return null;

  const scale = Math.min(1, MAX_THUMBNAIL_WIDTH / canvas.width);
  const thumb = document.createElement('canvas');
  thumb.width = Math.max(1, Math.round(canvas.width * scale));
  thumb.height = Math.max(1, Math.round(canvas.height * scale));

  const ctx = thumb.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL('image/jpeg', JPEG_QUALITY);
};
