import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { linearToHex, hexToLinear, linearToSrgbByte } from './nodes/colorUtils';

export interface ColorStop {
  position: number;
  color: [number, number, number, number];
}

interface ColorRampEditorProps {
  stops: ColorStop[];
  onChange: (stops: ColorStop[]) => void;
}


const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const interpolateColor = (stops: ColorStop[], position: number): [number, number, number, number] => {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  
  if (position <= sorted[0].position) return sorted[0].color;
  if (position >= sorted[sorted.length - 1].position) return sorted[sorted.length - 1].color;

  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    if (position >= curr.position && position <= next.position) {
      const t = (position - curr.position) / (next.position - curr.position);
      return [
        lerp(curr.color[0], next.color[0], t),
        lerp(curr.color[1], next.color[1], t),
        lerp(curr.color[2], next.color[2], t),
        lerp(curr.color[3], next.color[3], t),
      ];
    }
  }
  return sorted[0].color;
};

export const ColorRampEditor: React.FC<ColorRampEditorProps> = ({ stops, onChange }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const safeStops = useMemo(() => (
    stops.length >= 2
      ? stops
      : [
        { position: 0, color: [0, 0, 0, 1] },
        { position: 1, color: [1, 1, 1, 1] }
      ] as ColorStop[]
  ), [stops]);

  const sortedStopsForGradient = useMemo(
    () => [...safeStops].sort((a, b) => a.position - b.position),
    [safeStops]
  );
  const gradientCSS = useMemo(() => (
    `linear-gradient(to right, ${
      sortedStopsForGradient.map(s => {
        const [r, g, b, a] = s.color;
        return `rgba(${linearToSrgbByte(r)}, ${linearToSrgbByte(g)}, ${linearToSrgbByte(b)}, ${a}) ${s.position * 100}%`;
      }).join(', ')
    })`
  ), [sortedStopsForGradient]);

  const handleMouseDown = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setSelectedIndex(index);
    setDraggingIndex(index);
  };

  const handleBarClick = useCallback((e: React.MouseEvent) => {
    if (barRef.current) {
      const rect = barRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      
      const newColor = interpolateColor(safeStops, x);
      const newStop: ColorStop = { position: x, color: newColor };
      
      const newStops = [...safeStops, newStop];
      onChange(newStops);
      setSelectedIndex(newStops.length - 1);
    }
  }, [onChange, safeStops]);

  const updateStopPosition = useCallback((index: number, newPos: number) => {
    const updated = [...safeStops];
    updated[index] = { ...updated[index], position: newPos };
    onChange(updated);
  }, [safeStops, onChange]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingIndex !== null && barRef.current) {
        const rect = barRef.current.getBoundingClientRect();
        const rawPos = (e.clientX - rect.left) / rect.width;
        const newPos = Math.max(0, Math.min(1, rawPos));
        updateStopPosition(draggingIndex, newPos);
      }
    };

    const handleMouseUp = () => {
      setDraggingIndex(null);
    };

    if (draggingIndex !== null) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingIndex, updateStopPosition]);

  const handleDelete = useCallback(() => {
    if (selectedIndex !== null && safeStops.length > 2) {
      const newStops = safeStops.filter((_, i) => i !== selectedIndex);
      onChange(newStops);
      setSelectedIndex(null);
    }
  }, [onChange, safeStops, selectedIndex]);

  const handleColorChange = useCallback((hex: string) => {
    if (selectedIndex !== null) {
      const updated = [...safeStops];
      const oldAlpha = updated[selectedIndex].color[3];
      updated[selectedIndex] = {
        ...updated[selectedIndex],
        color: [...hexToLinear(hex), oldAlpha] as [number, number, number, number]
      };
      onChange(updated);
    }
  }, [onChange, safeStops, selectedIndex]);

  const selectedStop = selectedIndex !== null ? safeStops[selectedIndex] : null;

  return (
    <div style={{ width: '100%', userSelect: 'none' }}>
      <div 
        ref={barRef}
        onClick={handleBarClick}
        role="button"
        tabIndex={0}
        onKeyDown={() => {}}
        style={{
          width: '100%',
          height: '32px',
          borderRadius: '4px',
          background: gradientCSS,
          border: '1px solid var(--border-default)',
          position: 'relative',
          cursor: 'crosshair',
          marginBottom: '12px',
          outline: 'none'
        }}
      />

      <div style={{ 
        position: 'relative', 
        height: '16px', 
        width: '100%', 
        marginTop: '-12px',
        marginBottom: '16px'
      }}>
        {safeStops.map((stop, i) => (
          <div
            key={`${stop.position}-${stop.color.join('-')}-${i}`}
            onMouseDown={(e) => handleMouseDown(e, i)}
            role="slider"
            aria-valuenow={stop.position}
            tabIndex={0}
            style={{
              position: 'absolute',
              left: `${stop.position * 100}%`,
              top: '0',
              transform: 'translateX(-50%)',
              width: '10px',
              height: '10px',
              backgroundColor: 'var(--bg-primary)',
              border: `2px solid ${selectedIndex === i ? 'var(--accent-primary)' : 'var(--text-secondary)'}`,
              borderRadius: '50%',
              cursor: 'grab',
              zIndex: selectedIndex === i ? 10 : 1,
              boxShadow: 'var(--shadow-md)',
              outline: 'none'
            }}
          />
        ))}
      </div>

      {selectedStop && (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          padding: '8px',
          background: 'var(--bg-secondary)',
          borderRadius: '4px',
          border: '1px solid var(--border-default)',
          fontSize: '0.8rem'
        }}>
          <div style={{ 
            position: 'relative', 
            width: '24px', 
            height: '24px', 
            borderRadius: '3px',
            overflow: 'hidden',
            border: '1px solid var(--border-default)',
            // eslint-disable-next-line compositor-theme/no-hardcoded-colors
            background: `rgba(${linearToSrgbByte(selectedStop.color[0])}, ${linearToSrgbByte(selectedStop.color[1])}, ${linearToSrgbByte(selectedStop.color[2])}, 1)`
          }}>
            <input
              type="color"
              value={linearToHex(selectedStop.color[0], selectedStop.color[1], selectedStop.color[2])}
              onChange={(e) => handleColorChange(e.target.value)}
              style={{
                opacity: 0,
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                cursor: 'pointer'
              }}
            />
          </div>

          <div style={{ 
            color: 'var(--text-secondary)',
            fontFamily: 'monospace',
            flex: 1
          }}>
            Pos: {selectedStop.position.toFixed(3)}
          </div>

          <button
            type="button"
            onClick={handleDelete}
            disabled={safeStops.length <= 2}
            style={{
              background: 'transparent',
              border: 'none',
              color: safeStops.length <= 2 ? 'var(--text-muted)' : 'var(--text-secondary)',
              cursor: safeStops.length <= 2 ? 'not-allowed' : 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.2rem',
              lineHeight: 1
            }}
            title={safeStops.length <= 2 ? "Minimum 2 stops required" : "Delete Stop"}
          >
            ×
          </button>
        </div>
      )}
      
      {!selectedStop && (
        <div style={{ 
          height: '42px',
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.8rem',
          fontStyle: 'italic'
        }}>
          Select a stop to edit
        </div>
      )}
    </div>
  );
};
