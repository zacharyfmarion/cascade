import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Repeat,
} from 'lucide-react';

export const Timeline: React.FC = () => {
  const hasSequenceNodes = useGraphStore((s) => s.hasSequenceNodes);
  const currentFrame = useGraphStore((s) => s.currentFrame);
  const setCurrentFrame = useGraphStore((s) => s.setCurrentFrame);
  const sequenceLength = useGraphStore((s) => s.sequenceLength);
  const sequenceStart = useGraphStore((s) => s.sequenceStart);
  const isPlaying = useGraphStore((s) => s.isPlaying);
  const fps = useGraphStore((s) => s.fps);
  const loopPlayback = useGraphStore((s) => s.loopPlayback);

  const play = useGraphStore((s) => s.play);
  const pause = useGraphStore((s) => s.pause);
  const stepForward = useGraphStore((s) => s.stepForward);
  const stepBackward = useGraphStore((s) => s.stepBackward);
  const goToStart = useGraphStore((s) => s.goToStart);
  const goToEnd = useGraphStore((s) => s.goToEnd);
  const setFps = useGraphStore((s) => s.setFps);
  const setLoopPlayback = useGraphStore((s) => s.setLoopPlayback);

  const [isDragging, setIsDragging] = useState(false);
  const scrubberRef = useRef<HTMLDivElement>(null);

  const calculateFrame = useCallback(
    (clientX: number) => {
      if (!scrubberRef.current) return;
      const rect = scrubberRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const width = rect.width;
      const clampedX = Math.max(0, Math.min(x, width));
      const percentage = clampedX / width;

      const min = sequenceStart;
      const max = sequenceLength || 100;
      const range = max - min;
      const frame = Math.round(min + percentage * range);

      setCurrentFrame(frame);
    },
    [sequenceStart, sequenceLength, setCurrentFrame]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    calculateFrame(e.clientX);
  };

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        e.preventDefault();
        calculateFrame(e.clientX);
      }
    };

    const handleWindowMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('mouseup', handleWindowMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isDragging, calculateFrame]);

  if (!hasSequenceNodes) {
    return (
      <div
        className="timeline"
        style={{
          background: 'var(--bg-secondary)',
          height: '100%',
          flexShrink: 0,
        }}
      />
    );
  }

  const min = sequenceStart;
  const max = sequenceLength || 100;
  const progress =
    max > min ? Math.max(0, Math.min(1, (currentFrame - min) / (max - min))) : 0;

  const buttonStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    transition: 'background 0.1s, color 0.1s',
  };

  const activeButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    color: 'var(--accent-primary)',
    background: 'var(--bg-surface)',
  };

  return (
    <div
      className="timeline"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '0 16px',
        height: '100%',
        background: 'var(--bg-secondary)',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: '2px' }}>
        <button
          type="button"
          onClick={goToStart}
          style={buttonStyle}
          title="Go to Start"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <SkipBack size={16} />
        </button>
        <button
          type="button"
          onClick={stepBackward}
          style={buttonStyle}
          title="Previous Frame"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          onClick={isPlaying ? pause : play}
          style={{ ...buttonStyle, color: 'var(--text-primary)' }}
          title={isPlaying ? 'Pause' : 'Play'}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}
        </button>
        <button
          type="button"
          onClick={stepForward}
          style={buttonStyle}
          title="Next Frame"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          onClick={goToEnd}
          style={buttonStyle}
          title="Go to End"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <SkipForward size={16} />
        </button>
      </div>

      <div
        ref={scrubberRef}
        onMouseDown={handleMouseDown}
        role="slider"
        tabIndex={0}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={currentFrame}
        style={{
          flex: 1,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          position: 'relative',
          margin: '0 8px',
          outline: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: '4px',
            background: 'var(--bg-surface)',
            borderRadius: '2px',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: `${progress * 100}%`,
            height: '4px',
            background: 'var(--accent-primary)',
            borderRadius: '2px',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `${progress * 100}%`,
            top: '50%',
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            background: 'var(--accent-primary)',
            border: '2px solid var(--bg-secondary)',
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 4px rgba(0,0,0,0.3)',
            zIndex: 10,
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
        }}
      >
        <div
          style={{
            fontFamily: 'monospace',
            background: 'var(--bg-surface)',
            padding: '2px 6px',
            borderRadius: '4px',
            minWidth: '80px',
            textAlign: 'center',
          }}
        >
          <span style={{ color: 'var(--text-primary)' }}>{currentFrame}</span>
          <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>/</span>
          <span>{max}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <select
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: 'none',
              fontSize: '0.8rem',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {[12, 15, 24, 25, 30, 60].map((rate) => (
              <option key={rate} value={rate}>
                {rate} FPS
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => setLoopPlayback(!loopPlayback)}
          style={loopPlayback ? activeButtonStyle : buttonStyle}
          title="Toggle Loop"
          onMouseEnter={(e) => {
            if (!loopPlayback) e.currentTarget.style.background = 'var(--bg-surface)';
          }}
          onMouseLeave={(e) => {
            if (!loopPlayback) e.currentTarget.style.background = 'transparent';
          }}
        >
          <Repeat size={16} />
        </button>
      </div>
    </div>
  );
};
