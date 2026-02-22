import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { useGraphStore } from '../store/graphStore';
import { ViewerToolbar } from './ViewerToolbar';

export const Viewer: React.FC = () => {
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

  const selectedNodeId = selectedNodeIds.size > 0 ? Array.from(selectedNodeIds).pop()! : null;

  useEffect(() => {
    // If user selected a viewer node, switch to it
    if (selectedNodeId) {
      const node = nodes.get(selectedNodeId);
      if (node && node.typeId === 'viewer') {
        setActiveViewerId(selectedNodeId);
        return;
      }
    }
    // If no viewer is active yet, pick any viewer node that exists
    // (handles the case where a viewer is created while another node is selected)
    if (!activeViewerId) {
      const viewerNode = Array.from(nodes.values()).find(n => n.typeId === 'viewer');
      if (viewerNode) {
        setActiveViewerId(viewerNode.id);
      }
    }
    // If active viewer was deleted, clear it so we pick a new one next render
    if (activeViewerId && !nodes.has(activeViewerId)) {
      setActiveViewerId(null);
    }
  }, [selectedNodeId, nodes, activeViewerId]);

  const activeResult = useMemo(() => {
    return activeViewerId ? renderResults.get(activeViewerId) : undefined;
  }, [renderResults, activeViewerId]);

  const hasResult = !!activeResult;

  const dimensions = useMemo(() => {
    if (!activeResult) return null;
    const scale = activeResult.previewScale ?? 1;
    return {
      w: Math.max(1, Math.round(activeResult.width / scale)),
      h: Math.max(1, Math.round(activeResult.height / scale)),
    };
  }, [activeResult]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!activeResult || !canvas) {
      return;
    }

    const previewScale = activeResult.previewScale ?? 1;
    previewScaleRef.current = previewScale;
    const logicalWidth = Math.max(1, Math.round(activeResult.width / previewScale));
    const logicalHeight = Math.max(1, Math.round(activeResult.height / previewScale));
    const prevDimensions = dimensionsRef.current;

    if (canvas.width !== activeResult.width || canvas.height !== activeResult.height) {
      canvas.width = activeResult.width;
      canvas.height = activeResult.height;
      imageDataRef.current = null;
    }

    const dimsChanged = !prevDimensions || prevDimensions.w !== logicalWidth || prevDimensions.h !== logicalHeight;
    dimensionsRef.current = { w: logicalWidth, h: logicalHeight };

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let imgData = imageDataRef.current;
    if (!imgData || imgData.width !== activeResult.width || imgData.height !== activeResult.height) {
      imgData = new ImageData(activeResult.width, activeResult.height);
      imageDataRef.current = imgData;
    }
    imgData.data.set(activeResult.pixels);
    ctx.putImageData(imgData, 0, 0);

    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
    canvas.style.imageRendering = previewScale < 1 ? 'pixelated' : 'auto';

    if (dimsChanged) {
      setTimeout(() => fitToView(), 0);
    }
  }, [activeResult, fitToView]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
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

  return (
    <div 
      className="panel" 
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', outline: 'none' }}
      ref={containerRef}
      tabIndex={0}
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
        {(utils) => (
          <>
            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              wrapperProps={{
                onDoubleClick: () => {
                  const fitScale = computeFitScale();
                  const currentScale = transformRef.current?.state.scale ?? 1;
                  // If close to fit scale, go to 1:1; otherwise fit
                  if (Math.abs(currentScale - fitScale) < 0.01) {
                    transformRef.current?.centerView(1);
                  } else {
                    fitToView();
                  }
                },
              }}
            >
              <div 
                className="viewer-checkerboard"
                style={{
                    display: hasResult ? 'flex' : 'none',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 'fit-content',
                    height: 'fit-content',
                }}
              >
                <canvas
                  ref={canvasRef}
                  data-viewer-canvas
                  style={{
                    display: 'block',
                    imageRendering: 'auto',
                  }}
                />
              </div>
            </TransformComponent>
            
            <ViewerToolbar 
                zoomIn={() => utils.zoomIn(0.5)}
                zoomOut={() => utils.zoomOut(0.5)}
                fitToView={fitToView}
                setActualPixels={() => utils.centerView(1)}
                setZoomLevel={(scale) => utils.centerView(scale)}
                zoomPercent={zoomPercent}
            />
          </>
        )}
      </TransformWrapper>
      
      {dimensions && hasResult && (
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
            background: 'rgba(0,0,0,0.45)',
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
              color: '#fff',
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
          {lastError}
        </div>
      )}
    </div>
  );
};
