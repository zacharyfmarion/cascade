import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sequenceFrameManager } from '../engine/sequenceFrameManager';
import { copyBytesForTransfer } from '../engine/transferableBytes';

describe('sequenceFrameManager', () => {
  beforeEach(() => {
    sequenceFrameManager.clearAll();
  });

  it('keeps cached frame bytes reusable when a transfer copy is detached', async () => {
    sequenceFrameManager.setFiles('seq-1', [
      new File([new Uint8Array([1, 2, 3, 4])], 'plate_0001.png'),
    ]);

    const cached = await sequenceFrameManager.getFrameData('seq-1', 1);
    expect(cached).not.toBeNull();
    if (!cached) throw new Error('expected cached sequence bytes');

    const transferData = copyBytesForTransfer(cached);
    expect(transferData.buffer).not.toBe(cached.buffer);

    structuredClone(transferData, { transfer: [transferData.buffer] });
    expect(transferData.byteLength).toBe(0);

    const cachedAgain = await sequenceFrameManager.getFrameData('seq-1', 1);
    expect(cachedAgain).toBe(cached);
    expect(cachedAgain?.byteLength).toBe(4);
    expect(Array.from(cachedAgain ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('prefetches frame bytes into the reusable cache', async () => {
    sequenceFrameManager.setFiles('seq-1', [
      new File([new Uint8Array([1])], 'plate_0001.png'),
      new File([new Uint8Array([2])], 'plate_0002.png'),
    ]);

    await sequenceFrameManager.prefetchFrames('seq-1', 2, 1);
    const prefetched = await sequenceFrameManager.getFrameData('seq-1', 2);

    expect(Array.from(prefetched ?? [])).toEqual([2]);
  });

  it('deduplicates in-flight frame reads', async () => {
    let resolveRead: (buffer: ArrayBuffer) => void = () => {};
    const file = new File([new Uint8Array([7])], 'plate_0001.png');
    const arrayBuffer = vi.fn(() => new Promise<ArrayBuffer>((resolve) => {
      resolveRead = resolve;
    }));
    Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer });
    sequenceFrameManager.setFiles('seq-1', [file]);

    const first = sequenceFrameManager.getFrameData('seq-1', 1);
    const second = sequenceFrameManager.getFrameData('seq-1', 1);
    resolveRead(new Uint8Array([7]).buffer);

    await expect(first).resolves.toEqual(new Uint8Array([7]));
    await expect(second).resolves.toEqual(new Uint8Array([7]));
    expect(arrayBuffer).toHaveBeenCalledOnce();
  });
});
