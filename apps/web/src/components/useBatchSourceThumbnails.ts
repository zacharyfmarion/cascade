import { useEffect, useMemo, useRef, useState } from 'react';

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

const DEFAULT_CACHE_LIMIT = 120;
const DEFAULT_CONCURRENCY = 2;

const uniqueIndexes = (indexes: number[]): number[] => (
  Array.from(new Set(indexes.filter(index => Number.isInteger(index) && index >= 0)))
);

const bytesToBlobUrl = (bytes: Uint8Array): string => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return URL.createObjectURL(new Blob([copy.buffer], { type: 'image/png' }));
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
}: UseBatchSourceThumbnailsOptions): Map<number, string> => {
  const [thumbnails, setThumbnails] = useState<Map<number, string>>(new Map());
  const thumbnailsRef = useRef<Map<number, string>>(new Map());
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
      for (const url of prev.values()) URL.revokeObjectURL(url);
      return new Map();
    });
  }, [enabled, sourceNodeId, maxEdge, generationKey]);

  useEffect(() => () => {
    generationRef.current += 1;
    for (const url of thumbnailsRef.current.values()) URL.revokeObjectURL(url);
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
          const url = bytesToBlobUrl(bytes);
          setThumbnails(prev => {
            if (generationRef.current !== generation) {
              URL.revokeObjectURL(url);
              return prev;
            }
            if (prev.has(index)) {
              URL.revokeObjectURL(url);
              return prev;
            }

            const next = new Map(prev);
            next.set(index, url);
            const protectedIndexes = new Set(visibleIndexesRef.current);
            while (next.size > cacheLimit) {
              const evictIndex = [...next.keys()].find(key => !protectedIndexes.has(key))
                ?? next.keys().next().value;
              if (evictIndex === undefined) break;
              const evictUrl = next.get(evictIndex);
              if (evictUrl) URL.revokeObjectURL(evictUrl);
              next.delete(evictIndex);
            }
            return next;
          });
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
