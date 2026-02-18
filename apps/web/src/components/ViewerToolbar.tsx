import React, { useState, useRef, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface ViewerToolbarProps {
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
  setActualPixels: () => void;
  setZoomLevel: (scale: number) => void;
  zoomPercent: number;
}

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  zoomIn,
  zoomOut,
  fitToView,
  setActualPixels,
  setZoomLevel,
  zoomPercent,
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

  return (
    <div className="viewer-toolbar">
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
    </div>
  );
};
