import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { NodeDropdown, NodeButton, NodeSection } from './NodePrimitives';
import { getNodeIcon } from './nodeIcons';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue, ColorStop } from '../../store/types';
import { extractParamValue, createParamValue } from '../../store/types';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
};

const floatToByte = (v: number) => Math.min(255, Math.max(0, Math.round(v * 255)));

const colorToHex = (c: [number, number, number, number]): string => {
  const toHex = (v: number) => floatToByte(v).toString(16).padStart(2, '0');
  return `#${toHex(c[0])}${toHex(c[1])}${toHex(c[2])}`;
};

const hexToFloat = (hex: string, alpha: number): [number, number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
  alpha,
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const DEFAULT_STOPS: ColorStop[] = [
  { position: 0, color: [0, 0, 0, 1] },
  { position: 1, color: [1, 1, 1, 1] },
];

const interpolateColorAt = (stops: ColorStop[], pos: number): [number, number, number, number] => {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  if (pos <= sorted[0].position) return sorted[0].color;
  if (pos >= sorted[sorted.length - 1].position) return sorted[sorted.length - 1].color;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (pos >= sorted[i].position && pos <= sorted[i + 1].position) {
      const t = (pos - sorted[i].position) / (sorted[i + 1].position - sorted[i].position);
      return [
        lerp(sorted[i].color[0], sorted[i + 1].color[0], t),
        lerp(sorted[i].color[1], sorted[i + 1].color[1], t),
        lerp(sorted[i].color[2], sorted[i + 1].color[2], t),
        lerp(sorted[i].color[3], sorted[i + 1].color[3], t),
      ];
    }
  }
  return sorted[0].color;
};

