import React, { useCallback, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import {
  NodeBadge,
  NodeButton,
  NodeInfoRow,
  NodeSection,
  NodeStatus,
} from './NodePrimitives';
import { getUnsupportedNodeMessage, isNodeSupportedOnSurface } from '../../platform/features';
import { getRuntimeSurface } from '../../platform/runtime';
import { getNodeIcon } from './nodeIcons';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue } from '../../store/types';
import type { VideoInfo } from '../../engine/bridge';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
};

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'];

export const LoadVideoNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { spec } = data;
  const loadVideoFile = useGraphStore(s => s.loadVideoFile);
  const isRendering = useGraphStore(s => s.isRendering);
  const runtimeSurface = getRuntimeSurface();
  const isSupported = isNodeSupportedOnSurface(spec, runtimeSurface);
  const unsupportedMessage = getUnsupportedNodeMessage(spec, runtimeSurface);

  const [loading, setLoading] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleBrowse = useCallback(async () => {
    if (!isSupported) return;
    try {
      setLoading(true);
      const { open } = await import('@tauri-apps/plugin-dialog');

      const selected = await open({
        multiple: false,
        title: 'Select Video File',
        filters: [
          {
            name: 'Video',
            extensions: VIDEO_EXTENSIONS,
          },
        ],
      });

      if (!selected) return;

      const path = Array.isArray(selected) ? selected[0] : selected;
      const name = path.split('/').pop() || path;
      setFileName(name);

      const info = await loadVideoFile(props.id, path);
      if (info) {
        setVideoInfo(info);
      }
    } catch (err) {
      console.error('Failed to load video:', err);
      useGraphStore.getState().pushToast('error', 'Failed to load video', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isSupported, props.id, loadVideoFile]);

  const hasVideo = videoInfo !== null;

  return (
    <BaseNode {...props} data={data} headerIcon={getNodeIcon('load_video', 'Input')}>
      <NodeSection>
        <NodeButton
          onClick={handleBrowse}
          disabled={!isSupported || loading || isRendering}
          fullWidth
        >
          {loading ? 'Loading...' : isRendering ? 'Rendering...' : 'Browse Video'}
        </NodeButton>
      </NodeSection>

      {!isSupported && <NodeBadge>Desktop only</NodeBadge>}

      {hasVideo ? (
        <NodeSection spaced>
          {fileName && <NodeInfoRow label="File" value={fileName} mono />}
          <NodeInfoRow label="Size" value={`${videoInfo.width}x${videoInfo.height}`} mono />
          <NodeInfoRow label="FPS" value={String(Math.round(videoInfo.fps * 100) / 100)} mono />
          <NodeInfoRow label="Frames" value={String(videoInfo.frame_count)} mono />
          <NodeInfoRow label="Duration" value={`${videoInfo.duration_secs.toFixed(2)}s`} mono />
        </NodeSection>
      ) : !isSupported && unsupportedMessage ? (
        <NodeStatus variant="info">{unsupportedMessage}</NodeStatus>
      ) : (
        <NodeStatus variant="info">No video loaded</NodeStatus>
      )}
    </BaseNode>
  );
};
