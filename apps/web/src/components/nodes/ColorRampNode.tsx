import React, { useState, useRef, useEffect, useCallback } from 'react';
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

  const stopsValue = params['stops'] ?? spec.params.find(p => p.key === 'stops')?.default;
  const stops: ColorStop[] = stopsValue && 'ColorRamp' in stopsValue
    ? (stopsValue as { ColorRamp: ColorStop[] }).ColorRamp
    : [{ position: 0, color: [0, 0, 0, 1] }, { position: 1, color: [1, 1, 1, 1] }];

  const interpValue = params['interpolation'] ?? spec.params.find(p => p.key === 'interpolation')?.default;
  const interpolation = interpValue ? Number(extractParamValue(interpValue)) : 0;

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const sortedForGradient = [...stops].sort((a, b) => a.position - b.position);
  const gradientCSS = `linear-gradient(to right, ${
    sortedForGradient.map(s => {
      const [r, g, b, a] = s.color;
      return `rgba(${floatToByte(r)},${floatToByte(g)},${floatToByte(b)},${a}) ${s.position * 100}%`;
    }).join(', ')
  })`;

  const updateStops = useCallback((newStops: ColorStop[]) => {
    setParam(props.id, 'stops', { ColorRamp: newStops });
  }, [props.id, setParam]);

  const handleBarClick = useCallback((e: React.MouseEvent) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newColor = interpolateColorAt(stops, x);
    const newStops = [...stops, { position: x, color: newColor }];
    updateStops(newStops);
    setSelectedIdx(newStops.length - 1);
  }, [stops, updateStops]);

  const handleStopMouseDown = useCallback((e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedIdx(idx);
    setDraggingIdx(idx);
  }, []);

  const updateStopPosition = useCallback((idx: number, newPos: number) => {
    const updated = [...stops];
    updated[idx] = { ...updated[idx], position: newPos };
    updateStops(updated);
  }, [stops, updateStops]);

  useEffect(() => {
    if (draggingIdx === null) return;
    const onMove = (e: MouseEvent) => {
      if (barRef.current) {
        const rect = barRef.current.getBoundingClientRect();
        updateStopPosition(draggingIdx, Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
      }
    };
    const onUp = () => setDraggingIdx(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingIdx, updateStopPosition]);

  const handleDelete = useCallback(() => {
    if (selectedIdx !== null && stops.length > 2) {
      updateStops(stops.filter((_, i) => i !== selectedIdx));
      setSelectedIdx(null);
    }
  }, [selectedIdx, stops, updateStops]);

  const handleColorChange = useCallback((hex: string) => {
    if (selectedIdx === null) return;
    const updated = [...stops];
    updated[selectedIdx] = { ...updated[selectedIdx], color: hexToFloat(hex, updated[selectedIdx].color[3]) };
    updateStops(updated);
  }, [selectedIdx, stops, updateStops]);

  const selectedStop = selectedIdx !== null && selectedIdx < stops.length ? stops[selectedIdx] : null;

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
            ref={barRef}
            onClick={handleBarClick}
            className="node-color-ramp__bar"
            role="button"
            tabIndex={0}
            onKeyDown={() => {}}
            style={{ background: gradientCSS }}
          />

          <div className="node-color-ramp__stops">
            {stops.map((stop, i) => (
              <div
                key={i}
                onMouseDown={(e) => handleStopMouseDown(e, i)}
                className={`node-color-ramp__stop${selectedIdx === i ? ' node-color-ramp__stop--selected' : ''}`}
                style={{
                  left: `${stop.position * 100}%`,
                  borderBottomColor: selectedIdx === i ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  borderBottomWidth: '8px',
                  borderBottomStyle: 'solid',
                }}
              />
            ))}
          </div>
        </NodeSection>

        {selectedStop && (
          <div className="node-color-ramp__editor">
            <div
              className="node-color-swatch"
              style={{
                background: `rgba(${floatToByte(selectedStop.color[0])},${floatToByte(selectedStop.color[1])},${floatToByte(selectedStop.color[2])},1)`,
              }}
            >
              <input
                type="color"
                value={colorToHex(selectedStop.color)}
                onChange={(e) => handleColorChange(e.target.value)}
                className="node-color-swatch__input"
              />
            </div>

            <span className="node-color-swatch__position">
              {selectedStop.position.toFixed(3)}
            </span>

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