export const ColorRampNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { spec, params } = data;
  const setParam = useGraphStore(s => s.setParam);
  const setParamLive = useGraphStore(s => s.setParamLive);
  const setParamCommit = useGraphStore(s => s.setParamCommit);

  const storeStopsValue = useGraphStore(s => {
    const node = s.nodes.get(props.id);
    return node?.params['stops'];
  });
  const stopsValue = storeStopsValue ?? spec.params.find(p => p.key === 'stops')?.default;
  const stops: ColorStop[] = useMemo(() => {
    if (stopsValue && typeof stopsValue === 'object' && 'ColorRamp' in stopsValue) {
      return (stopsValue as { ColorRamp: ColorStop[] }).ColorRamp;
    }
    return DEFAULT_STOPS;
  }, [stopsValue]);

  // NEW: Local state for smooth dragging
  const [localStops, setLocalStops] = useState<ColorStop[] | null>(null);
  const displayStops = localStops ?? stops;
  const pendingLiveSyncRef = useRef<number | null>(null);

  const interpValue = params['interpolation'] ?? spec.params.find(p => p.key === 'interpolation')?.default;
  const interpolation = interpValue ? Number(extractParamValue(interpValue)) : 0;

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // Track the pointer ID that initiated the drag
  const dragPointerIdRef = useRef<number | null>(null);

  const gradientCSS = useMemo(() => {
    const sorted = [...displayStops].sort((a, b) => a.position - b.position);
    if (interpolation === 1) {
      // Constant: each stop holds its color until the next stop begins
      const parts: string[] = [];
      for (let i = 0; i < sorted.length; i++) {
        const [r, g, b, a] = sorted[i].color;
        const rgba = `rgba(${floatToByte(r)},${floatToByte(g)},${floatToByte(b)},${a})`;
        const from = sorted[i].position * 100;
        const to = i < sorted.length - 1 ? sorted[i + 1].position * 100 : 100;
        parts.push(`${rgba} ${from}%`, `${rgba} ${to}%`);
      }
      return `linear-gradient(to right, ${parts.join(', ')})`;
    }
    return `linear-gradient(to right, ${
      sorted.map(s => {
        const [r, g, b, a] = s.color;
        return `rgba(${floatToByte(r)},${floatToByte(g)},${floatToByte(b)},${a}) ${s.position * 100}%`;
      }).join(', ')
    })`;
  }, [displayStops, interpolation]);

  const updateStops = useCallback((newStops: ColorStop[]) => {
    setParam(props.id, 'stops', { ColorRamp: newStops } as ParamValue);
  }, [props.id, setParam]);

  // Throttled sync effect
  useEffect(() => {
      if (localStops === null || draggingIdx === null) return;
      
      if (pendingLiveSyncRef.current !== null) return; // already scheduled
      
      pendingLiveSyncRef.current = requestAnimationFrame(() => {
          pendingLiveSyncRef.current = null;
          setParamLive(props.id, 'stops', { ColorRamp: localStops } as ParamValue);
      });
      
      return () => {
          if (pendingLiveSyncRef.current !== null) {
              cancelAnimationFrame(pendingLiveSyncRef.current);
              pendingLiveSyncRef.current = null;
          }
      };
  }, [localStops, draggingIdx, props.id, setParamLive]);

  const updateStopsCommit = useCallback((newStops: ColorStop[]) => {
    setParamCommit(props.id, 'stops', { ColorRamp: newStops } as ParamValue);
  }, [props.id, setParamCommit]);

  // Track whether a drag just finished so we can suppress the click on the bar
  const justDraggedRef = useRef(false);

  const handleBarClick = useCallback((e: React.MouseEvent) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newColor = interpolateColorAt(stops, x);
    const newStops: ColorStop[] = [...stops, { position: x, color: newColor }];
    updateStops(newStops);
    setSelectedIdx(newStops.length - 1);
  }, [stops, updateStops]);

  const handleStopPointerDown = useCallback((e: React.PointerEvent, idx: number) => {
    // Prevent React Flow from starting node drag
    e.stopPropagation();
    e.preventDefault();
    
    if (barRef.current) {
      barRef.current.setPointerCapture(e.pointerId);
      dragPointerIdRef.current = e.pointerId;
    }
    
    setLocalStops([...stops]);
    setSelectedIdx(idx);
    setDraggingIdx(idx);
    justDraggedRef.current = true;
  }, [stops]);

  const handleBarPointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingIdx === null || !barRef.current) return;
    
    const rect = barRef.current.getBoundingClientRect();
    const newPos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    
    setLocalStops(prev => {
        if (!prev) return prev;
        const updated = [...prev];
        updated[draggingIdx] = { ...updated[draggingIdx], position: newPos };
        return updated;
    });
    
    justDraggedRef.current = true;
  }, [draggingIdx]);

  const handleBarPointerUp = useCallback((_e: React.PointerEvent) => {
    if (draggingIdx !== null) {
      if (barRef.current && dragPointerIdRef.current !== null) {
        barRef.current.releasePointerCapture(dragPointerIdRef.current);
        dragPointerIdRef.current = null;
      }
      
      if (localStops) {
          updateStopsCommit(localStops);
      }
      
      setLocalStops(null);
      setDraggingIdx(null);
    }
  }, [draggingIdx, localStops, updateStopsCommit]);

  const handleDelete = useCallback(() => {
    if (selectedIdx !== null && stops.length > 2) {
      updateStops(stops.filter((_, i) => i !== selectedIdx));
      setSelectedIdx(null);
    }
  }, [selectedIdx, stops, updateStops]);

  const handleColorInput = useCallback((hex: string) => {
    if (selectedIdx === null) return;
    const updated: ColorStop[] = [...stops];
    updated[selectedIdx] = { ...updated[selectedIdx], color: hexToFloat(hex, updated[selectedIdx].color[3]) };
    setParamLive(props.id, 'stops', { ColorRamp: updated } as ParamValue);
  }, [selectedIdx, stops, props.id, setParamLive]);

  const handleColorCommit = useCallback((hex: string) => {
    if (selectedIdx === null) return;
    const updated: ColorStop[] = [...stops];
    updated[selectedIdx] = { ...updated[selectedIdx], color: hexToFloat(hex, updated[selectedIdx].color[3]) };
    const value = { ColorRamp: updated } as ParamValue;
    setParamLive(props.id, 'stops', value);
    setParamCommit(props.id, 'stops', value);
  }, [selectedIdx, stops, props.id, setParamLive, setParamCommit]);

  const selectedStop = selectedIdx !== null && selectedIdx < displayStops.length ? displayStops[selectedIdx] : null;

  const interpOptions = spec.params.find(p => p.key === 'interpolation');
  const dropdownData = interpOptions?.ui_hint.type === 'Dropdown' ? interpOptions.ui_hint.data : ['Linear', 'Constant'];

  return (
    <BaseNode {...props} data={data} minWidth="280px" maxWidth="320px" headerIcon={getNodeIcon('color_ramp', 'Color')}>
      <div
        className="nopan nodrag nowheel"
        style={{ userSelect: 'none' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <NodeSection>
          <NodeDropdown
            label="Interpolation"
            value={interpolation}
            options={dropdownData}
            onChange={(v) => setParam(props.id, 'interpolation', createParamValue('Int', v))}
          />
        </NodeSection>

        <NodeSection spaced>
          <div
            className="node-color-ramp__bar"
            ref={barRef}
            onClick={handleBarClick}
            onPointerMove={handleBarPointerMove}
            onPointerUp={handleBarPointerUp}
            role="button"
            tabIndex={0}
            onKeyDown={() => {}}
          >
            <div
              className="node-color-ramp__gradient"
              style={{
                background: gradientCSS,
                pointerEvents: 'none',
              }}
            />
          </div>

          <div className="node-color-ramp__stops" style={{ pointerEvents: 'none' }}>
            {displayStops.map((stop, i) => (
              <div
                key={i}
                onPointerDown={(e) => handleStopPointerDown(e, i)}
                className={`node-color-ramp__stop${selectedIdx === i ? ' node-color-ramp__stop--selected' : ''}`}
                style={{
                  left: `${stop.position * 100}%`,
                  pointerEvents: 'auto',
                }}
              >
                <div
                  className="node-color-ramp__stop-handle"
                  style={{
                    color: colorToHex(stop.color)
                  }}
                />
              </div>
            ))}
          </div>
        </NodeSection>

        {selectedStop && (
          <div className="node-color-ramp__editor">
            <div className="node-color-swatch">
              <div
                className="node-color-swatch__preview"
                style={{
                  // eslint-disable-next-line compositor-theme/no-hardcoded-colors
                  background: `rgba(${floatToByte(selectedStop.color[0])},${floatToByte(selectedStop.color[1])},${floatToByte(selectedStop.color[2])},1)`,
                }}
              />
              <input
                type="color"
                value={colorToHex(selectedStop.color)}
                onInput={(e) => handleColorInput((e.target as HTMLInputElement).value)}
                onChange={(e) => handleColorCommit(e.target.value)}
                className="node-color-swatch__input"
              />
            </div>

            <div className="node-color-swatch__position">
              {selectedStop.position.toFixed(3)}
            </div>

            <NodeButton
              onClick={handleDelete}
              disabled={stops.length <= 2}
              variant="secondary"
              icon
              title={stops.length <= 2 ? 'Minimum 2 stops' : 'Delete stop'}
            >
              ×
            </NodeButton>
          </div>
        )}
      </div>
    </BaseNode>
  );
};
