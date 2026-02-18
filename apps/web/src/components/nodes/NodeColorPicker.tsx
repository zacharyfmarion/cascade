import React, { useCallback, useMemo } from 'react';
import { NodeSlider } from './NodeSlider';
import { linearToSrgbChannel, floatToByte, linearToHex, hexToLinear } from './colorUtils';

interface NodeColorPickerProps {
  label: string;
  value: [number, number, number, number]; // LINEAR RGBA
  onChange: (value: [number, number, number, number]) => void;
  onChangeCommit?: (value: [number, number, number, number]) => void;
}

export const NodeColorPicker: React.FC<NodeColorPickerProps> = ({
  label,
  value,
  onChange,
  onChangeCommit,
}) => {
  const [r, g, b, a] = Array.isArray(value) && value.length === 4 ? value : [0, 0, 0, 1];
  
  // Convert current linear color to sRGB hex for the native picker
  const hexValue = useMemo(() => linearToHex(r, g, b), [r, g, b]);

  // Dynamic background style for the swatch (in sRGB for display)
  // We use CSS rgba() which expects sRGB 0-255
  const swatchStyle = useMemo(() => {
    const sr = floatToByte(linearToSrgbChannel(r));
    const sg = floatToByte(linearToSrgbChannel(g));
    const sb = floatToByte(linearToSrgbChannel(b));
    return {
      backgroundColor: `rgba(${sr}, ${sg}, ${sb}, ${a})`,
    };
  }, [r, g, b, a]);

  const handleColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const [nr, ng, nb] = hexToLinear(e.target.value);
    onChange([nr, ng, nb, a]);
  }, [a, onChange]);

  // Native picker doesn't really have a "commit" separate from change usually, 
  // but we can fire commit on blur or close if we could detect it. 
  // For now, native input fires onChange when closed/accepted mostly.
  // We can just proxy onChange to onChangeCommit if present for the color picker part.
  const handleColorCommit = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const [nr, ng, nb] = hexToLinear(e.target.value);
    onChangeCommit?.([nr, ng, nb, a]);
  }, [a, onChangeCommit]);

  const handleAlphaChange = useCallback((newAlpha: number) => {
    onChange([r, g, b, newAlpha]);
  }, [r, g, b, onChange]);

  const handleAlphaCommit = useCallback((newAlpha: number) => {
    onChangeCommit?.([r, g, b, newAlpha]);
  }, [r, g, b, onChangeCommit]);

  return (
    <div className="node-color-picker nopan nodrag nowheel">
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        marginBottom: '4px'
      }}>
        <div className="node-color-picker__label" style={{ 
          fontSize: '0.8rem', 
          color: 'var(--text-secondary)' 
        }}>
          {label}
        </div>
        <div style={{
          position: 'relative',
          width: '24px',
          height: '24px',
          borderRadius: '3px',
          border: '1px solid var(--border-default)',
          overflow: 'hidden',
          ...swatchStyle
        }}>
          <input
            type="color"
            value={hexValue}
            onChange={handleColorChange}
            onBlur={handleColorCommit} // Approximate commit on blur
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: 'pointer',
              padding: 0,
              border: 'none',
            }}
          />
        </div>
      </div>
      
      <NodeSlider
        label="Alpha"
        value={a}
        min={0}
        max={1}
        step={0.01}
        onChange={handleAlphaChange}
        onChangeCommit={handleAlphaCommit}
      />
    </div>
  );
};
