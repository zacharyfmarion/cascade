import React, { useCallback, useRef, useState } from 'react';

interface NodeSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Called on every drag tick — should be cheap (no undo snapshot). */
  onChange: (value: number) => void;
  /** Called once when drag ends — safe to push undo + full re-render. */
  onChangeCommit?: (value: number) => void;
}

export const NodeSlider: React.FC<NodeSliderProps> = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onChangeCommit,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; value: number } | null>(null);
  const hasDraggedRef = useRef(false);
  const lastEmittedRef = useRef<number>(value);

  const range = max - min;
  const fillRatio = range > 0 ? Math.max(0, Math.min(1, (value - min) / range)) : 0;

  const snap = useCallback(
    (v: number): number => (step > 0 ? Math.round(v / step) * step : v),
    [step]
  );

  const clamp = useCallback(
    (v: number): number => Math.max(min, Math.min(max, v)),
    [min, max]
  );

  const formatValue = useCallback(
    (v: number): string => {
      if (step >= 1) return v.toFixed(0);
      if (step >= 0.1) return v.toFixed(1);
      return v.toFixed(2);
    },
    [step]
  );

  // Use onPointerDown — React Flow listens to pointer events for drag,
  // so we must capture at the pointer level to prevent node dragging.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || isEditing) return;
      e.stopPropagation();
      e.preventDefault();

      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      dragStartRef.current = { x: e.clientX, value };
      hasDraggedRef.current = false;
      lastEmittedRef.current = value;
      setIsDragging(true);
    },
    [value, isEditing]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragStartRef.current || !containerRef.current) return;
      e.stopPropagation();

      const deltaX = e.clientX - dragStartRef.current.x;
      if (Math.abs(deltaX) > 2) {
        hasDraggedRef.current = true;
      }

      const width = containerRef.current.offsetWidth;
      const sensitivity = e.shiftKey ? 0.1 : 1.0;
      const deltaValue = (deltaX / width) * range * sensitivity;
      const newValue = clamp(snap(dragStartRef.current.value + deltaValue));

      if (newValue !== lastEmittedRef.current) {
        lastEmittedRef.current = newValue;
        onChange(newValue);
      }
    },
    [range, clamp, snap, onChange]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragStartRef.current) return;
      e.stopPropagation();
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);

      setIsDragging(false);

      if (!hasDraggedRef.current) {
        setEditText(formatValue(value));
        setIsEditing(true);
      } else if (onChangeCommit) {
        onChangeCommit(lastEmittedRef.current);
      }

      dragStartRef.current = null;
    },
    [value, formatValue, onChangeCommit]
  );

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        const parsed = parseFloat(editText);
        if (!isNaN(parsed)) {
          const final = clamp(snap(parsed));
          if (onChangeCommit) {
            onChangeCommit(final);
          } else {
            onChange(final);
          }
        }
        setIsEditing(false);
      } else if (e.key === 'Escape') {
        setIsEditing(false);
      }
      e.stopPropagation();
    },
    [editText, onChange, onChangeCommit, clamp, snap]
  );

  const handleEditBlur = useCallback(() => {
    const parsed = parseFloat(editText);
    if (!isNaN(parsed)) {
      const final = clamp(snap(parsed));
      if (onChangeCommit) {
        onChangeCommit(final);
      } else {
        onChange(final);
      }
    }
    setIsEditing(false);
  }, [editText, onChange, onChangeCommit, clamp, snap]);

  return (
    <div
      ref={containerRef}
      className={`node-slider nopan nodrag nowheel ${isDragging ? 'node-slider--dragging' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
    >
      {isEditing ? (
        <input
          type="text"
          className="node-slider__input nopan nodrag nowheel"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={handleEditKeyDown}
          onBlur={handleEditBlur}
          onPointerDown={(e) => e.stopPropagation()}
          ref={(el) => el?.focus()}
        />
      ) : (
        <>
          <div
            className="node-slider__fill"
            style={{ width: `${fillRatio * 100}%` }}
          />
          {/* Base text layer — visible in the unfilled area */}
          <div className="node-slider__content">
            <span className="node-slider__label">{label}</span>
            <span className="node-slider__value">{formatValue(value)}</span>
          </div>
          {/* Bright text layer — clipped to the filled area */}
          <div
            className="node-slider__content node-slider__content--filled"
            style={{ clipPath: `inset(0 ${(1 - fillRatio) * 100}% 0 0)` }}
          >
            <span className="node-slider__label">{label}</span>
            <span className="node-slider__value">{formatValue(value)}</span>
          </div>
        </>
      )}
    </div>
  );
};
