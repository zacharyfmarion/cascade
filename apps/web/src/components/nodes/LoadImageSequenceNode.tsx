import React, { useCallback, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import {
  NodeButton,
  NodeInfoRow,
  NodeBadge,
  NodeSection,
  NodeStatus,
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

function inferSequencePattern(paths: string[]): { directory: string; pattern: string } | null {
  if (paths.length === 0) return null;

  const normalized = paths.map(p => p.replace(/\\/g, '/'));

  const lastSlash = normalized[0].lastIndexOf('/');
  if (lastSlash === -1) return null;

  const directory = normalized[0].substring(0, lastSlash);
  const filename = normalized[0].substring(lastSlash + 1);

  const numericRuns = [...filename.matchAll(/\d+/g)];
  if (numericRuns.length === 0) {
    return { directory, pattern: filename };
  }

  let bestMatch = numericRuns[0];
  for (const m of numericRuns) {
    if (m[0].length >= bestMatch[0].length) {
      bestMatch = m;
    }
  }

  const padding = bestMatch[0].length;
  const idx = bestMatch.index!;
  const pattern =
    filename.substring(0, idx) +
    `{frame:${padding}}` +
    filename.substring(idx + bestMatch[0].length);

  return { directory, pattern };
}

export const LoadImageSequenceNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { params } = data;
  const setParam = useGraphStore(s => s.setParam);
  const setSequenceDirectory = useGraphStore(s => s.setSequenceDirectory);
  const isRendering = useGraphStore(s => s.isRendering);
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const directory = params['directory'] ? String(extractParamValue(params['directory'])) : '';
  const pattern = params['pattern'] ? String(extractParamValue(params['pattern'])) : '';

  const [loading, setLoading] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);

  const handleBrowse = useCallback(async () => {
    if (!isTauri) return;

    try {
      setLoading(true);
      const { open } = await import('@tauri-apps/plugin-dialog');

      const selected = await open({
        multiple: true,
        title: 'Select Image Sequence Files',
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'exr', 'tif', 'tiff', 'bmp', 'webp'],
          },
        ],
      });

      if (!selected || (Array.isArray(selected) && selected.length === 0)) {
        return;
      }

      const paths = Array.isArray(selected) ? selected : [selected];
      setSelectedCount(paths.length);

      const inferred = inferSequencePattern(paths);
      if (inferred) {
        setParam(props.id, 'directory', createParamValue('String', inferred.directory));
        setParam(props.id, 'pattern', createParamValue('String', inferred.pattern));
        setSequenceDirectory(props.id, inferred.directory);
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err);
    } finally {
      setLoading(false);
    }
  }, [isTauri, props.id, setParam, setSequenceDirectory]);

  const dirBasename = directory ? directory.split('/').filter(Boolean).pop() || directory : '';

  return (
    <BaseNode {...props} data={data} headerIcon={getNodeIcon('load_image_sequence', 'Input')}>
      <NodeSection>
        <NodeButton
          onClick={handleBrowse}
          disabled={!isTauri || loading || isRendering}
          fullWidth
        >
          {loading ? 'Opening...' : isRendering ? 'Rendering...' : 'Browse Files'}
        </NodeButton>
      </NodeSection>

      {directory ? (
        <NodeSection spaced>
          <NodeInfoRow label="Folder" value={dirBasename} mono />
          <NodeInfoRow label="Pattern" value={pattern} mono />
          {selectedCount > 0 && (
            <NodeStatus variant="info">{selectedCount} files selected</NodeStatus>
          )}
        </NodeSection>
      ) : (
        <NodeStatus variant="info">No sequence loaded</NodeStatus>
      )}

      {!isTauri && <NodeBadge>Desktop only</NodeBadge>}
    </BaseNode>
  );
};
