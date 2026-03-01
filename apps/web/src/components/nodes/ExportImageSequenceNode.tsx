import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import {
  NodeCanvas,
  NodeDropdown,
  NodeButton,
  NodeProgress,
  NodeStatus,
  NodeSection,
  NodeDisabledOverlay,
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

export const ExportImageSequenceNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { spec, params } = data;
  const setParam = useGraphStore(s => s.setParam);
  const isRendering = useGraphStore(s => s.isRendering);
  const renderProgress = useGraphStore(s => s.renderProgress);
  const renderSequence = useGraphStore(s => s.renderSequence);
  const cancelRender = useGraphStore(s => s.cancelRender);
  const result = useGraphStore(s => s.renderResults.get(props.id));
  const sequenceStart = useGraphStore(s => s.sequenceStart);
  const sequenceLength = useGraphStore(s => s.sequenceLength);
  const hasSequenceNodes = useGraphStore(s => s.hasSequenceNodes);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const prevSeqRef = useRef<{ start: number; end: number } | null>(null);

  const [browsing, setBrowsing] = useState(false);

  const formatParam = params['format'];
  const formatIdx = formatParam ? Number(extractParamValue(formatParam)) : 0;
  const outputDir = params['output_dir'] ? String(extractParamValue(params['output_dir'])) : '';
  const startFrame = params['start_frame'] ? Number(extractParamValue(params['start_frame'])) : 0;
  const endFrame = params['end_frame'] ? Number(extractParamValue(params['end_frame'])) : 100;
  const step = params['step'] ? Number(extractParamValue(params['step'])) : 1;

  useEffect(() => {
    if (!hasSequenceNodes) return;
    const prev = prevSeqRef.current;
    if (prev && prev.start === sequenceStart && prev.end === sequenceLength) return;
    prevSeqRef.current = { start: sequenceStart, end: sequenceLength };
    (async () => {
      await setParam(props.id, 'start_frame', createParamValue('Int', sequenceStart));
      await setParam(props.id, 'end_frame', createParamValue('Int', sequenceLength));
    })();
  }, [hasSequenceNodes, sequenceStart, sequenceLength, props.id, setParam]);

  const formatSpec = spec.params.find(p => p.key === 'format');

  const isValid = (isTauri ? outputDir.length > 0 : true) && startFrame <= endFrame && step > 0;

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

  const handleBrowse = useCallback(async () => {
    if (!isTauri) return;
    try {
      setBrowsing(true);
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Output Directory',
      });
      if (selected && typeof selected === 'string') {
        setParam(props.id, 'output_dir', createParamValue('String', selected));
      }
    } catch (err) {
      console.error('Failed to open folder dialog:', err);
    } finally {
      setBrowsing(false);
    }
  }, [isTauri, props.id, setParam]);

  const handleRender = useCallback(() => {
    if (!isValid) return;
    renderSequence(props.id);
  }, [isValid, renderSequence, props.id]);

  const dirBasename = outputDir ? outputDir.split('/').filter(Boolean).pop() || outputDir : '';

  return (
    <BaseNode {...props} data={data} headerIcon={getNodeIcon('export_image_sequence', 'Output')}>
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
      </NodeDisabledOverlay>

      {isTauri && (
        <NodeSection label="Output" spaced>
          <NodeButton
            onClick={handleBrowse}
            disabled={browsing || isRendering}
            variant="secondary"
            fullWidth
          >
            {browsing ? 'Opening...' : outputDir ? dirBasename : 'Select Output Folder'}
          </NodeButton>

          {outputDir && <div className="node-filepath">{outputDir}</div>}
        </NodeSection>
      )}

      {isRendering ? (
        <NodeSection spaced>
          <NodeProgress
            percent={progressPercent}
            label={`Frame ${renderProgress?.current_frame ?? 0} / ${renderProgress?.total_frames ?? 0}`}
          />
          <NodeButton onClick={() => cancelRender()} variant="danger" fullWidth>
            Cancel
          </NodeButton>
          {renderProgress?.error && (
            <NodeStatus variant="danger">{renderProgress.error}</NodeStatus>
          )}
        </NodeSection>
      ) : isValid ? (
        <NodeSection spaced>
          <NodeButton onClick={handleRender} fullWidth>
            {isTauri ? 'Render Sequence' : 'Render & Download Zip'}
          </NodeButton>
        </NodeSection>
      ) : null}

      {!isRendering && renderProgress?.error && (
        <NodeStatus variant="danger">{renderProgress.error}</NodeStatus>
      )}

      {!isRendering && renderProgress?.completed && !renderProgress.error && (
        <NodeStatus variant="success">Render complete</NodeStatus>
      )}
    </BaseNode>
  );
};
