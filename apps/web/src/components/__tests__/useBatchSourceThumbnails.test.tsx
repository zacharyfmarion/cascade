// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BatchThumbnailLoader,
  useBatchSourceThumbnails,
} from '../useBatchSourceThumbnails';

const bytesFor = (index: number) => new Uint8Array([index, 1, 2, 3]);

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
      {[...thumbnails.entries()].map(([index, url]) => (
        <span key={index} data-testid={`thumb-${index}`}>
          {url}
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
