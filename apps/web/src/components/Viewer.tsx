import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { useGraphStore } from '../store/graphStore';
import {
  getViewerBufferHeight,
  getViewerBufferWidth,
  getViewerDisplayHeight,
  getViewerDisplayWidth,
  isCompareResult,
  isPixelResult,
} from '../store/types';
import type { ViewerResult } from '../store/types';
import type { MediaIteratorInfo } from '../store/graphStore/slices/mediaIteratorSlice';
import { MediaVirtualStrip } from './MediaVirtualStrip';
import { ViewerToolbar } from './ViewerToolbar';

/* ── Types ──────────────────────────────────────────────────── */
export type ChannelMode = 'r' | 'g' | 'b' | 'a' | null;

export interface ViewerDisplayState {
  channel: ChannelMode;
  gain: number;
  gamma: number;
}

export interface PixelInfo {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
  source?: 'before' | 'after';
}

const FILMSTRIP_ITEM_WIDTH = 82;
const FILMSTRIP_THUMB_WIDTH = 68;
const FILMSTRIP_THUMB_HEIGHT = 46;
const FILMSTRIP_OVERSCAN = 3;
const FILMSTRIP_BOTTOM_OFFSET = 50;
const FILMSTRIP_ERROR_BOTTOM_OFFSET = 84;

/* ── Viewer pixel transforms (display-only) ──────────────────── */

/** sRGB u8 → linear float (inverse sRGB EOTF) */
const srgbToLinear = (v: number): number => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/**
 * Apply display-only transforms to viewer pixels.
 * Returns a NEW Uint8ClampedArray — never mutates the source.
 */
function applyViewerTransforms(
  pixels: Uint8ClampedArray,
  options: { channel: ChannelMode; gain: number; gamma: number },
): Uint8ClampedArray {
  const { channel, gain, gamma } = options;

  // Fast path: no transforms needed
  if (channel === null && gain === 1 && gamma === 1) return pixels;

  const out = new Uint8ClampedArray(pixels.length);
  const invGamma = 1.0 / gamma;

  // Pre-compute LUT for gain + gamma (both operate on 0-255 sRGB values)
  let lut: Uint8ClampedArray | null = null;
  if (gain !== 1 || gamma !== 1) {
    lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let v = i * gain;
      if (v < 0) v = 0;
      if (v > 255) v = 255;
      if (gamma !== 1) {
        v = 255 * Math.pow(v / 255, invGamma);
      }
      lut[i] = Math.round(v < 0 ? 0 : v > 255 ? 255 : v);
    }
  }

  for (let i = 0; i < pixels.length; i += 4) {
    let r = pixels[i];
    let g = pixels[i + 1];
    let b = pixels[i + 2];
    const a = pixels[i + 3];

    // Channel isolation
    if (channel === 'r') { r = g = b = pixels[i]; }
    else if (channel === 'g') { r = g = b = pixels[i + 1]; }
    else if (channel === 'b') { r = g = b = pixels[i + 2]; }
    else if (channel === 'a') { r = g = b = pixels[i + 3]; }

    // Gain + gamma via LUT (RGB only, not alpha)
    if (lut) {
      r = lut[r];
      g = lut[g];
      b = lut[b];
    }

    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = channel === 'a' ? 255 : a;
  }

  return out;
}

