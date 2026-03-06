import React, { useCallback, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import {
  NodeButton,
  NodeSection,
  NodeStatus,
} from './NodePrimitives';
import { getNodeIcon } from './nodeIcons';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue } from '../../store/types';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
};

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.exr,.tif,.tiff,.bmp,.webp';

export const LoadImageBatchNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const loadBatchFiles = useGraphStore(s => s.loadBatchFiles);
  const isRendering = useGraphStore(s => s.isRendering);

  const [loading, setLoading] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBrowse = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFilesSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    try {
      setLoading(true);
      const files = Array.from(fileList);
      setFileCount(files.length);
      await loadBatchFiles(props.id, files);
    } catch (err) {
      console.error('Failed to load image batch:', err);
      useGraphStore.getState().pushToast('error', 'Failed to load images', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [props.id, loadBatchFiles]);

  return (
    <BaseNode {...props} data={data} headerIcon={getNodeIcon('load_image_batch', 'Input')}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={IMAGE_ACCEPT}
        onChange={handleFilesSelected}
        style={{ display: 'none' }}
      />

      <NodeSection>
        <NodeButton
          onClick={handleBrowse}
          disabled={loading || isRendering}
          fullWidth
        >
          {loading ? 'Loading...' : isRendering ? 'Rendering...' : 'Select Images'}
        </NodeButton>
      </NodeSection>

      {fileCount > 0 ? (
        <NodeStatus variant="info">{fileCount} images loaded</NodeStatus>
      ) : (
        <NodeStatus variant="info">No images loaded</NodeStatus>
      )}
    </BaseNode>
  );
};
