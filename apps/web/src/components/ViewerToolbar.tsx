import React, { useState, useRef, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react';
import type { ChannelMode } from './Viewer';

interface ViewerToolbarProps {
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
  setActualPixels: () => void;
  setZoomLevel: (scale: number) => void;
  zoomPercent: number;
  activeChannel: ChannelMode;
  onChannelChange: (channel: ChannelMode) => void;
  gain: number;
  onGainChange: (gain: number) => void;
  gamma: number;
  onGammaChange: (gamma: number) => void;
  onResetDisplayControls: () => void;
}

const CHANNELS: { key: 'r' | 'g' | 'b' | 'a'; label: string }[] = [
  { key: 'r', label: 'R' },
  { key: 'g', label: 'G' },
  { key: 'b', label: 'B' },
  { key: 'a', label: 'A' },
];

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  zoomIn,
  zoomOut,
  fitToView,
  setActualPixels,
  setZoomLevel,
  zoomPercent,
  activeChannel,
  onChannelChange,
  gain,
  onGainChange,
  gamma,
  onGammaChange,
  onResetDisplayControls,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  const handlePresetSelect = (percent: number) => {
    setZoomLevel(percent / 100);
    setIsDropdownOpen(false);
  };

  const presets = [25, 50, 100, 200, 400];
  const showResetButton = gain !== 1 || gamma !== 1;

  return (
    <div className="viewer-toolbar">
      {/* Zoom controls */}
      <button 
        type="button" 
        className="viewer-toolbar__btn" 
        onClick={zoomOut} 
        title="Zoom Out"
      >
        <ZoomOut size={14} />
      </button>

      <div 
        className="viewer-toolbar__zoom-display" 
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        role="button"
        tabIndex={0}
      >
        {zoomPercent}%
        {isDropdownOpen && (
          <div className="viewer-toolbar__dropdown" ref={dropdownRef}>
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                className="viewer-toolbar__dropdown-item"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePresetSelect(preset);
                }}
              >
                {preset}%
              </button>
            ))}
          </div>
        )}
      </div>

      <button 
        type="button" 
        className="viewer-toolbar__btn" 
        onClick={zoomIn} 
        title="Zoom In"
      >
        <ZoomIn size={14} />
      </button>

      <div className="viewer-toolbar__separator" />

      <button 
        type="button" 
        className="viewer-toolbar__btn" 
        onClick={fitToView} 
        title="Fit to View"
      >
        <Maximize2 size={14} />
      </button>

      <button 
        type="button" 
        className="viewer-toolbar__btn" 
        onClick={setActualPixels} 
        title="Actual Pixels"
      >
        1:1
      </button>

      <div className="viewer-toolbar__separator" />

      {/* Channel isolation buttons */}
      {CHANNELS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          className={`viewer-toolbar__channel-btn viewer-toolbar__channel-btn--${key}${activeChannel === key ? ' viewer-toolbar__channel-btn--active' : ''}`}
          onClick={() => onChannelChange(activeChannel === key ? null : key)}
          title={`Solo ${label} channel (${key})`}
          data-testid={`channel-btn-${key}`}
        >
          {label}
        </button>
      ))}

      <div className="viewer-toolbar__separator" />

      {/* Gain control */}
      <label className="viewer-toolbar__slider-group" title={`Gain: ${gain.toFixed(2)}x`}>
        <span className="viewer-toolbar__slider-label">Exp</span>
        <input
          type="range"
          className="viewer-toolbar__slider"
          min={-3}
          max={3}
          step={0.05}
          value={Math.log2(gain)}
          onChange={(e) => onGainChange(Math.pow(2, parseFloat(e.target.value)))}
          data-testid="gain-slider"
        />
      </label>

      {/* Gamma control */}
      <label className="viewer-toolbar__slider-group" title={`Gamma: ${gamma.toFixed(2)}`}>
        <span className="viewer-toolbar__slider-label">Gam</span>
        <input
          type="range"
          className="viewer-toolbar__slider"
          min={0.1}
          max={4.0}
          step={0.05}
          value={gamma}
          onChange={(e) => onGammaChange(parseFloat(e.target.value))}
          data-testid="gamma-slider"
        />
      </label>

      {/* Reset button */}
      {showResetButton && (
        <button
          type="button"
          className="viewer-toolbar__btn"
          onClick={onResetDisplayControls}
          title="Reset Gain & Gamma"
          data-testid="reset-display-btn"
        >
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  );
};
