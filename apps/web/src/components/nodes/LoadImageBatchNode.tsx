import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import {
  NodeButton,
  NodeInfoRow,
  NodeSection,
  NodeStatus,
} from './NodePrimitives';
import { getNodeIcon } from './nodeIcons';
import { MediaVirtualStrip } from '../MediaVirtualStrip';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue } from '../../store/types';
import { isDesktopRuntime } from '../../platform/runtime';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
};

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.exr,.tif,.tiff,.bmp,.webp';
const CAROUSEL_ITEM_SIZE = 52;
const CAROUSEL_THUMB_SIZE = 44;
const CAROUSEL_OVERSCAN = 3;
const CAROUSEL_THUMBNAIL_MAX_EDGE = 128;
const MAX_CACHED_SOURCE_THUMBS = 80;

export const LoadImageBatchNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const loadBatchFiles = useGraphStore(s => s.loadBatchFiles);
  const loadBatchPaths = useGraphStore(s => s.loadBatchPaths);
  const loadBatchDirectory = useGraphStore(s => s.loadBatchDirectory);
  const getBatchThumbnail = useGraphStore(s => s.getBatchThumbnail);
  const mediaIteratorInfoMap = useGraphStore(s => s.mediaIteratorInfoMap);
  const activeTransportSourceId = useGraphStore(s => s.activeTransportSourceId);
  const currentFrame = useGraphStore(s => s.currentFrame);
  const setCurrentFrame = useGraphStore(s => s.setCurrentFrame);
  const setActiveTransportSource = useGraphStore(s => s.setActiveTransportSource);
  const isRendering = useGraphStore(s => s.isRendering);
  const isDesktop = isDesktopRuntime();
  const iteratorInfo = mediaIteratorInfoMap.get(props.id);
  const isActiveTransport = activeTransportSourceId === props.id;
  const currentBatchIndex = iteratorInfo
    ? Math.max(
        0,
        Math.min(
          iteratorInfo.count - 1,
          isActiveTransport ? currentFrame - iteratorInfo.startFrame : 0,
        ),
      )
    : 0;

  const [loading, setLoading] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [folderName, setFolderName] = useState('');
  const [visibleThumbnailIndexes, setVisibleThumbnailIndexes] = useState<number[]>([]);
  const [sourceThumbs, setSourceThumbs] = useState<Map<number, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceThumbsRef = useRef<Map<number, string>>(new Map());
  const pendingThumbsRef = useRef<Set<number>>(new Set());
  const thumbnailGenerationRef = useRef(0);
  const directoryParam = data.params.directory;
  const savedDirectory = directoryParam && 'String' in directoryParam ? directoryParam.String : '';
  const visibleFolderName = folderName || savedDirectory.split('/').filter(Boolean).pop() || savedDirectory;
  const visibleCount = iteratorInfo?.count ?? fileCount;

  useEffect(() => {
    sourceThumbsRef.current = sourceThumbs;
  }, [sourceThumbs]);

  useEffect(() => {
    thumbnailGenerationRef.current += 1;
    setSourceThumbs(prev => {
      for (const url of prev.values()) URL.revokeObjectURL(url);
      return new Map();
    });
    pendingThumbsRef.current.clear();
  }, [iteratorInfo?.sourceNodeId, iteratorInfo?.count, visibleFolderName]);

  useEffect(() => {
    const generation = thumbnailGenerationRef.current;
    const queue = visibleThumbnailIndexes.filter(index => (
      !sourceThumbsRef.current.has(index) && !pendingThumbsRef.current.has(index)
    ));
    if (queue.length === 0) return;
    let cancelled = false;
    for (const index of queue) {
      pendingThumbsRef.current.add(index);
    }
    const worker = async () => {
      while (!cancelled && queue.length > 0) {
        const index = queue.shift();
        if (index === undefined) break;
        try {
          const bytes = await getBatchThumbnail(props.id, index, CAROUSEL_THUMBNAIL_MAX_EDGE);
          if (thumbnailGenerationRef.current !== generation || !bytes) continue;
          const buffer = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          const url = URL.createObjectURL(new Blob([buffer]));
          setSourceThumbs(prev => {
            if (thumbnailGenerationRef.current !== generation) {
              URL.revokeObjectURL(url);
              return prev;
            }
            if (prev.has(index)) {
              URL.revokeObjectURL(url);
              return prev;
            }
            const next = new Map(prev);
            next.set(index, url);
            while (next.size > MAX_CACHED_SOURCE_THUMBS) {
              const oldest = next.keys().next().value;
              if (oldest === undefined) break;
              const oldUrl = next.get(oldest);
              if (oldUrl) URL.revokeObjectURL(oldUrl);
              next.delete(oldest);
            }
            return next;
          });
        } finally {
          pendingThumbsRef.current.delete(index);
        }
      }
    };
    void Promise.all([worker(), worker()]);
    return () => {
      cancelled = true;
    };
  }, [getBatchThumbnail, props.id, visibleThumbnailIndexes]);

  const handleVisibleThumbnailIndexesChange = useCallback((indexes: number[]) => {
    setVisibleThumbnailIndexes(prev => (
      prev.length === indexes.length && prev.every((value, index) => value === indexes[index])
        ? prev
        : indexes
    ));
  }, []);

  useEffect(() => () => {
    thumbnailGenerationRef.current += 1;
    for (const url of sourceThumbsRef.current.values()) URL.revokeObjectURL(url);
  }, []);

  const selectBatchIndex = useCallback((index: number) => {
    if (!iteratorInfo) return;
    setActiveTransportSource(props.id);
    setCurrentFrame(iteratorInfo.startFrame + index);
  }, [iteratorInfo, props.id, setActiveTransportSource, setCurrentFrame]);

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
          {iteratorInfo && iteratorInfo.count > 0 && (
            <MediaVirtualStrip
              ariaLabel="Batch source images"
              count={iteratorInfo.count}
              itemSize={CAROUSEL_ITEM_SIZE}
              height={CAROUSEL_THUMB_SIZE + 10}
              overscan={CAROUSEL_OVERSCAN}
              activeIndex={isActiveTransport ? currentBatchIndex : undefined}
              className="nopan nodrag"
              onVisibleIndexesChange={handleVisibleThumbnailIndexesChange}
              style={{
                padding: '2px 0',
              }}
              renderItem={(index) => {
                const thumbnail = sourceThumbs.get(index);
                const active = isActiveTransport && index === currentBatchIndex;
                return (
                  <button
                    key={index}
                    type="button"
                    className="nopan nodrag"
                    onClick={() => selectBatchIndex(index)}
                    title={iteratorInfo.itemLabels[index] ?? `${index + 1}`}
                    style={{
                      position: 'absolute',
                      left: 4,
                      top: 2,
                      width: CAROUSEL_THUMB_SIZE,
                      height: CAROUSEL_THUMB_SIZE,
                      padding: 0,
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
                      cursor: 'pointer',
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
                  </button>
                );
              }}
            />
          )}
          <NodeStatus variant="info">
            {visibleCount > 0
              ? `${visibleCount} images loaded${isActiveTransport ? ` - ${currentBatchIndex + 1} / ${visibleCount}` : ''}`
              : 'Images loaded'}
          </NodeStatus>
        </NodeSection>
      ) : (
        <NodeStatus variant="info">No images loaded</NodeStatus>
      )}
    </BaseNode>
  );
};
