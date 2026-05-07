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
const CAROUSEL_ITEM_SIZE = 52;
const CAROUSEL_THUMB_SIZE = 44;
const CAROUSEL_OVERSCAN = 4;

export const LoadImageBatchNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const loadBatchFiles = useGraphStore(s => s.loadBatchFiles);
  const loadBatchPaths = useGraphStore(s => s.loadBatchPaths);
  const loadBatchDirectory = useGraphStore(s => s.loadBatchDirectory);
  const getBatchImageData = useGraphStore(s => s.getBatchImageData);
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
  const [carouselViewport, setCarouselViewport] = useState({ scrollLeft: 0, width: 0 });
  const [sourceThumbs, setSourceThumbs] = useState<Map<number, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const sourceThumbsRef = useRef<Map<number, string>>(new Map());
  const pendingThumbsRef = useRef<Set<number>>(new Set());
  const thumbnailGenerationRef = useRef(0);
  const directoryParam = data.params.directory;
  const savedDirectory = directoryParam && 'String' in directoryParam ? directoryParam.String : '';
  const visibleFolderName = folderName || savedDirectory.split('/').filter(Boolean).pop() || savedDirectory;
  const visibleCount = iteratorInfo?.count ?? fileCount;
  const previewIndices = useMemo(() => {
    if (!iteratorInfo || iteratorInfo.count <= 0) return [];
    const viewportWidth = carouselViewport.width || CAROUSEL_ITEM_SIZE * 5;
    const start = Math.max(
      0,
      Math.floor(carouselViewport.scrollLeft / CAROUSEL_ITEM_SIZE) - CAROUSEL_OVERSCAN,
    );
    const end = Math.min(
      iteratorInfo.count - 1,
      Math.ceil((carouselViewport.scrollLeft + viewportWidth) / CAROUSEL_ITEM_SIZE) + CAROUSEL_OVERSCAN,
    );
    const indices: number[] = [];
    for (let index = start; index <= end; index += 1) {
      indices.push(index);
    }
    return indices;
  }, [carouselViewport, iteratorInfo]);

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
    const carousel = carouselRef.current;
    if (!carousel) return;
    const updateViewport = () => {
      setCarouselViewport({
        scrollLeft: carousel.scrollLeft,
        width: carousel.clientWidth,
      });
    };
    updateViewport();
    carousel.addEventListener('scroll', updateViewport, { passive: true });
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateViewport)
      : null;
    observer?.observe(carousel);
    return () => {
      carousel.removeEventListener('scroll', updateViewport);
      observer?.disconnect();
    };
  }, [iteratorInfo?.sourceNodeId]);

  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel || !iteratorInfo || !isActiveTransport) return;
    const itemLeft = currentBatchIndex * CAROUSEL_ITEM_SIZE;
    const itemRight = itemLeft + CAROUSEL_ITEM_SIZE;
    const viewportLeft = carousel.scrollLeft;
    const viewportRight = viewportLeft + carousel.clientWidth;
    if (itemLeft >= viewportLeft && itemRight <= viewportRight) return;
    carousel.scrollLeft = Math.max(
      0,
      itemLeft - Math.max(0, carousel.clientWidth - CAROUSEL_ITEM_SIZE) / 2,
    );
  }, [currentBatchIndex, isActiveTransport, iteratorInfo]);

  useEffect(() => {
    const generation = thumbnailGenerationRef.current;
    for (const index of previewIndices) {
      if (sourceThumbsRef.current.has(index) || pendingThumbsRef.current.has(index)) continue;
      pendingThumbsRef.current.add(index);
      void getBatchImageData(props.id, index).then(bytes => {
        if (thumbnailGenerationRef.current !== generation || !bytes) return;
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
          while (next.size > 80) {
            const oldest = next.keys().next().value;
            if (oldest === undefined) break;
            const oldUrl = next.get(oldest);
            if (oldUrl) URL.revokeObjectURL(oldUrl);
            next.delete(oldest);
          }
          return next;
        });
      }).finally(() => {
        pendingThumbsRef.current.delete(index);
      });
    }
  }, [getBatchImageData, previewIndices, props.id]);

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
            <div
              ref={carouselRef}
              className="nopan nodrag"
              style={{
                position: 'relative',
                height: CAROUSEL_THUMB_SIZE + 10,
                overflowX: 'auto',
                overflowY: 'hidden',
                padding: '2px 0',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: iteratorInfo.count * CAROUSEL_ITEM_SIZE,
                  height: '100%',
                }}
              >
                {previewIndices.map(index => {
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
                        left: index * CAROUSEL_ITEM_SIZE + 4,
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
                })}
              </div>
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
