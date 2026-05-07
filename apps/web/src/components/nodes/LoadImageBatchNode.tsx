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
import { isDesktopRuntime } from '../../platform/runtime';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
};

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.exr,.tif,.tiff,.bmp,.webp';

export const LoadImageBatchNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const loadBatchFiles = useGraphStore(s => s.loadBatchFiles);
  const loadBatchPaths = useGraphStore(s => s.loadBatchPaths);
  const loadBatchDirectory = useGraphStore(s => s.loadBatchDirectory);
  const isRendering = useGraphStore(s => s.isRendering);
  const isDesktop = isDesktopRuntime();

  const [loading, setLoading] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [folderName, setFolderName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directoryParam = data.params.directory;
  const savedDirectory = directoryParam && 'String' in directoryParam ? directoryParam.String : '';
  const visibleFolderName = folderName || savedDirectory.split('/').filter(Boolean).pop() || savedDirectory;

  const handleBrowseWeb = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleBrowseDesktopFiles = useCallback(async () => {
    try {
      setLoading(true);
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: true,
        title: 'Select Batch Images',
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'exr', 'tif', 'tiff', 'bmp', 'webp'],
        }],
      });
      if (!selected || (Array.isArray(selected) && selected.length === 0)) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      setFileCount(paths.length);
      setFolderName('');
      await loadBatchPaths(props.id, paths);
    } catch (err) {
      console.error('Failed to load image batch:', err);
      useGraphStore.getState().pushToast('error', 'Failed to load images', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [props.id, loadBatchPaths]);

  const handleBrowseDesktopFolder = useCallback(async () => {
    try {
      setLoading(true);
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Batch Image Folder',
      });
      if (typeof selected !== 'string') return;
      const info = await loadBatchDirectory(props.id, selected);
      setFileCount(info?.count ?? 0);
      setFolderName(selected.split('/').filter(Boolean).pop() || selected);
    } catch (err) {
      console.error('Failed to load image batch folder:', err);
      useGraphStore.getState().pushToast('error', 'Failed to load folder', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [props.id, loadBatchDirectory]);

  const handleFilesSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    try {
      setLoading(true);
      const files = Array.from(fileList);
      setFileCount(files.length);
      setFolderName('');
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
      {!isDesktop && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={IMAGE_ACCEPT}
          onChange={handleFilesSelected}
          style={{ display: 'none' }}
        />
      )}

      <NodeSection spaced>
        <NodeButton
          onClick={isDesktop ? handleBrowseDesktopFiles : handleBrowseWeb}
          disabled={loading || isRendering}
          fullWidth
        >
          {loading ? 'Loading...' : isRendering ? 'Rendering...' : 'Select Images'}
        </NodeButton>
        {isDesktop && (
          <NodeButton
            onClick={handleBrowseDesktopFolder}
            disabled={loading || isRendering}
            fullWidth
          >
            Select Folder
          </NodeButton>
        )}
      </NodeSection>

      {fileCount > 0 || visibleFolderName ? (
        <NodeSection spaced>
          {visibleFolderName && <NodeInfoRow label="Folder" value={visibleFolderName} mono />}
          <NodeStatus variant="info">
            {fileCount > 0 ? `${fileCount} images loaded` : 'Images loaded'}
          </NodeStatus>
        </NodeSection>
      ) : (
        <NodeStatus variant="info">No images loaded</NodeStatus>
      )}
    </BaseNode>
  );
};
