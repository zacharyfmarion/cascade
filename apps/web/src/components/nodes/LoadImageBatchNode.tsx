import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const getBatchImageData = useGraphStore(s => s.getBatchImageData);
  const mediaIteratorInfoMap = useGraphStore(s => s.mediaIteratorInfoMap);
  const currentFrame = useGraphStore(s => s.currentFrame);
  const isRendering = useGraphStore(s => s.isRendering);
  const isDesktop = isDesktopRuntime();
  const iteratorInfo = mediaIteratorInfoMap.get(props.id);
  const currentBatchIndex = iteratorInfo
    ? Math.max(0, Math.min(iteratorInfo.count - 1, currentFrame - iteratorInfo.startFrame))
    : 0;
  const previewIndices = useMemo(() => {
    if (!iteratorInfo || iteratorInfo.count <= 0) return [];
    if (iteratorInfo.count <= 5) {
      return Array.from({ length: iteratorInfo.count }, (_, index) => index);
    }
    const start = Math.max(0, Math.min(iteratorInfo.count - 5, currentBatchIndex - 2));
    return Array.from({ length: 5 }, (_, offset) => start + offset);
  }, [currentBatchIndex, iteratorInfo]);

  const [loading, setLoading] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [folderName, setFolderName] = useState('');
  const [sourceThumbs, setSourceThumbs] = useState<Map<number, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceThumbsRef = useRef<Map<number, string>>(new Map());
  const directoryParam = data.params.directory;
  const savedDirectory = directoryParam && 'String' in directoryParam ? directoryParam.String : '';
  const visibleFolderName = folderName || savedDirectory.split('/').filter(Boolean).pop() || savedDirectory;
  const visibleCount = iteratorInfo?.count ?? fileCount;

  useEffect(() => {
    sourceThumbsRef.current = sourceThumbs;
  }, [sourceThumbs]);

  useEffect(() => {
    setSourceThumbs(prev => {
      for (const url of prev.values()) URL.revokeObjectURL(url);
      return new Map();
    });
  }, [iteratorInfo?.sourceNodeId, iteratorInfo?.count, visibleFolderName]);

  useEffect(() => {
    let cancelled = false;
    for (const index of previewIndices) {
      if (sourceThumbs.has(index)) continue;
      void getBatchImageData(props.id, index).then(bytes => {
        if (cancelled || !bytes) return;
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        const url = URL.createObjectURL(new Blob([buffer]));
        setSourceThumbs(prev => {
          if (prev.has(index)) {
            URL.revokeObjectURL(url);
            return prev;
          }
          const next = new Map(prev);
          next.set(index, url);
          return next;
        });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [getBatchImageData, previewIndices, props.id, sourceThumbs]);

  useEffect(() => () => {
    for (const url of sourceThumbsRef.current.values()) URL.revokeObjectURL(url);
  }, []);

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

      {visibleCount > 0 || visibleFolderName ? (
        <NodeSection spaced>
          {visibleFolderName && <NodeInfoRow label="Folder" value={visibleFolderName} mono />}
          {previewIndices.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${previewIndices.length}, 1fr)`,
                gap: 4,
              }}
            >
              {previewIndices.map(index => {
                const thumbnail = sourceThumbs.get(index);
                const active = index === currentBatchIndex;
                return (
                  <div
                    key={index}
                    title={iteratorInfo?.itemLabels[index] ?? `${index + 1}`}
                    style={{
                      aspectRatio: '1 / 1',
                      borderRadius: 4,
                      overflow: 'hidden',
                      background: 'var(--bg-surface)',
                      border: active
                        ? '2px solid var(--accent-primary)'
                        : '1px solid var(--border-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '0.65rem',
                    }}
                  >
                    {thumbnail ? (
                      <img
                        src={thumbnail}
                        alt=""
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <NodeStatus variant="info">
            {visibleCount > 0 ? `${visibleCount} images loaded` : 'Images loaded'}
          </NodeStatus>
        </NodeSection>
      ) : (
        <NodeStatus variant="info">No images loaded</NodeStatus>
      )}
    </BaseNode>
  );
};
