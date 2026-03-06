import React, { useCallback, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import {
  NodeButton,
  NodeInfoRow,
  NodeSection,
  NodeStatus,
} from './NodePrimitives';
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
  const loadVideoFile = useGraphStore(s => s.loadVideoFile);
  const isRendering = useGraphStore(s => s.isRendering);

  const [loading, setLoading] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleBrowse = useCallback(async () => {
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
  }, [props.id, loadVideoFile]);

  const hasVideo = videoInfo !== null;

  return (
    <BaseNode {...props} data={data} headerIcon={getNodeIcon('load_video', 'Input')}>
      <NodeSection>
        <NodeButton
          onClick={handleBrowse}
          disabled={loading || isRendering}
          fullWidth
        >
          {loading ? 'Loading...' : isRendering ? 'Rendering...' : 'Browse Video'}
        </NodeButton>
      </NodeSection>

      {hasVideo ? (
        <NodeSection spaced>
          {fileName && <NodeInfoRow label="File" value={fileName} mono />}
          <NodeInfoRow label="Size" value={`${videoInfo.width}x${videoInfo.height}`} mono />
          <NodeInfoRow label="FPS" value={String(Math.round(videoInfo.fps * 100) / 100)} mono />
          <NodeInfoRow label="Frames" value={String(videoInfo.frame_count)} mono />
          <NodeInfoRow label="Duration" value={`${videoInfo.duration_secs.toFixed(2)}s`} mono />
        </NodeSection>
      ) : (
        <NodeStatus variant="info">No video loaded</NodeStatus>
      )}
    </BaseNode>
  );
};
