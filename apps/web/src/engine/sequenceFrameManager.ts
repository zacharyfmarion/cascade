import type { SequenceInfo } from './bridge';

interface SequenceEntry {
  files: File[];
  frameNumbers: number[];
  byteCache: Map<number, Uint8Array>;
  byteCacheBytes: number;
  inflightReads: Map<number, Promise<Uint8Array | null>>;
}

const MAX_BYTE_CACHE_SIZE = 32;
const MAX_BYTE_CACHE_BYTES = 128 * 1024 * 1024;

export function inferFrameNumber(filename: string): number | null {
  const numericRuns = [...filename.matchAll(/\d+/g)];
  if (numericRuns.length === 0) return null;

  let best = numericRuns[0];
  for (const m of numericRuns) {
    if (m[0].length >= best[0].length) {
      best = m;
    }
  }
  return parseInt(best[0], 10);
}

export function inferPattern(filename: string): string {
  const numericRuns = [...filename.matchAll(/\d+/g)];
  if (numericRuns.length === 0) return filename;

  let best = numericRuns[0];
  for (const m of numericRuns) {
    if (m[0].length >= best[0].length) {
      best = m;
    }
  }

  const padding = best[0].length;
  const idx = best.index!;
  return (
    filename.substring(0, idx) +
    `{frame:${padding}}` +
    filename.substring(idx + best[0].length)
  );
}

export class SequenceFrameManager {
  private sequences = new Map<string, SequenceEntry>();

  setFiles(nodeId: string, files: File[]): { info: SequenceInfo; pattern: string } {
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const frameNumbers: number[] = [];
    const validFiles: File[] = [];

    for (const file of sorted) {
      const frame = inferFrameNumber(file.name);
      if (frame !== null) {
        frameNumbers.push(frame);
        validFiles.push(file);
      }
    }

    this.sequences.set(nodeId, {
      files: validFiles,
      frameNumbers,
      byteCache: new Map(),
      byteCacheBytes: 0,
      inflightReads: new Map(),
    });

    const pattern = validFiles.length > 0 ? inferPattern(validFiles[0].name) : '{frame:4}.png';

    const info: SequenceInfo = frameNumbers.length > 0
      ? {
          frame_count: frameNumbers.length,
          first_frame: Math.min(...frameNumbers),
          last_frame: Math.max(...frameNumbers),
        }
      : { frame_count: 0, first_frame: 0, last_frame: 0 };

    return { info, pattern };
  }

  async getFrameData(nodeId: string, frame: number): Promise<Uint8Array | null> {
    const entry = this.sequences.get(nodeId);
    if (!entry) return null;

    const cached = entry.byteCache.get(frame);
    if (cached) {
      entry.byteCache.delete(frame);
      entry.byteCache.set(frame, cached);
      return cached;
    }

    const inflight = entry.inflightReads.get(frame);
    if (inflight) return inflight;

    const readPromise = this.readFrameData(entry, frame)
      .finally(() => {
        entry.inflightReads.delete(frame);
      });
    entry.inflightReads.set(frame, readPromise);
    return readPromise;
  }

  async prefetchFrames(nodeId: string, startFrame: number, count: number): Promise<void> {
    const reads: Array<Promise<Uint8Array | null>> = [];
    for (let offset = 0; offset < count; offset += 1) {
      reads.push(this.getFrameData(nodeId, startFrame + offset));
    }
    await Promise.allSettled(reads);
  }

  private async readFrameData(entry: SequenceEntry, frame: number): Promise<Uint8Array | null> {
    const cached = entry.byteCache.get(frame);
    if (cached) return cached;

    const idx = entry.frameNumbers.indexOf(frame);
    if (idx === -1) return null;

    const file = entry.files[idx];
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);

    this.insertCachedBytes(entry, frame, data);

    return data;
  }

  private insertCachedBytes(entry: SequenceEntry, frame: number, data: Uint8Array): void {
    const existing = entry.byteCache.get(frame);
    if (existing) {
      entry.byteCacheBytes -= existing.byteLength;
      entry.byteCache.delete(frame);
    }

    entry.byteCache.set(frame, data);
    entry.byteCacheBytes += data.byteLength;

    while (entry.byteCache.size > 1
      && (entry.byteCache.size > MAX_BYTE_CACHE_SIZE
        || entry.byteCacheBytes > MAX_BYTE_CACHE_BYTES)) {
      const oldest = entry.byteCache.keys().next().value;
      if (oldest === undefined || oldest === frame) break;
      const evicted = entry.byteCache.get(oldest);
      if (evicted) {
        entry.byteCacheBytes -= evicted.byteLength;
      }
      entry.byteCache.delete(oldest);
    }
  }

  hasSequence(nodeId: string): boolean {
    return this.sequences.has(nodeId);
  }

  clear(nodeId: string): void {
    this.sequences.delete(nodeId);
  }

  clearAll(): void {
    this.sequences.clear();
  }
}

export const sequenceFrameManager = new SequenceFrameManager();
