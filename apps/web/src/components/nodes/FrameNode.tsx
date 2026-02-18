import React, { useState, useCallback, useRef, useEffect, memo } from 'react';
import { NodeResizer } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';

const FRAME_COLORS: Record<string, { bg: string; header: string; border: string }> = {
  purple: { bg: 'rgba(108, 92, 231, 0.08)', header: 'rgba(108, 92, 231, 0.22)', border: 'rgba(108, 92, 231, 0.3)' },
  blue:   { bg: 'rgba(60, 120, 220, 0.08)', header: 'rgba(60, 120, 220, 0.22)', border: 'rgba(60, 120, 220, 0.3)' },
  green:  { bg: 'rgba(46, 204, 113, 0.08)', header: 'rgba(46, 204, 113, 0.22)', border: 'rgba(46, 204, 113, 0.3)' },
  orange: { bg: 'rgba(230, 160, 40, 0.08)', header: 'rgba(230, 160, 40, 0.22)', border: 'rgba(230, 160, 40, 0.3)' },
  red:    { bg: 'rgba(231, 76, 60, 0.08)',  header: 'rgba(231, 76, 60, 0.22)',  border: 'rgba(231, 76, 60, 0.3)' },
  gray:   { bg: 'rgba(200, 200, 200, 0.06)', header: 'rgba(200, 200, 200, 0.15)', border: 'rgba(200, 200, 200, 0.2)' },
};

const DEFAULT_FRAME_COLOR = FRAME_COLORS.purple;

interface FrameNodeData {
  label: string;
  color: string;
  frameId: string;
  width: number;
  height: number;
  selected: boolean;
  dropTarget: boolean;
}

const FrameNodeComponent: React.FC<NodeProps> = ({ data, selected }) => {
  const frameData = data as unknown as FrameNodeData;
  const updateFrame = useGraphStore((state) => state.updateFrame);
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(frameData.label);
  const inputRef = useRef<HTMLInputElement>(null);

  const colors = FRAME_COLORS[frameData.color] ?? DEFAULT_FRAME_COLOR;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleResize = useCallback((_event: unknown, params: { width: number; height: number }) => {
    updateFrame(frameData.frameId, { size: { width: params.width, height: params.height } });
  }, [frameData.frameId, updateFrame]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditLabel(frameData.label);
  }, [frameData.label]);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    if (editLabel !== frameData.label) {
      updateFrame(frameData.frameId, { label: editLabel });
    }
  }, [editLabel, frameData.label, frameData.frameId, updateFrame]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditLabel(frameData.label);
    }
  }, [handleBlur, frameData.label]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditLabel(e.target.value);
  }, []);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        border: frameData.dropTarget
          ? `2px dashed ${colors.border.replace(/[\d.]+\)$/, '0.7)')}`
          : `1px solid ${selected ? 'var(--accent-primary)' : colors.border}`,
        borderRadius: 6,
        position: 'relative',
        backgroundColor: frameData.dropTarget
          ? colors.bg.replace(/[\d.]+\)$/, '0.15)')
          : colors.bg,
        transition: 'border-color 0.2s, background-color 0.2s, border-width 0.1s',
      }}
    >
      <NodeResizer
        minWidth={200}
        minHeight={150}
        isVisible={selected}
        lineStyle={{ border: '1px solid var(--accent-primary)' }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent-primary)' }}
        onResize={handleResize}
      />

      <div
        className="nopan"
        onDoubleClick={handleDoubleClick}
        style={{
          height: 28,
          backgroundColor: colors.header,
          borderTopLeftRadius: 5,
          borderTopRightRadius: 5,
          padding: '0 8px',
          display: 'flex',
          alignItems: 'center',
          color: 'var(--text-primary)',
          fontSize: '0.85rem',
          fontWeight: 600,
          cursor: 'grab',
        }}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editLabel}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            style={{
              width: '100%',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: 4,
              padding: '2px 4px',
              fontSize: 'inherit',
              fontWeight: 'inherit',
              outline: 'none',
            }}
          />
        ) : (
          <span style={{ cursor: 'text' }}>{frameData.label}</span>
        )}
      </div>
    </div>
  );
};

export const FrameNode = memo(FrameNodeComponent);