const sampleViewerPixels = (
  result: ViewerResult,
  width: number,
  height: number,
): Uint8ClampedArray | null => {
  if (!isPixelResult(result) && !isCompareResult(result)) return null;
  const pixels = isCompareResult(result) ? result.afterPixels : result.pixels;
  const sourceWidth = getViewerBufferWidth(result);
  const sourceHeight = getViewerBufferHeight(result);
  if (sourceWidth <= 0 || sourceHeight <= 0 || pixels.length === 0) return null;

  const output = new Uint8ClampedArray(width * height * 4);
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = width / height;
  const sampleWidth = sourceAspect > targetAspect
    ? Math.round(sourceHeight * targetAspect)
    : sourceWidth;
  const sampleHeight = sourceAspect > targetAspect
    ? sourceHeight
    : Math.round(sourceWidth / targetAspect);
  const startX = Math.max(0, Math.floor((sourceWidth - sampleWidth) / 2));
  const startY = Math.max(0, Math.floor((sourceHeight - sampleHeight) / 2));

  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(
      sourceHeight - 1,
      startY + Math.floor((y / height) * sampleHeight),
    );
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(
        sourceWidth - 1,
        startX + Math.floor((x / width) * sampleWidth),
      );
      const sourceIndex = (sy * sourceWidth + sx) * 4;
      const targetIndex = (y * width + x) * 4;
      output[targetIndex] = pixels[sourceIndex];
      output[targetIndex + 1] = pixels[sourceIndex + 1];
      output[targetIndex + 2] = pixels[sourceIndex + 2];
      output[targetIndex + 3] = pixels[sourceIndex + 3];
    }
  }

  return output;
};

const CurrentResultPreview: React.FC<{
  result: ViewerResult | undefined;
  channel: ChannelMode;
  gain: number;
  gamma: number;
}> = ({ result, channel, gain, gamma }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !result) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sampled = sampleViewerPixels(result, FILMSTRIP_THUMB_WIDTH, FILMSTRIP_THUMB_HEIGHT);
    if (!sampled) {
      ctx.clearRect(0, 0, FILMSTRIP_THUMB_WIDTH, FILMSTRIP_THUMB_HEIGHT);
      return;
    }
    const transformed = applyViewerTransforms(sampled, { channel, gain, gamma });
    canvas.width = FILMSTRIP_THUMB_WIDTH;
    canvas.height = FILMSTRIP_THUMB_HEIGHT;
    const imageData = new ImageData(FILMSTRIP_THUMB_WIDTH, FILMSTRIP_THUMB_HEIGHT);
    imageData.data.set(transformed);
    ctx.putImageData(imageData, 0, 0);
  }, [channel, gain, gamma, result]);

  return (
    <canvas
      ref={canvasRef}
      width={FILMSTRIP_THUMB_WIDTH}
      height={FILMSTRIP_THUMB_HEIGHT}
      style={{
        display: 'block',
        height: '100%',
        width: '100%',
      }}
    />
  );
};

/** Renders non-pixel value types (float, int, bool, color, string, none) */
const ScalarViewer: React.FC<{ result: ViewerResult }> = ({ result }) => {
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    padding: 24,
    boxSizing: 'border-box',
  };

  switch (result.type) {
    case 'float':
    case 'int':
      return (
        <div style={containerStyle}>
          <div style={{
            fontSize: '2.5rem',
            fontFamily: 'monospace',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text-primary)',
            textAlign: 'center',
            wordBreak: 'break-all',
          }}>
            {result.type === 'float' ? result.value.toFixed(4) : result.value}
          </div>
        </div>
      );
    case 'bool':
      return (
        <div style={containerStyle}>
          <div style={{
            fontSize: '2rem',
            fontWeight: 600,
            color: result.value ? 'var(--color-success, var(--status-success-bright))' : 'var(--text-muted)',
          }}>
            {result.value ? 'True' : 'False'}
          </div>
        </div>
      );
    case 'color': {
      const [r, g, b, a] = result.value;
      // Convert linear to sRGB for display
      const toSRGB = (v: number) => Math.round(Math.max(0, Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)) * 255);
      const sr = toSRGB(r);
      const sg = toSRGB(g);
      const sb = toSRGB(b);
      const displayAlpha = Math.round(a * 100) / 100;
      return (
        <div style={containerStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 120,
              height: 120,
              borderRadius: 8,
              border: '1px solid var(--border-primary)',
              background: 'var(--viewer-color-preview)',
              '--viewer-color-preview': `rgba(${sr}, ${sg}, ${sb}, ${displayAlpha})`,
            } as React.CSSProperties} />
            <div style={{
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
              textAlign: 'center',
              lineHeight: 1.6,
            }}>
              <div>R: {r.toFixed(3)} G: {g.toFixed(3)}</div>
              <div>B: {b.toFixed(3)} A: {a.toFixed(3)}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                sRGB: rgb({sr}, {sg}, {sb})
              </div>
            </div>
          </div>
        </div>
      );
    }
    case 'string':
      return (
        <div style={{
          ...containerStyle,
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          overflow: 'auto',
        }}>
          <pre style={{
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
          }}>
            {result.value}
          </pre>
        </div>
      );
    case 'none':
      return (
        <div style={containerStyle}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            No value
          </div>
        </div>
      );
    default:
      return null;
  }
};

