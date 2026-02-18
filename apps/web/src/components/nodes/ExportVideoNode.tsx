import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import {
  NodeCanvas,
  NodeDropdown,
  NodeButton,
  NodeProgress,
  NodeBadge,
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

export const ExportVideoNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { spec, params } = data;
  const setParam = useGraphStore(s => s.setParam);
  const isRendering = useGraphStore(s => s.isRendering);
  const renderProgress = useGraphStore(s => s.renderProgress);
  const renderVideo = useGraphStore(s => s.renderVideo);
  const cancelRender = useGraphStore(s => s.cancelRender);
  const result = useGraphStore(s => s.renderResults.get(props.id));
  const sequenceStart = useGraphStore(s => s.sequenceStart);
  const sequenceLength = useGraphStore(s => s.sequenceLength);
  const hasSequenceNodes = useGraphStore(s => s.hasSequenceNodes);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const prevSeqRef = useRef<{ start: number; end: number } | null>(null);

  const [browsing, setBrowsing] = useState(false);

  const codecParam = params['codec'];
  const codecIdx = codecParam ? Number(extractParamValue(codecParam)) : 0;
  const outputPath = params['output_path'] ? String(extractParamValue(params['output_path'])) : '';
  const startFrame = params['start_frame'] ? Number(extractParamValue(params['start_frame'])) : 0;
  const endFrame = params['end_frame'] ? Number(extractParamValue(params['end_frame'])) : 100;
  const step = params['step'] ? Number(extractParamValue(params['step'])) : 1;

  useEffect(() => {
    if (!hasSequenceNodes || sequenceLength === 0) return;
    const prev = prevSeqRef.current;
    if (prev && prev.start === sequenceStart && prev.end === sequenceLength) return;
    prevSeqRef.current = { start: sequenceStart, end: sequenceLength };
    setParam(props.id, 'start_frame', createParamValue('Int', sequenceStart));
    setParam(props.id, 'end_frame', createParamValue('Int', sequenceLength));
  }, [hasSequenceNodes, sequenceStart, sequenceLength, props.id, setParam]);

  const codecSpec = spec.params.find(p => p.key === 'codec');

  const isValid = outputPath.length > 0 && startFrame <= endFrame && step > 0;

  const progressPercent = renderProgress
    ? Math.round((renderProgress.current_frame / Math.max(renderProgress.total_frames, 1)) * 100)
    : 0;

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

  const handleBrowse = useCallback(async () => {
    if (!isTauri) return;
    try {
      setBrowsing(true);
      const { save } = await import('@tauri-apps/plugin-dialog');
      const selected = await save({
        filters: [{ name: 'Video', extensions: ['mp4'] }],
        title: 'Save Video File',
      });
      if (selected && typeof selected === 'string') {
        setParam(props.id, 'output_path', createParamValue('String', selected));
      }
    } catch (err) {
      console.error('Failed to open save dialog:', err);
    } finally {
      setBrowsing(false);
    }
  }, [isTauri, props.id, setParam]);

  const handleRender = useCallback(() => {
    if (!isValid) return;
    renderVideo(props.id);
  }, [isValid, renderVideo, props.id]);

  const fileBasename = outputPath ? outputPath.split('/').filter(Boolean).pop() || outputPath : '';

  return (
    <BaseNode {...props} data={data} headerIcon={getNodeIcon('export_video', 'Output')}>
      <NodeCanvas canvasRef={canvasRef} hasResult={!!result} />

      <NodeDisabledOverlay disabled={isRendering}>
        {codecSpec && codecSpec.ui_hint.type === 'Dropdown' && (
          <NodeSection>
            <NodeDropdown
              label={codecSpec.label}
              value={codecIdx}
              options={codecSpec.ui_hint.data}
              onChange={(v) => setParam(props.id, 'codec', createParamValue('Int', v))}
              disabled={isRendering}
            />
          </NodeSection>
        )}
      </NodeDisabledOverlay>

      <NodeSection label="Output" spaced>
        <NodeButton
          onClick={handleBrowse}
          disabled={!isTauri || browsing || isRendering}
          variant="secondary"
          fullWidth
        >
          {browsing ? 'Saving...' : outputPath ? fileBasename : 'Select Output File'}
        </NodeButton>

        {outputPath && <div className="node-filepath">{outputPath}</div>}
      </NodeSection>

      {!isTauri && <NodeBadge>Desktop only</NodeBadge>}

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
            Render Video
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
