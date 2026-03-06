import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { useGraphStore } from '../store/graphStore';
import { isPixelResult } from '../store/types';
import type { ViewerResult } from '../store/types';
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
}

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
  const renderResults = useGraphStore(s => s.renderResults);
  const lastError = useGraphStore(s => s.lastError);
  const playbackFps = useGraphStore(s => s.playbackFps);
  const targetFps = useGraphStore(s => s.fps);

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

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- Syncs selected viewer state with external store updates. */
    if (selectedNodeId) {
      const node = nodes.get(selectedNodeId);
      if (node && node.typeId === 'viewer') {
        setActiveViewerId(selectedNodeId);
        return;
      }
    }
    if (!activeViewerId) {
      const viewerNode = Array.from(nodes.values()).find(n => n.typeId === 'viewer');
      if (viewerNode) {
        setActiveViewerId(viewerNode.id);
      }
    }
    if (activeViewerId && !nodes.has(activeViewerId)) {
      setActiveViewerId(null);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [selectedNodeId, nodes, activeViewerId]);

  const activeResult = useMemo(() => {
    return activeViewerId ? renderResults.get(activeViewerId) : undefined;
  }, [renderResults, activeViewerId]);

  const hasResult = !!activeResult;
  const hasPixels = activeResult ? isPixelResult(activeResult) : false;

  const dimensions = useMemo(() => {
    if (!activeResult || !isPixelResult(activeResult)) return null;
    return {
      w: activeResult.originalWidth ?? activeResult.width,
      h: activeResult.originalHeight ?? activeResult.height,
    };
  }, [activeResult]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!activeResult || !isPixelResult(activeResult) || !canvas) {
      return;
    }

    const previewScale = activeResult.previewScale ?? 1;
    previewScaleRef.current = previewScale;
    // Use original (pre-downscale) dimensions so the canvas size and
    // dimsChanged check are immune to preview-scale rounding errors.
    const logicalWidth = activeResult.originalWidth ?? activeResult.width;
    const logicalHeight = activeResult.originalHeight ?? activeResult.height;
    const prevDimensions = dimensionsRef.current;

    // Keep canvas at logical (full-res) dimensions so TransformWrapper
    // never sees a size change when preview scale varies.
    if (canvas.width !== logicalWidth || canvas.height !== logicalHeight) {
      canvas.width = logicalWidth;
      canvas.height = logicalHeight;
      imageDataRef.current = null;
    }

    const dimsChanged = !prevDimensions || prevDimensions.w !== logicalWidth || prevDimensions.h !== logicalHeight;
    dimensionsRef.current = { w: logicalWidth, h: logicalHeight };

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Apply display-only transforms (channel isolation, gain, gamma)
    const transformed = applyViewerTransforms(activeResult.pixels, {
      channel: activeChannel,
      gain,
      gamma,
    });

    if (previewScale < 1) {
      // Downscaled preview: draw pixel data onto a temporary canvas at the
      // actual (small) resolution, then stretch it up to the logical canvas.
      const offscreen = document.createElement('canvas');
      offscreen.width = activeResult.width;
      offscreen.height = activeResult.height;
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        const imgData = new ImageData(activeResult.width, activeResult.height);
        imgData.data.set(transformed);
        offCtx.putImageData(imgData, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, logicalWidth, logicalHeight);
        ctx.drawImage(offscreen, 0, 0, logicalWidth, logicalHeight);
      }
    } else {
      // Full resolution: write pixels directly
      let imgData = imageDataRef.current;
      if (!imgData || imgData.width !== logicalWidth || imgData.height !== logicalHeight) {
        imgData = new ImageData(logicalWidth, logicalHeight);
        imageDataRef.current = imgData;
      }
      imgData.data.set(transformed);
      ctx.putImageData(imgData, 0, 0);
    }

    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
    canvas.style.imageRendering = previewScale < 1 ? 'pixelated' : 'auto';

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
  }, [fitToView]);

  // Pixel inspector: track mouse over canvas
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!activeResult || !isPixelResult(activeResult)) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      // Get canvas bounding rect to convert screen → canvas coords
      // Canvas is always at logical dimensions, so these coords are logical pixels.
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const px = Math.floor((e.clientX - rect.left) * scaleX);
      const py = Math.floor((e.clientY - rect.top) * scaleY);

      // Check bounds (logical dimensions)
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) {
        setPixelInfo(null);
        return;
      }

      // Map logical coords to the actual pixel buffer coords
      const previewScale = activeResult.previewScale ?? 1;
      const bufX = Math.min(Math.floor(px * previewScale), activeResult.width - 1);
      const bufY = Math.min(Math.floor(py * previewScale), activeResult.height - 1);
      const idx = (bufY * activeResult.width + bufX) * 4;
      setPixelInfo({
        x: px,
        y: py,
        r: activeResult.pixels[idx],
        g: activeResult.pixels[idx + 1],
        b: activeResult.pixels[idx + 2],
        a: activeResult.pixels[idx + 3],
      });
    },
    [activeResult],
  );

  const handleCanvasMouseLeave = useCallback(() => {
    setPixelInfo(null);
  }, []);

  const handleResetDisplayControls = useCallback(() => {
    setGain(1);
    setGamma(1);
  }, []);

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
          {activeViewerId ? 'No output' : 'Add and select a Viewer node'}
        </div>
      )}
      
      {lastError && (
        <div style={{
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
        }}>
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
          <span className="viewer-pixel-inspector__channel viewer-pixel-inspector__channel--r">R: {pixelInfo.r} ({srgbToLinear(pixelInfo.r).toFixed(3)})</span>
          <span className="viewer-pixel-inspector__channel viewer-pixel-inspector__channel--g">G: {pixelInfo.g} ({srgbToLinear(pixelInfo.g).toFixed(3)})</span>
          <span className="viewer-pixel-inspector__channel viewer-pixel-inspector__channel--b">B: {pixelInfo.b} ({srgbToLinear(pixelInfo.b).toFixed(3)})</span>
          <span className="viewer-pixel-inspector__channel viewer-pixel-inspector__channel--a">A: {pixelInfo.a} ({(pixelInfo.a / 255).toFixed(3)})</span>
        </div>
      )}
    </section>
  );
};
