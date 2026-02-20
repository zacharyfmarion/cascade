import React, { useState, useCallback, useRef } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { NodeSection, NodeButton } from './NodePrimitives';
import { getNodeIcon } from './nodeIcons';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue } from '../../store/types';

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

export const ColorPaletteNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { spec, params } = data;
  const setParam = useGraphStore(s => s.setParam);
  const setParamLive = useGraphStore(s => s.setParamLive);
  const setParamCommit = useGraphStore(s => s.setParamCommit);
  const loadPaletteFile = useGraphStore(s => s.loadPaletteFile);

  const colorsValue = params['colors'] ?? spec.params.find(p => p.key === 'colors')?.default;
  const colors: [number, number, number, number][] = colorsValue && 'ColorPalette' in colorsValue
    ? (colorsValue as { ColorPalette: [number, number, number, number][] }).ColorPalette
    : [[0, 0, 0, 1], [1, 1, 1, 1]];

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateColors = useCallback((newColors: [number, number, number, number][]) => {
    setParam(props.id, 'colors', { ColorPalette: newColors } as ParamValue);
  }, [props.id, setParam]);

  const handleAddColor = useCallback(() => {
    updateColors([...colors, [1, 1, 1, 1]]);
  }, [colors, updateColors]);

  const handleRemoveColor = useCallback((index: number) => {
    if (colors.length > 1) {
      updateColors(colors.filter((_, i) => i !== index));
    }
  }, [colors, updateColors]);

  const handleColorInput = useCallback((index: number, hex: string) => {
    const updated = [...colors];
    updated[index] = hexToFloat(hex, updated[index][3]);
    setParamLive(props.id, 'colors', { ColorPalette: updated } as ParamValue);
  }, [colors, props.id, setParamLive]);

  const handleColorCommit = useCallback((index: number, hex: string) => {
    const updated = [...colors];
    updated[index] = hexToFloat(hex, updated[index][3]);
    const value = { ColorPalette: updated } as ParamValue;
    // Ensure pre-commit snapshot exists even if onInput never fired
    setParamLive(props.id, 'colors', value);
    setParamCommit(props.id, 'colors', value);
  }, [colors, props.id, setParamLive, setParamCommit]);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      loadPaletteFile(props.id, file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [loadPaletteFile, props.id]);

  return (
    <BaseNode {...props} data={data} minWidth="240px" maxWidth="280px" headerIcon={getNodeIcon('color_palette', 'Color')}>
      <div
        className="nopan nodrag"
        style={{ userSelect: 'none' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <NodeSection spaced>
          <div
            className="node-palette__container"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px',
              maxHeight: '120px',
              overflowY: 'auto',
              padding: '4px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: '4px',
            }}
          >
            {colors.map((color, i) => (
              <div
                key={i}
                className="node-palette__swatch"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                style={{
                  position: 'relative',
                  width: '20px',
                  height: '20px',
                  background: `rgba(${floatToByte(color[0])},${floatToByte(color[1])},${floatToByte(color[2])},1)`,
                  border: '1px solid var(--border-default)',
                  borderRadius: '2px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="color"
                  value={colorToHex(color)}
                  onInput={(e) => handleColorInput(i, (e.target as HTMLInputElement).value)}
                  onChange={(e) => handleColorCommit(i, e.target.value)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    opacity: 0,
                    cursor: 'pointer',
                  }}
                />
                {hoverIdx === i && colors.length > 1 && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveColor(i);
                    }}
                    style={{
                      position: 'absolute',
                      top: '-4px',
                      right: '-4px',
                      width: '12px',
                      height: '12px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-default)',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      lineHeight: 1,
                      color: 'var(--text-primary)',
                      pointerEvents: 'auto',
                      zIndex: 10,
                    }}
                  >
                    ×
                  </div>
                )}
              </div>
            ))}
            <div
              className="node-palette__add"
              onClick={handleAddColor}
              style={{
                width: '20px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-surface)',
                border: '1px dashed var(--border-default)',
                borderRadius: '2px',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: '14px',
              }}
            >
              +
            </div>
          </div>
        </NodeSection>
        
        <NodeSection>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gpl,.png,.jpg,.jpeg,.bmp,.gif,.webp"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <NodeButton onClick={handleFileSelect} variant="secondary" fullWidth>
            Load Palette
          </NodeButton>
        </NodeSection>
      </div>
    </BaseNode>
  );
};