interface ViewerProps {
  panelApi?: { width: number; height: number; onDidDimensionsChange: (cb: (event: { width: number; height: number }) => void) => { dispose: () => void } };
}

export const Viewer: React.FC<ViewerProps> = ({ panelApi }) => {
  const selectedNodeIds = useGraphStore(s => s.selectedNodeIds);
  const nodes = useGraphStore(s => s.nodes);
  const connections = useGraphStore(s => s.connections);
  const renderResults = useGraphStore(s => s.renderResults);
  const lastError = useGraphStore(s => s.lastError);
  const playbackFps = useGraphStore(s => s.playbackFps);
  const targetFps = useGraphStore(s => s.fps);
  const isEditingGroup = useGraphStore(s => s.editingStack.length > 1);
  const currentFrame = useGraphStore(s => s.currentFrame);
  const setCurrentFrame = useGraphStore(s => s.setCurrentFrame);
  const activeTransportSourceId = useGraphStore(s => s.activeTransportSourceId);
  const mediaIteratorInfoMap = useGraphStore(s => s.mediaIteratorInfoMap);
  const suggestActiveTransportSourceForViewer = useGraphStore(s => s.suggestActiveTransportSourceForViewer);

  const fpsIndicatorColor = useMemo(() => {
    if (playbackFps === null) return 'var(--timing-fast)';
    const ratio = playbackFps / targetFps;
    if (ratio >= 0.95) return 'var(--timing-fast)';
    if (ratio >= 0.7) return 'var(--timing-medium)';
    return 'var(--timing-slow)';
  }, [playbackFps, targetFps]);

  const [activeViewerId, setActiveViewerId] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [activeChannel, setActiveChannel] = useState<ChannelMode>(null);
  const [gain, setGain] = useState(1);
  const [gamma, setGamma] = useState(1);
  const [compareSplit, setCompareSplit] = useState(0.5);
  const [isDraggingCompareSplit, setIsDraggingCompareSplit] = useState(false);
  const [pixelInfo, setPixelInfo] = useState<PixelInfo | null>(null);
  const panelWidth = useSyncExternalStore(
    (onStoreChange) => {
      if (!panelApi) return () => {};
      const disposable = panelApi.onDidDimensionsChange(() => onStoreChange());
      return () => disposable.dispose();
    },
    () => panelApi?.width ?? Infinity,
    () => panelApi?.width ?? Infinity,
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beforeCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const previewScaleRef = useRef(1);
  const dimensionsRef = useRef<{ w: number; h: number } | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);

  /** Compute the scale that fits the image entirely within the container. */
  const computeFitScale = useCallback(() => {
    const container = containerRef.current;
    const dims = dimensionsRef.current;
    if (!container || !dims) return 1;
    const padding = 40; // px breathing room on each side
    const cw = container.clientWidth - padding;
    const ch = container.clientHeight - padding;
    if (cw <= 0 || ch <= 0) return 1;
    return Math.min(cw / dims.w, ch / dims.h, 1);
  }, []);

  const fitToView = useCallback(() => {
    transformRef.current?.centerView(computeFitScale());
  }, [computeFitScale]);

  const handleToggleFit = useCallback(() => {
    const fitScale = computeFitScale();
    const currentScale = transformRef.current?.state.scale ?? 1;
    if (Math.abs(currentScale - fitScale) < 0.01) {
      transformRef.current?.centerView(1);
    } else {
      fitToView();
    }
  }, [computeFitScale, fitToView]);

  const selectedNodeId = selectedNodeIds.size > 0 ? Array.from(selectedNodeIds).pop()! : null;
  const selectedViewerId = useMemo(() => {
    if (!selectedNodeId) return null;
    const node = nodes.get(selectedNodeId);
    return node && (node.typeId === 'viewer' || node.typeId === 'compare_viewer')
      ? selectedNodeId
      : null;
  }, [selectedNodeId, nodes]);
  const firstViewerId = useMemo(() => {
    return Array.from(nodes.values()).find(n => n.typeId === 'viewer' || n.typeId === 'compare_viewer')?.id ?? null;
  }, [nodes]);

  useEffect(() => {
    let nextViewerId = activeViewerId;
    if (selectedViewerId) {
      nextViewerId = selectedViewerId;
    } else if (activeViewerId) {
      const activeNode = nodes.get(activeViewerId);
      if (!activeNode || (activeNode.typeId !== 'viewer' && activeNode.typeId !== 'compare_viewer')) {
        nextViewerId = firstViewerId;
      }
    } else {
      nextViewerId = firstViewerId;
    }
    if (nextViewerId === activeViewerId) return;
    const timer = window.setTimeout(() => setActiveViewerId(nextViewerId), 0);
    return () => window.clearTimeout(timer);
  }, [activeViewerId, firstViewerId, nodes, selectedViewerId]);

  useEffect(() => {
    if (!activeViewerId) return;
    suggestActiveTransportSourceForViewer(activeViewerId);
  }, [activeViewerId, connections, suggestActiveTransportSourceForViewer]);

  const rawActiveResult = useMemo(() => {
    return activeViewerId ? renderResults.get(activeViewerId) : undefined;
  }, [renderResults, activeViewerId]);
  const currentFrameRef = useRef(currentFrame);
  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);
  const [activeResultFrame, setActiveResultFrame] = useState<{
    viewerId: string | null;
    result: ViewerResult | undefined;
    frame: number;
  }>({ viewerId: null, result: undefined, frame: currentFrame });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActiveResultFrame({
        viewerId: activeViewerId,
        result: rawActiveResult,
        frame: rawActiveResult?.frame ?? currentFrameRef.current,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeViewerId, rawActiveResult]);
  const activeResultMatchesFrame = activeResultFrame.viewerId === activeViewerId
    && activeResultFrame.result === rawActiveResult
    && activeResultFrame.frame === currentFrame;

  const activeIterator: MediaIteratorInfo | null = useMemo(() => {
    return activeTransportSourceId
      ? mediaIteratorInfoMap.get(activeTransportSourceId) ?? null
      : null;
  }, [activeTransportSourceId, mediaIteratorInfoMap]);

  const activeItemIndex = activeIterator
    ? Math.max(0, Math.min(activeIterator.count - 1, currentFrame - activeIterator.startFrame))
    : 0;

  const activeResult = useMemo(() => {
    if (
      activeIterator
      && rawActiveResult
      && rawActiveResult.frame !== undefined
      && rawActiveResult.frame !== currentFrame
    ) {
      return undefined;
    }
    return rawActiveResult;
  }, [activeIterator, currentFrame, rawActiveResult]);

  const hasResult = !!activeResult;
  const hasPixels = activeResult ? isPixelResult(activeResult) || isCompareResult(activeResult) : false;

  const dimensions = useMemo(() => {
    if (!activeResult || (!isPixelResult(activeResult) && !isCompareResult(activeResult))) return null;
    return {
      w: getViewerDisplayWidth(activeResult),
      h: getViewerDisplayHeight(activeResult),
    };
  }, [activeResult]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!activeResult || (!isPixelResult(activeResult) && !isCompareResult(activeResult)) || !canvas) {
      return;
    }
    const beforeCanvas = isCompareResult(activeResult) ? beforeCanvasRef.current : null;
    if (isCompareResult(activeResult) && !beforeCanvas) return;

    const previewScale = activeResult.previewScale ?? 1;
    previewScaleRef.current = previewScale;
    // Use original (pre-downscale) dimensions so the canvas size and
    // dimsChanged check are immune to preview-scale rounding errors.
    const logicalWidth = getViewerDisplayWidth(activeResult);
    const logicalHeight = getViewerDisplayHeight(activeResult);
    const backingWidth = getViewerBufferWidth(activeResult);
    const backingHeight = getViewerBufferHeight(activeResult);
    const prevDimensions = dimensionsRef.current;

    // Keep CSS/layout dimensions logical, but keep the backing store at the
    // preview size so frame navigation does not allocate full-resolution buffers.
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
      imageDataRef.current = null;
    }

    const dimsChanged = !prevDimensions || prevDimensions.w !== logicalWidth || prevDimensions.h !== logicalHeight;
    dimensionsRef.current = { w: logicalWidth, h: logicalHeight };

    const drawPixels = (targetCanvas: HTMLCanvasElement, pixels: Uint8ClampedArray) => {
      const ctx = targetCanvas.getContext('2d');
      if (!ctx) return;
      if (targetCanvas.width !== backingWidth || targetCanvas.height !== backingHeight) {
        targetCanvas.width = backingWidth;
        targetCanvas.height = backingHeight;
        if (targetCanvas === canvas) imageDataRef.current = null;
      }

      const transformed = applyViewerTransforms(pixels, {
        channel: activeChannel,
        gain,
        gamma,
      });

      ctx.imageSmoothingEnabled = previewScale >= 1;
      if (targetCanvas === canvas) {
        let imgData = imageDataRef.current;
        if (!imgData || imgData.width !== backingWidth || imgData.height !== backingHeight) {
          imgData = new ImageData(backingWidth, backingHeight);
          imageDataRef.current = imgData;
        }
        imgData.data.set(transformed);
        ctx.putImageData(imgData, 0, 0);
      } else {
        const imgData = new ImageData(backingWidth, backingHeight);
        imgData.data.set(transformed);
        ctx.putImageData(imgData, 0, 0);
      }

      targetCanvas.style.width = `${logicalWidth}px`;
      targetCanvas.style.height = `${logicalHeight}px`;
      targetCanvas.style.imageRendering = previewScale < 1 ? 'pixelated' : 'auto';
    };

    if (isCompareResult(activeResult)) {
      drawPixels(canvas, activeResult.afterPixels);
      if (beforeCanvas) drawPixels(beforeCanvas, activeResult.beforePixels);
    } else {
      drawPixels(canvas, activeResult.pixels);
    }

    if (dimsChanged) {
      setTimeout(() => transformRef.current?.centerView(computeFitScale(), 0), 0);
    } else if (transformRef.current?.state) {
      // Preserve zoom/pan when only pixel content changed (e.g. preview render).
      // The library's internal ResizeObserver may call handleAlignToBounds
      // which resets the transform — restore it on the next frame.
      const { positionX, positionY, scale } = transformRef.current.state;
      requestAnimationFrame(() => {
        transformRef.current?.setTransform(positionX, positionY, scale, 0);
      });
    }
  }, [activeResult, computeFitScale, activeChannel, gain, gamma]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Channel isolation shortcuts (no modifier keys)
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (activeIterator && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          const direction = e.key === 'ArrowRight' ? 1 : -1;
          setCurrentFrame(Math.max(
            activeIterator.startFrame,
            Math.min(currentFrame + direction, activeIterator.endFrame),
          ));
          return;
        }

        const key = e.key.toLowerCase();
        if (key === 'r' || key === 'g' || key === 'b' || key === 'a') {
          e.preventDefault();
          const ch = key as ChannelMode;
          setActiveChannel(prev => prev === ch ? null : ch);
          return;
        }
      }

      if (!e.metaKey && !e.ctrlKey) return;

      switch (e.key) {
        case '=':
        case '+':
          e.preventDefault();
          transformRef.current?.zoomIn(0.5);
          break;
        case '-':
        case '_':
          e.preventDefault();
          transformRef.current?.zoomOut(0.5);
          break;
        case '0':
          e.preventDefault();
          fitToView();
          break;
        case '1':
          e.preventDefault();
          transformRef.current?.centerView(1);
          break;
      }
    };
    
    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [activeIterator, currentFrame, fitToView, setCurrentFrame]);

  // Pixel inspector: track mouse over canvas
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!activeResult || (!isPixelResult(activeResult) && !isCompareResult(activeResult))) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      // Get canvas bounding rect to convert screen coords to logical image pixels.
      const rect = canvas.getBoundingClientRect();
      const logicalWidth = getViewerDisplayWidth(activeResult);
      const logicalHeight = getViewerDisplayHeight(activeResult);
      const scaleX = logicalWidth / rect.width;
      const scaleY = logicalHeight / rect.height;
      const px = Math.floor((e.clientX - rect.left) * scaleX);
      const py = Math.floor((e.clientY - rect.top) * scaleY);

      // Check bounds (logical dimensions)
      if (px < 0 || py < 0 || px >= logicalWidth || py >= logicalHeight) {
        setPixelInfo(null);
        return;
      }

      // Map logical coords to the actual pixel buffer coords
      const previewScale = activeResult.previewScale ?? 1;
      const bufferWidth = getViewerBufferWidth(activeResult);
      const bufferHeight = getViewerBufferHeight(activeResult);
      const bufX = Math.min(Math.floor(px * previewScale), bufferWidth - 1);
      const bufY = Math.min(Math.floor(py * previewScale), bufferHeight - 1);
      const idx = (bufY * bufferWidth + bufX) * 4;
      const source = isCompareResult(activeResult) && px / logicalWidth <= compareSplit ? 'before' : 'after';
      const pixels = isCompareResult(activeResult)
        ? source === 'before' ? activeResult.beforePixels : activeResult.afterPixels
        : activeResult.pixels;
      setPixelInfo({
        x: px,
        y: py,
        r: pixels[idx],
        g: pixels[idx + 1],
        b: pixels[idx + 2],
        a: pixels[idx + 3],
        source: isCompareResult(activeResult) ? source : undefined,
      });
    },
    [activeResult, compareSplit],
  );

  const handleCanvasMouseLeave = useCallback(() => {
    setPixelInfo(null);
  }, []);

  const handleResetDisplayControls = useCallback(() => {
    setGain(1);
    setGamma(1);
  }, []);

  const updateCompareSplitFromPointer = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    const next = (clientX - rect.left) / rect.width;
    setCompareSplit(Math.max(0, Math.min(1, next)));
  }, []);

  const handleComparePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingCompareSplit(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateCompareSplitFromPointer(e.clientX);
  }, [updateCompareSplitFromPointer]);

  const handleComparePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingCompareSplit) return;
    e.preventDefault();
    updateCompareSplitFromPointer(e.clientX);
  }, [isDraggingCompareSplit, updateCompareSplitFromPointer]);

  const handleComparePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingCompareSplit) return;
    e.preventDefault();
    setIsDraggingCompareSplit(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, [isDraggingCompareSplit]);

  return (
    <section
      data-testid="viewer-panel"
      data-viewer-channel={activeChannel ?? ''}
      data-viewer-gain={gain}
      data-viewer-gamma={gamma}
      className="panel"
      aria-label="Viewer"
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        outline: 'none',
      }}
      ref={containerRef}
      tabIndex={-1}
      onPointerDown={() => containerRef.current?.focus()}
    >
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.05}
        maxScale={50}
        centerOnInit={true}
        wheel={{ step: 0.5, wheelDisabled: true }}
        doubleClick={{ disabled: true }}
        panning={{ velocityDisabled: true, wheelPanning: true }}
        limitToBounds={false}
        onTransformed={(_ref, state) => setZoomPercent(Math.round(state.scale * 100))}
      >
        {(_utils) => (
          <>
            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              wrapperProps={{
                role: 'button',
                tabIndex: 0,
                onDoubleClick: handleToggleFit,
                onKeyDown: (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleToggleFit();
                  }
                },
              }}
            >
              {/* Pixel viewer (image/mask/field) */}
              <div
                className="viewer-checkerboard"
                style={{
                    display: hasPixels ? 'flex' : 'none',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 'fit-content',
                    height: 'fit-content',
                    position: 'relative',
                }}
                onMouseMove={handleCanvasMouseMove}
                onMouseLeave={handleCanvasMouseLeave}
              >
                <canvas
                  ref={canvasRef}
                  data-testid="viewer-canvas"
                  data-viewer-canvas
                  style={{
                    display: 'block',
                    imageRendering: 'auto',
                  }}
                />
                {activeResult && isCompareResult(activeResult) && (
                  <div
                    className="viewer-compare-overlay"
                    data-testid="viewer-compare-overlay"
                    style={{ '--compare-split': compareSplit } as React.CSSProperties}
                    onPointerDown={handleComparePointerDown}
                    onPointerMove={handleComparePointerMove}
                    onPointerUp={handleComparePointerUp}
                    onPointerCancel={handleComparePointerUp}
                  >
                    <div className="viewer-compare-before">
                      <canvas
                        ref={beforeCanvasRef}
                        data-testid="viewer-before-canvas"
                        style={{
                          display: 'block',
                          imageRendering: 'auto',
                        }}
                      />
                    </div>
                    <div
                      className="viewer-compare-divider"
                      role="slider"
                      aria-label="Compare split"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(compareSplit * 100)}
                    />
                  </div>
                )}
              </div>
              {/* Scalar value viewer */}
              {hasResult && !hasPixels && activeResult && (
                <ScalarViewer result={activeResult} />
              )}
            </TransformComponent>
          </>
        )}
      </TransformWrapper>

      <ViewerToolbar
          zoomIn={() => transformRef.current?.zoomIn(0.5)}
          zoomOut={() => transformRef.current?.zoomOut(0.5)}
          fitToView={fitToView}
          setActualPixels={() => transformRef.current?.centerView(1)}
          setZoomLevel={(scale) => transformRef.current?.centerView(scale)}
          zoomPercent={zoomPercent}
          activeChannel={activeChannel}
          onChannelChange={setActiveChannel}
          gain={gain}
          onGainChange={setGain}
          gamma={gamma}
          onGammaChange={setGamma}
          onResetDisplayControls={handleResetDisplayControls}
          panelWidth={panelWidth}
          hasError={!!lastError}
      />
      
      {dimensions && hasPixels && (
        <div style={{
          position: 'absolute',
          top: 4,
          left: 6,
          display: 'flex',
          gap: 4,
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          <div style={{
            fontSize: '0.65rem',
            color: 'var(--text-muted)',
            background: 'var(--overlay-label)',
            padding: '1px 5px',
            borderRadius: 3,
          }}>
            {dimensions.w}×{dimensions.h}
          </div>
          {playbackFps !== null && (
            <div style={{
              fontSize: '0.65rem',
              fontFamily: 'monospace',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--text-primary)',
              background: fpsIndicatorColor,
              padding: '1px 5px',
              borderRadius: 3,
            }}>
              {Math.round(playbackFps)} fps
            </div>
          )}
        </div>
      )}

      {activeIterator && activeIterator.count > 1 && activeViewerId && (
        <div
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: lastError ? FILMSTRIP_ERROR_BOTTOM_OFFSET : FILMSTRIP_BOTTOM_OFFSET,
            height: 72,
            zIndex: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            pointerEvents: 'auto',
          }}
          onPointerDown={e => e.stopPropagation()}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: 'var(--text-secondary)',
              background: 'var(--overlay-label)',
              border: '1px solid var(--border-primary)',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: '0.65rem',
              lineHeight: 1.2,
              maxWidth: '100%',
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={activeIterator.label}
            >
              {activeIterator.label}
            </span>
            <span style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {activeItemIndex + 1} / {activeIterator.count}
            </span>
          </div>
          <MediaVirtualStrip
            ariaLabel="Media frames"
            count={activeIterator.count}
            itemSize={FILMSTRIP_ITEM_WIDTH}
            height={54}
            overscan={FILMSTRIP_OVERSCAN}
            activeIndex={activeItemIndex}
            className="nopan nodrag"
            style={{
              background: 'var(--overlay-label)',
              border: '1px solid var(--border-primary)',
              borderRadius: 4,
            }}
            renderItem={(index) => {
              const frame = activeIterator.startFrame + index;
              const isActive = frame === currentFrame;
              const label = activeIterator.itemLabels[index] ?? String(frame);
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => setCurrentFrame(frame)}
                  title={label}
                  style={{
                    position: 'absolute',
                    left: 6,
                    top: 4,
                    width: FILMSTRIP_THUMB_WIDTH,
                    height: FILMSTRIP_THUMB_HEIGHT,
                    padding: 0,
                    border: isActive
                      ? '2px solid var(--accent-primary)'
                      : '1px solid var(--border-primary)',
                    borderRadius: 4,
                    background: 'var(--bg-surface)',
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    lineHeight: 1.1,
                  }}
                >
                  {isActive && activeResultMatchesFrame && activeResult && (isPixelResult(activeResult) || isCompareResult(activeResult)) ? (
                    <CurrentResultPreview
                      result={activeResult}
                      channel={activeChannel}
                      gain={gain}
                      gamma={gamma}
                    />
                  ) : (
                    <span
                      style={{
                        display: 'flex',
                        width: '100%',
                        height: '100%',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.62rem',
                        fontVariantNumeric: 'tabular-nums',
                        overflow: 'hidden',
                        padding: 4,
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label || index + 1}
                    </span>
                  )}
                </button>
              );
            }}
          />
        </div>
      )}
      
      {!hasResult && (
        <div style={{ 
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'var(--text-muted)', 
          fontSize: '0.8rem', 
          textAlign: 'center', 
          padding: '20px',
          pointerEvents: 'none'
        }}>
          {activeViewerId
            ? 'No output'
            : isEditingGroup
              ? 'Add and connect a local Viewer node'
              : 'Add and select a Viewer node'}
        </div>
      )}
      
      {lastError && (
        <div
          onPointerDown={e => e.stopPropagation()}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '6px 10px',
            background: 'var(--status-errorBg)',
            color: 'var(--text-primary)',
            fontSize: '0.72rem',
            lineHeight: '1.3',
            zIndex: 20,
            userSelect: 'text',
            cursor: 'text',
          }}
        >
          {lastError.message}
        </div>
      )}

      {/* Pixel Inspector overlay */}
      {pixelInfo && (
        <div
          className="viewer-pixel-inspector"
          data-testid="pixel-inspector"
          data-pixel-info={JSON.stringify(pixelInfo)}
        >
          <span className="viewer-pixel-inspector__coords">[{pixelInfo.x}, {pixelInfo.y}]</span>
          {pixelInfo.source && (
            <span className="viewer-pixel-inspector__coords">{pixelInfo.source}</span>
          )}
          <span className="viewer-pixel-inspector__channel viewer-pixel-inspector__channel--r">R: {pixelInfo.r} ({srgbToLinear(pixelInfo.r).toFixed(3)})</span>
          <span className="viewer-pixel-inspector__channel viewer-pixel-inspector__channel--g">G: {pixelInfo.g} ({srgbToLinear(pixelInfo.g).toFixed(3)})</span>
          <span className="viewer-pixel-inspector__channel viewer-pixel-inspector__channel--b">B: {pixelInfo.b} ({srgbToLinear(pixelInfo.b).toFixed(3)})</span>
          <span className="viewer-pixel-inspector__channel viewer-pixel-inspector__channel--a">A: {pixelInfo.a} ({(pixelInfo.a / 255).toFixed(3)})</span>
        </div>
      )}
    </section>
  );
};
