import React, { useCallback, useRef, useState } from 'react';
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

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.exr,.tif,.tiff,.bmp,.webp';

export const LoadImageSequenceNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { params } = data;
  const setParam = useGraphStore(s => s.setParam);
  const setSequenceDirectory = useGraphStore(s => s.setSequenceDirectory);
  const setSequenceFiles = useGraphStore(s => s.setSequenceFiles);
  const isRendering = useGraphStore(s => s.isRendering);
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const directory = params['directory'] ? String(extractParamValue(params['directory'])) : '';
  const pattern = params['pattern'] ? String(extractParamValue(params['pattern'])) : '';

  const [loading, setLoading] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBrowseTauri = useCallback(async () => {
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
  }, [props.id, setParam, setSequenceDirectory]);

  const handleBrowseWeb = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFilesSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    try {
      setLoading(true);
      const files = Array.from(fileList);
      setSelectedCount(files.length);
      await setSequenceFiles(props.id, files);
    } catch (err) {
      console.error('Failed to load image sequence:', err);
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [props.id, setSequenceFiles]);

  const handleBrowse = useCallback(() => {
    if (isTauri) {
      handleBrowseTauri();
    } else {
      handleBrowseWeb();
    }
  }, [isTauri, handleBrowseTauri, handleBrowseWeb]);

  const dirBasename = directory ? directory.split('/').filter(Boolean).pop() || directory : '';
  const hasSequence = directory || selectedCount > 0;

  return (
    <BaseNode {...props} data={data} headerIcon={getNodeIcon('load_image_sequence', 'Input')}>
      {!isTauri && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={IMAGE_ACCEPT}
          onChange={handleFilesSelected}
          style={{ display: 'none' }}
        />
      )}

      <NodeSection>
        <NodeButton
          onClick={handleBrowse}
          disabled={loading || isRendering}
          fullWidth
        >
          {loading ? 'Loading...' : isRendering ? 'Rendering...' : 'Browse Files'}
        </NodeButton>
      </NodeSection>

      {hasSequence ? (
        <NodeSection spaced>
          {directory && <NodeInfoRow label="Folder" value={dirBasename} mono />}
          {pattern && <NodeInfoRow label="Pattern" value={pattern} mono />}
          {selectedCount > 0 && (
            <NodeStatus variant="info">{selectedCount} files selected</NodeStatus>
          )}
        </NodeSection>
      ) : (
        <NodeStatus variant="info">No sequence loaded</NodeStatus>
      )}
    </BaseNode>
  );
};
