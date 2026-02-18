import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { CurvePoint } from '../../store/types';

const CHANNEL_COLORS: Record<string, string> = {
  master: 'var(--text-primary)',
  red: '#FF4444',
  green: '#44DD44',
  blue: '#4488FF',
};

interface CurveEditorProps {
  points: CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
  onChangeLive?: (points: CurvePoint[]) => void;
  onChangeCommit?: (points: CurvePoint[]) => void;
  channel?: string;
  width?: number;
  height?: number;
}

/** Monotone cubic Hermite interpolation (Fritsch-Carlson) — mirrors the Rust LUT builder. */
function evaluateMonotoneCubic(points: CurvePoint[], x: number): number {
  if (points.length === 0) return x;
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const n = sorted.length;

  if (n === 1) return sorted[0].y;

  if (x <= sorted[0].x) {
    if (n < 2) return sorted[0].y;
    const slope = (sorted[1].y - sorted[0].y) / (sorted[1].x - sorted[0].x || 1);
    return sorted[0].y + slope * (x - sorted[0].x);
  }
  if (x >= sorted[n - 1].x) {
    if (n < 2) return sorted[n - 1].y;
    const slope = (sorted[n - 1].y - sorted[n - 2].y) / (sorted[n - 1].x - sorted[n - 2].x || 1);
    return sorted[n - 1].y + slope * (x - sorted[n - 1].x);
  }

  if (n === 2) {
    const t = (x - sorted[0].x) / (sorted[1].x - sorted[0].x || 1);
    return sorted[0].y + (sorted[1].y - sorted[0].y) * t;
  }

  const deltas: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    const dx = sorted[k + 1].x - sorted[k].x;
    deltas.push(dx < 1e-12 ? 0 : (sorted[k + 1].y - sorted[k].y) / dx);
  }

  const tangents: number[] = new Array(n);
  tangents[0] = deltas[0];
  tangents[n - 1] = deltas[n - 2];
  for (let k = 1; k < n - 1; k++) {
    tangents[k] = (deltas[k - 1] + deltas[k]) / 2;
  }

  for (let k = 0; k < n - 1; k++) {
    if (Math.abs(deltas[k]) < 1e-12) {
      tangents[k] = 0;
      tangents[k + 1] = 0;
    } else {
      const alpha = tangents[k] / deltas[k];
      const beta = tangents[k + 1] / deltas[k];
      const sumSq = alpha * alpha + beta * beta;
      if (sumSq > 9) {
        const tau = 3 / Math.sqrt(sumSq);
        tangents[k] = tau * alpha * deltas[k];
        tangents[k + 1] = tau * beta * deltas[k];
      }
    }
  }

  let seg = 0;
  for (let k = 0; k < n - 1; k++) {
    if (x >= sorted[k].x && x <= sorted[k + 1].x) {
      seg = k;
      break;
    }
  }

  const dx = sorted[seg + 1].x - sorted[seg].x;
  if (dx < 1e-12) return sorted[seg].y;

  const t = (x - sorted[seg].x) / dx;
  const t2 = t * t;
  const t3 = t2 * t;

  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return h00 * sorted[seg].y + h10 * dx * tangents[seg] + h01 * sorted[seg + 1].y + h11 * dx * tangents[seg + 1];
}

