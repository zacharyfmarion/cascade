// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BatchThumbnailLoader,
  useBatchSourceThumbnails,
} from '../useBatchSourceThumbnails';

const bytesFor = (index: number, width = 40 + index, height = 30 + index) => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(innerResolve => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

const Probe: React.FC<{
  sourceNodeId?: string | null;
  visibleIndexes: number[];
  loader: BatchThumbnailLoader;
  cacheLimit?: number;
  concurrency?: number;
  generationKey?: string;
}> = ({
  sourceNodeId = 'batch1',
  visibleIndexes,
  loader,
  cacheLimit,
  concurrency,
  generationKey,
}) => {
  const thumbnails = useBatchSourceThumbnails({
    sourceNodeId,
    visibleIndexes,
    maxEdge: 96,
    getThumbnail: loader,
    cacheLimit,
    concurrency,
    generationKey,
  });

  return (
    <div>
      {[...thumbnails.entries()].map(([index, thumbnail]) => (
        <span key={index} data-testid={`thumb-${index}`}>
          {thumbnail.url}:{thumbnail.width}x{thumbnail.height}
        </span>
      ))}
    </div>
  );
};

describe('useBatchSourceThumbnails', () => {
  let urlCounter = 0;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    urlCounter = 0;
    createObjectURL = vi.fn(() => `blob:thumb-${urlCounter++}`);
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('requests only visible indexes and dedupes cached thumbnails', async () => {
    const loader = vi.fn(async (_source: string, index: number) => bytesFor(index));
    const { rerender } = render(
      <Probe visibleIndexes={[0, 1, 1]} loader={loader} />,
    );

    await waitFor(() => expect(screen.getByTestId('thumb-0')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('thumb-1')).toBeTruthy());
    expect(screen.getByTestId('thumb-0').textContent).toContain('40x30');
    expect(screen.getByTestId('thumb-1').textContent).toContain('41x31');
    expect(loader.mock.calls.map(call => call[1])).toEqual([0, 1]);

    rerender(<Probe visibleIndexes={[1, 2]} loader={loader} />);

    await waitFor(() => expect(screen.getByTestId('thumb-2')).toBeTruthy());
    expect(loader.mock.calls.map(call => call[1])).toEqual([0, 1, 2]);
  });

  it('limits concurrent thumbnail requests', async () => {
    let active = 0;
    let maxActive = 0;
    const loader = vi.fn(async (_source: string, index: number) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return bytesFor(index);
    });

    render(
      <Probe
        visibleIndexes={[0, 1, 2, 3, 4]}
        loader={loader}
        concurrency={2}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('thumb-4')).toBeTruthy());
    expect(loader).toHaveBeenCalledTimes(5);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('ignores stale responses after the source changes', async () => {
    const oldRequest = createDeferred<Uint8Array>();
    const newRequest = createDeferred<Uint8Array>();
    const loader = vi.fn((source: string) => (
      source === 'old' ? oldRequest.promise : newRequest.promise
    ));
    const { rerender } = render(
      <Probe sourceNodeId="old" visibleIndexes={[0]} loader={loader} />,
    );

    await waitFor(() => expect(loader).toHaveBeenCalledWith('old', 0, 96));
    rerender(<Probe sourceNodeId="new" visibleIndexes={[0]} loader={loader} />);
    await waitFor(() => expect(loader).toHaveBeenCalledWith('new', 0, 96));

    oldRequest.resolve(bytesFor(0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(createObjectURL).not.toHaveBeenCalled();

    newRequest.resolve(bytesFor(0));
    await waitFor(() => expect(screen.getByTestId('thumb-0')).toBeTruthy());
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('continues loading queued thumbnails after one request fails', async () => {
    const loader = vi.fn(async (_source: string, index: number) => {
      if (index === 1) throw new Error('bad thumbnail');
      return bytesFor(index);
    });

    render(
      <Probe visibleIndexes={[0, 1, 2]} loader={loader} concurrency={1} />,
    );

    await waitFor(() => expect(screen.getByTestId('thumb-0')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('thumb-2')).toBeTruthy());
    expect(screen.queryByTestId('thumb-1')).toBeNull();
    expect(loader.mock.calls.map(call => call[1])).toEqual([0, 1, 2]);
  });

  it('does not publish thumbnails that finish after the visible generation is cancelled', async () => {
    const oldRequest = createDeferred<Uint8Array>();
    const loader = vi.fn(() => oldRequest.promise);
    const { rerender } = render(
      <Probe visibleIndexes={[0]} loader={loader} generationKey="old" />,
    );

    await waitFor(() => expect(loader).toHaveBeenCalledWith('batch1', 0, 96));
    rerender(<Probe visibleIndexes={[]} loader={loader} generationKey="new" />);

    oldRequest.resolve(bytesFor(0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByTestId('thumb-0')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledTimes(0);
  });

  it('retries queued indexes after a visible range change cancels an old worker', async () => {
    const requests = new Map<number, ReturnType<typeof createDeferred<Uint8Array>>>();
    const loader = vi.fn((_source: string, index: number) => {
      const request = createDeferred<Uint8Array>();
      requests.set(index, request);
      return request.promise;
    });

    const { rerender } = render(
      <Probe visibleIndexes={[0, 1, 2]} loader={loader} concurrency={1} />,
    );

    await waitFor(() => expect(loader).toHaveBeenCalledWith('batch1', 0, 96));
    rerender(<Probe visibleIndexes={[0, 1, 2, 3]} loader={loader} concurrency={1} />);

    requests.get(0)?.resolve(bytesFor(0));
    await waitFor(() => expect(screen.getByTestId('thumb-0')).toBeTruthy());
    await waitFor(() => expect(loader).toHaveBeenCalledWith('batch1', 1, 96));

    requests.get(1)?.resolve(bytesFor(1));
    await waitFor(() => expect(screen.getByTestId('thumb-1')).toBeTruthy());
    await waitFor(() => expect(loader).toHaveBeenCalledWith('batch1', 2, 96));

    requests.get(2)?.resolve(bytesFor(2));
    await waitFor(() => expect(screen.getByTestId('thumb-2')).toBeTruthy());
  });

  it('revokes object URLs on eviction and unmount', async () => {
    const loader = vi.fn(async (_source: string, index: number) => bytesFor(index));
    const { unmount } = render(
      <Probe
        visibleIndexes={[0, 1, 2]}
        loader={loader}
        cacheLimit={2}
        concurrency={3}
      />,
    );

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(1));

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(3);
  });
});
