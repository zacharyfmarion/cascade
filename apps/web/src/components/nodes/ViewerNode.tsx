import React, { useEffect, useRef } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { NodeCanvas } from './NodePrimitives';
import { getNodeIcon } from './nodeIcons';
import { useGraphStore } from '../../store/graphStore';
import { isPixelResult } from '../../store/types';
import type { NodeSpec, ParamValue } from '../../store/types';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
};

/** Compact inline display for non-pixel values */
const InlineScalar: React.FC<{ result: NonNullable<ReturnType<typeof useGraphStore.getState>['renderResults'] extends Map<string, infer V> ? V : never> }> = ({ result }) => {
  const style: React.CSSProperties = {
    height: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 8px',
  };

  switch (result.type) {
    case 'float':
      return (
        <div className="node-preview" style={style}>
          <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', color: 'var(--text-primary)' }}>
            {result.value.toFixed(4)}
          </span>
        </div>
      );
    case 'int':
      return (
        <div className="node-preview" style={style}>
          <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', color: 'var(--text-primary)' }}>
            {result.value}
          </span>
        </div>
      );
    case 'bool':
      return (
        <div className="node-preview" style={style}>
          <span style={{ fontWeight: 600, color: result.value ? 'var(--color-success, #4caf50)' : 'var(--text-muted)' }}>
            {result.value ? 'True' : 'False'}
          </span>
        </div>
      );
    case 'color': {
      const [r, g, b, a] = result.value;
      const toSRGB = (v: number) => Math.round(Math.max(0, Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)) * 255);
      return (
        <div className="node-preview" style={style}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 6,
            border: '1px solid var(--border-primary)',
            // eslint-disable-next-line compositor-theme/no-hardcoded-colors
            background: `rgba(${toSRGB(r)}, ${toSRGB(g)}, ${toSRGB(b)}, ${a})`,
          }} />
        </div>
      );
    }
    case 'string':
      return (
        <div className="node-preview" style={{ ...style, justifyContent: 'flex-start' }}>
          <span style={{
            fontFamily: 'monospace',
            fontSize: '0.7rem',
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}>
            {result.value}
          </span>
        </div>
      );
    case 'none':
      return (
        <div className="node-preview" style={style}>
          <span className="node-preview__empty">No value</span>
        </div>
      );
    default:
      return null;
  }
};

export const ViewerNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const result = useGraphStore(s => s.renderResults.get(props.id));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasPixels = result ? isPixelResult(result) : false;

  useEffect(() => {
    if (result && isPixelResult(result) && canvasRef.current) {
      const canvas = canvasRef.current;
      canvas.width = result.width;
      canvas.height = result.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imageData = new ImageData(result.width, result.height);
        imageData.data.set(result.pixels);
        ctx.putImageData(imageData, 0, 0);
      }
    }
  }, [result]);

  return (
    <BaseNode {...props} data={data} headerIcon={getNodeIcon('viewer', 'Output')}>
      {hasPixels ? (
        <NodeCanvas canvasRef={canvasRef} hasResult={true} emptyText="No Output" height={100} />
      ) : result ? (
        <InlineScalar result={result} />
      ) : (
        <NodeCanvas canvasRef={canvasRef} hasResult={false} emptyText="No Output" height={100} />
      )}
    </BaseNode>
  );
};