export const CurveEditor: React.FC<CurveEditorProps> = ({
  points,
  onChange,
  onChangeLive,
  onChangeCommit,
  channel = 'master',
  width = 200,
  height = 200,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const pointsRef = useRef(points);
  useEffect(() => { pointsRef.current = points; }, [points]);

  // Suppress click-to-add after a drag completes
  const justDraggedRef = useRef(false);
  const dragPointerIdRef = useRef<number | null>(null);

  const pad = 8;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;
  const color = CHANNEL_COLORS[channel] ?? CHANNEL_COLORS.master;

  const toSvg = useCallback((p: CurvePoint) => ({
    x: pad + p.x * plotW,
    y: pad + (1 - p.y) * plotH,
  }), [plotW, plotH]);

  /** Convert screen pointer position to normalized [0,1] curve coords. */
  const pointerToNormalized = useCallback((clientX: number, clientY: number): CurvePoint => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;
    const renderedPadX = pad * scaleX;
    const renderedPadY = pad * scaleY;
    const renderedPlotW = rect.width - renderedPadX * 2;
    const renderedPlotH = rect.height - renderedPadY * 2;
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left - renderedPadX) / renderedPlotW)),
      y: Math.max(0, Math.min(1, 1 - (clientY - rect.top - renderedPadY) / renderedPlotH)),
    };
  }, [width, height]);

  const curvePath = useMemo(() => {
    const steps = 100;
    const sorted = [...points].sort((a, b) => a.x - b.x);
    if (sorted.length < 2) return '';
    const parts: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const x = i / steps;
      const y = evaluateMonotoneCubic(sorted, x);
      const sx = pad + x * plotW;
      const sy = pad + (1 - Math.max(0, Math.min(1, y))) * plotH;
      parts.push(`${i === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`);
    }
    return parts.join(' ');
  }, [points, plotW, plotH]);

  // Click on empty space → add point AND clear selection
  const handleSvgClick = useCallback((e: React.MouseEvent) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    setSelectedIdx(null); // Clear selection

    const pt = pointerToNormalized(e.clientX, e.clientY);
    const newPoints = [...points, pt].sort((a, b) => a.x - b.x);
    onChange(newPoints);
  }, [points, onChange, pointerToNormalized]);

  // PointerDown on a control point → start drag (capture on SVG)
  const handlePointPointerDown = useCallback((e: React.PointerEvent, idx: number) => {
    e.stopPropagation();
    e.preventDefault();
    if (svgRef.current) {
      svgRef.current.setPointerCapture(e.pointerId);
      dragPointerIdRef.current = e.pointerId;
      svgRef.current.focus(); // Ensure SVG gets focus for keyboard events
    }
    setDraggingIdx(idx);
    setSelectedIdx(idx);
    justDraggedRef.current = false;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingIdx === null) return;
    justDraggedRef.current = true;

    const pt = pointerToNormalized(e.clientX, e.clientY);
    const updated = [...pointsRef.current];

    // Endpoints: lock x to 0 or 1
    const sorted = [...updated].sort((a, b) => a.x - b.x);
    const sortedIdx = sorted.findIndex(p => p === updated[draggingIdx]);
    if (sortedIdx === 0) {
      pt.x = 0;
    } else if (sortedIdx === sorted.length - 1) {
      pt.x = 1;
    }

    updated[draggingIdx] = pt;
    if (onChangeLive) {
      onChangeLive(updated);
    }
  }, [draggingIdx, pointerToNormalized, onChangeLive]);

  const handlePointerUp = useCallback(() => {
    if (draggingIdx !== null) {
      if (svgRef.current && dragPointerIdRef.current !== null) {
        svgRef.current.releasePointerCapture(dragPointerIdRef.current);
        dragPointerIdRef.current = null;
      }
      const updated = [...pointsRef.current];
      if (onChangeCommit) {
        onChangeCommit(updated);
      }
      setDraggingIdx(null);
    }
  }, [draggingIdx, onChangeCommit]);

  const deletePoint = useCallback((idx: number) => {
    if (points.length <= 2) return;
    const sorted = [...points].sort((a, b) => a.x - b.x);
    const pt = points[idx];
    const sortedIdx = sorted.indexOf(pt);
    
    // Don't delete endpoints
    if (sortedIdx === 0 || sortedIdx === sorted.length - 1) return;

    const newPoints = points.filter((_, i) => i !== idx);
    onChange(newPoints);
    setSelectedIdx(null);
  }, [points, onChange]);

  const handlePointContextMenu = useCallback((e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    deletePoint(idx);
  }, [deletePoint]);

  const handlePointDoubleClick = useCallback((e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    deletePoint(idx);
  }, [deletePoint]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdx !== null) {
      e.preventDefault();
      deletePoint(selectedIdx);
    }
  }, [selectedIdx, deletePoint]);

  const gridLines = useMemo(() => {
    const lines: React.ReactElement[] = [];
    for (let i = 1; i <= 3; i++) {
      const frac = i * 0.25;
      const x = pad + frac * plotW;
      const y = pad + frac * plotH;
      lines.push(
        <line key={`v${i}`} x1={x} y1={pad} x2={x} y2={pad + plotH}
          stroke="var(--border-default)" strokeWidth="0.5" opacity="0.4" />,
        <line key={`h${i}`} x1={pad} y1={y} x2={pad + plotW} y2={y}
          stroke="var(--border-default)" strokeWidth="0.5" opacity="0.4" />
      );
    }
    return lines;
  }, [plotW, plotH]);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      tabIndex={0}
      style={{ cursor: draggingIdx !== null ? 'grabbing' : 'crosshair', display: 'block', outline: 'none' }}
      className="nopan nodrag nowheel"
      onClick={handleSvgClick}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      {/* Background */}
      <rect x={pad} y={pad} width={plotW} height={plotH}
        fill="var(--bg-primary)" rx="2" />

      {gridLines}

      <rect x={pad} y={pad} width={plotW} height={plotH}
        fill="none" stroke="var(--border-default)" strokeWidth="0.5" rx="2" />

      <line
        x1={pad} y1={pad + plotH}
        x2={pad + plotW} y2={pad}
        stroke="var(--text-muted)" strokeWidth="0.5" strokeDasharray="4 3" opacity="0.5"
      />

      {curvePath && (
        <path d={curvePath} fill="none" stroke={color} strokeWidth="2" />
      )}

      {points.map((pt, idx) => {
        const svgPt = toSvg(pt);
        const isActive = draggingIdx === idx;
        const isSelected = selectedIdx === idx;
        const isHovered = hoveredIdx === idx;
        const r = isActive || isSelected ? 6 : isHovered ? 5 : 4;
        
        return (
          <g key={idx}>
            {isSelected && (
              <circle
                cx={svgPt.x} cy={svgPt.y} r={9}
                fill="none"
                stroke={color}
                strokeOpacity="0.4"
                strokeWidth="2"
              />
            )}
            
            <circle
              cx={svgPt.x} cy={svgPt.y} r={r}
              fill={color}
              stroke="var(--border-default)"
              strokeWidth={isActive || isSelected ? 2 : 1}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => handlePointPointerDown(e, idx)}
              onPointerEnter={() => setHoveredIdx(idx)}
              onPointerLeave={() => setHoveredIdx(null)}
              onContextMenu={(e) => handlePointContextMenu(e, idx)}
              onDoubleClick={(e) => handlePointDoubleClick(e, idx)}
              onClick={(e) => e.stopPropagation()}
            />

            {/* Hover Coordinates (only if not dragging) */}
            {isHovered && !isActive && (
              <text
                x={svgPt.x}
                y={svgPt.y - 12}
                textAnchor="middle"
                fill="var(--text-secondary)"
                fontSize="9"
                pointerEvents="none"
              >
                {pt.x.toFixed(2)}, {pt.y.toFixed(2)}
              </text>
            )}

            {/* Drag Tooltip (when dragging) */}
            {isActive && (
               <g pointerEvents="none" transform={`translate(${svgPt.x}, ${svgPt.y - 28})`}>
                  <rect
                    x={-35} y={0} width={70} height={20} rx={4}
                    fill="var(--bg-secondary)"
                    stroke="var(--border-default)"
                    strokeWidth="1"
                    opacity="0.9"
                  />
                  <text
                    x={0} y={14}
                    textAnchor="middle"
                    fill="var(--text-primary)"
                    fontSize="10"
                    fontWeight="bold"
                  >
                    {pt.x.toFixed(2)}, {pt.y.toFixed(2)}
                  </text>
               </g>
            )}
          </g>
        );
      })}
    </svg>
  );
};
