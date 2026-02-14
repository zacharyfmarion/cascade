import React, { useCallback, useEffect, useRef } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { NodeSlider } from './NodeSlider';
import {
  NodeCanvas,
  NodeDropdown,
  NodeInfoRow,
  NodeButton,
  NodeSection,
} from './NodePrimitives';
import { getNodeIcon } from './nodeIcons';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue } from '../../store/types';
import { extractParamValue, createParamValue } from '../../store/types';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
};

export const ExportImageNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { spec, params } = data;
  const setParam = useGraphStore(s => s.setParam);
  const setParamLive = useGraphStore(s => s.setParamLive);
  const setParamCommit = useGraphStore(s => s.setParamCommit);
  const exportImage = useGraphStore(s => s.exportImage);
  const result = useGraphStore(s => s.renderResults.get(props.id));
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const formatParam = params['format'];
  const formatIdx = formatParam ? Number(extractParamValue(formatParam)) : 0;
  const qualityParam = params['quality'];
  const qualityVal = qualityParam ? Number(extractParamValue(qualityParam)) : 90;
  const outputPathParam = params['output_path'];
  const outputPath = outputPathParam ? String(extractParamValue(outputPathParam)) : '';

  const formatSpec = spec.params.find(p => p.key === 'format');
  const qualitySpec = spec.params.find(p => p.key === 'quality');

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

  const handleExport = useCallback(() => {
    exportImage(props.id);
  }, [props.id, exportImage]);

  return (
    <BaseNode {...props} data={data} headerIcon={getNodeIcon('export_image', 'Output')}>
      <NodeCanvas canvasRef={canvasRef} hasResult={!!result} />

      <NodeSection>
        {formatSpec && formatSpec.ui_hint.type === 'Dropdown' && (
          <NodeDropdown
            label={formatSpec.label}
            value={formatIdx}
            options={formatSpec.ui_hint.data}
            onChange={(v) => setParam(props.id, 'format', createParamValue('Int', v))}
          />
        )}

        {qualitySpec && (
          <NodeSlider
            label={qualitySpec.label}
            value={qualityVal}
            min={qualitySpec.min ?? 1}
            max={qualitySpec.max ?? 100}
            step={qualitySpec.step ?? 1}
            onChange={(v) => setParamLive(props.id, 'quality', createParamValue('Int', v))}
            onChangeCommit={(v) => setParamCommit(props.id, 'quality', createParamValue('Int', v))}
          />
        )}
      </NodeSection>

      <NodeSection spaced>
        <NodeInfoRow label="Output" value={outputPath || 'Not set'} mono />
      </NodeSection>

      <NodeSection spaced>
        <NodeButton onClick={handleExport} fullWidth>
          Export {formatIdx === 1 ? 'JPEG' : 'PNG'}
        </NodeButton>
      </NodeSection>
    </BaseNode>
  );
};
