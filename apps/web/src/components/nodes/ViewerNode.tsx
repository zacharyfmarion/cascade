import React, { useEffect, useRef } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { NodeCanvas } from './NodePrimitives';
import { getNodeIcon } from './nodeIcons';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue } from '../../store/types';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
};

export const ViewerNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const result = useGraphStore(s => s.renderResults.get(props.id));
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (result && canvasRef.current) {
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
      <NodeCanvas canvasRef={canvasRef} hasResult={!!result} emptyText="No Output" height={100} />
    </BaseNode>
  );
};
