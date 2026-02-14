import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import type { RenderResult } from '../store/types';

export const Viewer: React.FC = () => {
  const selectedNodeIds = useGraphStore(s => s.selectedNodeIds);
  const nodes = useGraphStore(s => s.nodes);
  const lastError = useGraphStore(s => s.lastError);

  const [activeViewerId, setActiveViewerId] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const previewScaleRef = useRef(1);
  const dimensionsRef = useRef<{ w: number; h: number } | null>(null);

  const applyCanvasScale = useCallback((
    container: HTMLDivElement,
    canvas: HTMLCanvasElement,
    logicalDimensions: { w: number; h: number },
    previewScale: number
  ) => {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw <= 0 || ch <= 0) return;
    const baseScale = Math.min(cw / logicalDimensions.w, ch / logicalDimensions.h);
    const effectiveScale = previewScale < 1 ? baseScale / previewScale : Math.min(baseScale, 1);
    const renderWidth = Math.round(logicalDimensions.w * previewScale);
    const renderHeight = Math.round(logicalDimensions.h * previewScale);
    canvas.style.width = `${Math.round(renderWidth * effectiveScale)}px`;
    canvas.style.height = `${Math.round(renderHeight * effectiveScale)}px`;
    canvas.style.imageRendering = previewScale < 1 ? 'pixelated' : 'auto';
  }, []);

  const selectedNodeId = selectedNodeIds.size > 0 ? Array.from(selectedNodeIds).pop()! : null;

  useEffect(() => {
    if (selectedNodeId) {
      const node = nodes.get(selectedNodeId);
      if (node && node.typeId === 'viewer') {
        setActiveViewerId(selectedNodeId);
      }
    } else if (!activeViewerId) {
      const viewerNode = Array.from(nodes.values()).find(n => n.typeId === 'viewer');
      if (viewerNode) {
        setActiveViewerId(viewerNode.id);
      }
    }
  }, [selectedNodeId, nodes, activeViewerId]);

  useEffect(() => {
    if (!activeViewerId) return;

    const paintFrame = (result: RenderResult | undefined) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!result || !canvas || !container) {
        setHasResult(false);
        return;
      }

      setHasResult(true);

      const previewScale = result.previewScale ?? 1;
      previewScaleRef.current = previewScale;
      const logicalWidth = Math.max(1, Math.round(result.width / previewScale));
      const logicalHeight = Math.max(1, Math.round(result.height / previewScale));
      const prevDimensions = dimensionsRef.current;

      if (canvas.width !== result.width || canvas.height !== result.height) {
        canvas.width = result.width;
        canvas.height = result.height;
        setDimensions({ w: logicalWidth, h: logicalHeight });
        imageDataRef.current = null;
      } else if (!prevDimensions || prevDimensions.w !== logicalWidth || prevDimensions.h !== logicalHeight) {
        setDimensions({ w: logicalWidth, h: logicalHeight });
      }

      dimensionsRef.current = { w: logicalWidth, h: logicalHeight };

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let imgData = imageDataRef.current;
      if (!imgData || imgData.width !== result.width || imgData.height !== result.height) {
        imgData = new ImageData(result.width, result.height);
        imageDataRef.current = imgData;
      }
      imgData.data.set(result.pixels);
      ctx.putImageData(imgData, 0, 0);

      applyCanvasScale(container, canvas, { w: logicalWidth, h: logicalHeight }, previewScale);
    };

    paintFrame(useGraphStore.getState().renderResults.get(activeViewerId));

    const unsub = useGraphStore.subscribe((state, prevState) => {
      if (state.renderResults !== prevState.renderResults) {
        paintFrame(state.renderResults.get(activeViewerId));
      }
    });

    return unsub;
  }, [activeViewerId, applyCanvasScale]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !dimensions) return;

    const observer = new ResizeObserver(() => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (cw > 0 && ch > 0 && dimensions) {
        applyCanvasScale(container, canvas, dimensions, previewScaleRef.current);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [dimensions, applyCanvasScale]);

  return (
    <div className="panel" style={{ width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{
          flex: 1,
          background: 'var(--bg-canvas)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {dimensions && (
          <div style={{
            position: 'absolute',
            top: 4,
            left: 6,
            fontSize: '0.65rem',
            color: 'var(--text-muted)',
            background: 'rgba(0,0,0,0.45)',
            padding: '1px 5px',
            borderRadius: 3,
            pointerEvents: 'none',
            zIndex: 1,
          }}>
            {dimensions.w}×{dimensions.h}
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{
            imageRendering: 'auto',
            display: hasResult ? 'block' : 'none',
          }}
        />
        {!hasResult && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '20px' }}>
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
          }}>
            {lastError}
          </div>
        )}
      </div>
    </div>
  );
};
