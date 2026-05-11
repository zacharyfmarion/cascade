import React, { useCallback, useEffect, useRef } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import {
  NodeCanvas,
  NodeDropdown,
  NodeButton,
  NodeInfoRow,
  NodeProgress,
  NodeStatus,
  NodeSection,
  NodeTextInput,
  NodeDisabledOverlay,
} from './NodePrimitives';
import { getNodeIcon } from './nodeIcons';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue } from '../../store/types';
import { extractParamValue, createParamValue } from '../../store/types';
import { isDesktopRuntime } from '../../platform/runtime';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
};

export const ExportImageBatchNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { spec, params } = data;
  const setParam = useGraphStore(s => s.setParam);
  const isRendering = useGraphStore(s => s.isRendering);
  const renderProgress = useGraphStore(s => s.renderProgress);
  const renderBatch = useGraphStore(s => s.renderBatch);
  const cancelRender = useGraphStore(s => s.cancelRender);
  const result = useGraphStore(s => s.renderResults.get(props.id));
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const formatParam = params['format'];
  const formatIdx = formatParam ? Number(extractParamValue(formatParam)) : 0;
  const filenameTemplate = params['filename_template']
    ? String(extractParamValue(params['filename_template']))
    : '{name}';
  const outputDir = params['output_dir'] ? String(extractParamValue(params['output_dir'])) : '';
  const isDesktop = isDesktopRuntime();

  const formatSpec = spec.params.find(p => p.key === 'format');

  const progressPercent = renderProgress
    ? Math.round((renderProgress.current_frame / Math.max(renderProgress.total_frames, 1)) * 100)
    : 0;

  useEffect(() => {
    if (result && 'pixels' in result && canvasRef.current) {
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

  const handleRender = useCallback(() => {
    renderBatch(props.id);
  }, [renderBatch, props.id]);

  const handleSelectOutputFolder = useCallback(async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Batch Output Folder',
    });
    if (typeof selected === 'string') {
      setParam(props.id, 'output_dir', createParamValue('String', selected));
    }
  }, [props.id, setParam]);

  const outputBasename = outputDir ? outputDir.split('/').filter(Boolean).pop() || outputDir : '';

  return (
    <BaseNode {...props} data={data} headerIcon={getNodeIcon('export_image_batch', 'Output')}>
      <NodeCanvas canvasRef={canvasRef} hasResult={!!result} />

      <NodeDisabledOverlay disabled={isRendering}>
        {formatSpec && formatSpec.ui_hint.type === 'Dropdown' && (
          <NodeSection>
            <NodeDropdown
              label={formatSpec.label}
              value={formatIdx}
              options={formatSpec.ui_hint.data}
              onChange={(v) => setParam(props.id, 'format', createParamValue('Int', v))}
              disabled={isRendering}
            />
          </NodeSection>
        )}
        <NodeSection>
          <NodeTextInput
            label="Filename Template"
            value={filenameTemplate}
            onChange={(v) => setParam(props.id, 'filename_template', createParamValue('String', v))}
            placeholder="{name}"
            disabled={isRendering}
          />
        </NodeSection>
        {isDesktop && (
          <NodeSection spaced>
            <NodeButton
              onClick={handleSelectOutputFolder}
              disabled={isRendering}
              fullWidth
            >
              Select Output Folder
            </NodeButton>
            {outputDir ? (
              <NodeInfoRow label="Folder" value={outputBasename} mono />
            ) : (
              <NodeStatus variant="info">No output folder selected</NodeStatus>
            )}
          </NodeSection>
        )}
      </NodeDisabledOverlay>

      {isRendering ? (
        <NodeSection spaced>
          <NodeProgress
            percent={progressPercent}
            label={`Image ${renderProgress?.current_frame ?? 0} / ${renderProgress?.total_frames ?? 0}`}
          />
          <NodeButton onClick={() => cancelRender()} variant="danger" fullWidth>
            Cancel
          </NodeButton>
          {renderProgress?.error && (
            <NodeStatus variant="danger">{renderProgress.error}</NodeStatus>
          )}
        </NodeSection>
      ) : (
        <NodeSection spaced>
          <NodeButton onClick={handleRender} disabled={isDesktop && !outputDir} fullWidth>
            {isDesktop ? 'Render Batch' : 'Render & Download Zip'}
          </NodeButton>
        </NodeSection>
      )}

      {!isRendering && renderProgress?.error && (
        <NodeStatus variant="danger">{renderProgress.error}</NodeStatus>
      )}

      {!isRendering && renderProgress?.completed && !renderProgress.error && (
        <NodeStatus variant="success">Render complete</NodeStatus>
      )}
    </BaseNode>
  );
};
