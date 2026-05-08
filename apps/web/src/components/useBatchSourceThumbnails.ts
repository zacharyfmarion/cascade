import { useEffect, useMemo, useRef, useState } from 'react';
import { readPngDimensions } from './mediaThumbnailSizing';

export type BatchThumbnailLoader = (
  sourceNodeId: string,
  index: number,
  maxEdge: number,
) => Promise<Uint8Array | null> | Uint8Array | null;

interface UseBatchSourceThumbnailsOptions {
  sourceNodeId: string | null | undefined;
  visibleIndexes: number[];
  maxEdge: number;
  getThumbnail: BatchThumbnailLoader;
  cacheLimit?: number;
  concurrency?: number;
  enabled?: boolean;
  generationKey?: string | number;
}

export interface BatchSourceThumbnail {
  url: string;
  width: number;
  height: number;
}

const DEFAULT_CACHE_LIMIT = 120;
const DEFAULT_CONCURRENCY = 2;

const uniqueIndexes = (indexes: number[]): number[] => (
  Array.from(new Set(indexes.filter(index => Number.isInteger(index) && index >= 0)))
);

const decodeImageDimensions = async (blob: Blob, url: string): Promise<{ width: number; height: number }> => {
  if ('createImageBitmap' in globalThis) {
    const bitmap = await createImageBitmap(blob);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('Failed to decode thumbnail dimensions'));
    image.src = url;
  });
};

const bytesToThumbnail = async (bytes: Uint8Array): Promise<BatchSourceThumbnail> => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const dimensionsFromPng = readPngDimensions(copy);
  const blob = new Blob([copy.buffer], { type: 'image/png' });
  const url = URL.createObjectURL(blob);

  try {
    const dimensions = dimensionsFromPng ?? await decodeImageDimensions(blob, url);
    return {
      url,
      width: dimensions.width,
      height: dimensions.height,
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
};

const revokeThumbnail = (thumbnail: BatchSourceThumbnail) => {
  URL.revokeObjectURL(thumbnail.url);
};

export const useBatchSourceThumbnails = ({
  sourceNodeId,
  visibleIndexes,
  maxEdge,
  getThumbnail,
  cacheLimit = DEFAULT_CACHE_LIMIT,
  concurrency = DEFAULT_CONCURRENCY,
  enabled = true,
  generationKey = '',
}: UseBatchSourceThumbnailsOptions): Map<number, BatchSourceThumbnail> => {
  const [thumbnails, setThumbnails] = useState<Map<number, BatchSourceThumbnail>>(new Map());
  const thumbnailsRef = useRef<Map<number, BatchSourceThumbnail>>(new Map());
  const pendingRef = useRef<Set<number>>(new Set());
  const generationRef = useRef(0);
  const visibleIndexesRef = useRef<number[]>([]);

  const normalizedVisibleIndexes = useMemo(
    () => uniqueIndexes(visibleIndexes),
    [visibleIndexes],
  );

  useEffect(() => {
    thumbnailsRef.current = thumbnails;
  }, [thumbnails]);

  useEffect(() => {
    visibleIndexesRef.current = normalizedVisibleIndexes;
  }, [normalizedVisibleIndexes]);

  useEffect(() => {
    generationRef.current += 1;
    pendingRef.current.clear();
    setThumbnails(prev => {
      for (const thumbnail of prev.values()) revokeThumbnail(thumbnail);
      return new Map();
    });
  }, [enabled, sourceNodeId, maxEdge, generationKey]);

  useEffect(() => () => {
    generationRef.current += 1;
    for (const thumbnail of thumbnailsRef.current.values()) revokeThumbnail(thumbnail);
    pendingRef.current.clear();
  }, []);

  useEffect(() => {
    if (!enabled || !sourceNodeId || normalizedVisibleIndexes.length === 0) return;
    const generation = generationRef.current;
    const queue = normalizedVisibleIndexes.filter(index => (
      !thumbnailsRef.current.has(index) && !pendingRef.current.has(index)
    ));
    if (queue.length === 0) return;

    for (const index of queue) pendingRef.current.add(index);
    let cancelled = false;
    const workerCount = Math.max(1, Math.min(concurrency, queue.length));

    const worker = async () => {
      while (!cancelled && queue.length > 0) {
        const index = queue.shift();
        if (index === undefined) break;
        try {
          const bytes = await getThumbnail(sourceNodeId, index, maxEdge);
          if (cancelled || generationRef.current !== generation || !bytes) continue;
          const thumbnail = await bytesToThumbnail(bytes);
          if (cancelled || generationRef.current !== generation) {
            revokeThumbnail(thumbnail);
            continue;
          }
          setThumbnails(prev => {
            if (generationRef.current !== generation) {
              revokeThumbnail(thumbnail);
              return prev;
            }
            if (prev.has(index)) {
              revokeThumbnail(thumbnail);
              return prev;
            }

            const next = new Map(prev);
            next.set(index, thumbnail);
            const protectedIndexes = new Set(visibleIndexesRef.current);
            while (next.size > cacheLimit) {
              const evictIndex = [...next.keys()].find(key => !protectedIndexes.has(key))
                ?? next.keys().next().value;
              if (evictIndex === undefined) break;
              const evictThumbnail = next.get(evictIndex);
              if (evictThumbnail) revokeThumbnail(evictThumbnail);
              next.delete(evictIndex);
            }
            return next;
          });
        } catch (err) {
          if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
            console.warn('Failed to load batch thumbnail', { sourceNodeId, index, err });
          }
        } finally {
          pendingRef.current.delete(index);
        }
      }
    };

    void Promise.all(Array.from({ length: workerCount }, worker));
    return () => {
      cancelled = true;
    };
  }, [
    cacheLimit,
    concurrency,
    enabled,
    generationKey,
    getThumbnail,
    maxEdge,
    normalizedVisibleIndexes,
    sourceNodeId,
  ]);

  return thumbnails;
};
