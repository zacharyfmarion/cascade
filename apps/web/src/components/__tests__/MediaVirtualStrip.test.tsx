// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const virtualState = vi.hoisted(() => ({
  items: [
    { index: 0, key: 0, start: 0, size: 40 },
    { index: 1, key: 1, start: 40, size: 40 },
  ],
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => virtualState.items,
    getTotalSize: () => 400,
    measure: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}));

import { MediaVirtualStrip } from '../MediaVirtualStrip';

describe('MediaVirtualStrip', () => {
  afterEach(() => {
    cleanup();
    virtualState.items = [
      { index: 0, key: 0, start: 0, size: 40 },
      { index: 1, key: 1, start: 40, size: 40 },
    ];
    vi.clearAllMocks();
  });

  it('notifies when the virtualized visible index key changes', async () => {
    const onVisibleIndexesChange = vi.fn();
    const { rerender } = render(
      <MediaVirtualStrip
        ariaLabel="Frames"
        count={4}
        itemSize={40}
        height={48}
        onVisibleIndexesChange={onVisibleIndexesChange}
        renderItem={index => <span>{index}</span>}
      />,
    );

    await waitFor(() => expect(onVisibleIndexesChange).toHaveBeenLastCalledWith([0, 1]));

    virtualState.items.push({ index: 2, key: 2, start: 80, size: 40 });
    rerender(
      <MediaVirtualStrip
        ariaLabel="Frames"
        count={4}
        itemSize={40}
        height={48}
        onVisibleIndexesChange={onVisibleIndexesChange}
        renderItem={index => <span>{index}</span>}
      />,
    );

    await waitFor(() => expect(onVisibleIndexesChange).toHaveBeenLastCalledWith([0, 1, 2]));
  });
});
