// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, NodeInstance, ViewerResult } from '../../store/types';
import { useGraphStore } from '../../store/graphStore';
import { Viewer } from '../Viewer';

vi.mock('react-zoom-pan-pinch', async () => {
  const ReactModule = await import('react');
  return {
    TransformWrapper: ReactModule.forwardRef<
      { centerView: () => void; setTransform: () => void; state: { scale: number; positionX: number; positionY: number } },
      { children: (utils: unknown) => React.ReactNode }
    >(({ children }, ref) => {
      ReactModule.useImperativeHandle(ref, () => ({
        centerView: vi.fn(),
        setTransform: vi.fn(),
        state: { scale: 1, positionX: 0, positionY: 0 },
      }));
      return <div>{children({})}</div>;
    }),
    TransformComponent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

vi.mock('../MediaVirtualStrip', async () => {
  const ReactModule = await import('react');
  return {
    MediaVirtualStrip: ({
      count,
      onVisibleIndexesChange,
      renderItem,
    }: {
      count: number;
      onVisibleIndexesChange?: (indexes: number[]) => void;
      renderItem: (index: number) => React.ReactNode;
    }) => {
      const indexes = Array.from({ length: Math.min(count, 3) }, (_, index) => index);
      ReactModule.useEffect(() => {
        onVisibleIndexesChange?.(indexes);
      }, [onVisibleIndexesChange, indexes]);
      return <div data-testid="mock-media-strip">{indexes.map(index => renderItem(index))}</div>;
    },
  };
});

const imageResult = (nodeId: string, frame: number): ViewerResult => ({
  type: 'image',
  nodeId,
  width: 1,
  height: 1,
  originalWidth: 1,
  originalHeight: 1,
  bufferWidth: 1,
  bufferHeight: 1,
  displayWidth: 1,
  displayHeight: 1,
  frame,
  pixels: new Uint8ClampedArray([255, 0, 0, 255]),
});

const batchNode: NodeInstance = {
  id: 'batch1',
  typeId: 'load_image_batch',
  position: { x: 0, y: 0 },
  params: {},
  inputDefaults: {},
  muted: false,
};

const viewerNode: NodeInstance = {
  id: 'viewer1',
  typeId: 'viewer',
  position: { x: 100, y: 0 },
  params: {},
  inputDefaults: {},
  muted: false,
};

const connections: Connection[] = [{
  id: 'c1',
  fromNode: 'batch1',
  fromPort: 'image',
  toNode: 'viewer1',
  toPort: 'value',
}];

const setupViewerState = () => {
  const getBatchThumbnail = vi.fn(async (_nodeId: string, index: number) => (
    new Uint8Array([index, 1, 2, 3])
  ));
  const triggerRender = vi.fn();
  useGraphStore.setState({
    nodes: new Map([
      [batchNode.id, batchNode],
      [viewerNode.id, viewerNode],
    ]),
    connections,
    selectedNodeIds: new Set([viewerNode.id]),
    renderResults: new Map([[viewerNode.id, imageResult(viewerNode.id, 0)]]),
    currentFrame: 0,
    activeTransportSourceId: batchNode.id,
    mediaIteratorInfoMap: new Map([[
      batchNode.id,
      {
        sourceNodeId: batchNode.id,
        kind: 'batch',
        label: 'assets',
        startFrame: 0,
        endFrame: 9,
        count: 10,
        itemLabels: ['dog', 'mona_lisa', 'portrait', 'mountain'],
        supportsRandomAccess: true,
      },
    ]]),
    getBatchThumbnail,
    triggerRender,
    lastError: null,
  });
  return { getBatchThumbnail, triggerRender };
};

describe('Viewer batch filmstrip thumbnails', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn((() => {
      let counter = 0;
      return () => `blob:viewer-thumb-${counter++}`;
    })());
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => ({
        imageSmoothingEnabled: true,
        putImageData: vi.fn(),
      })),
    });
    if (!globalThis.ImageData) {
      Object.defineProperty(globalThis, 'ImageData', {
        configurable: true,
        value: class ImageData {
          width: number;
          height: number;
          data: Uint8ClampedArray;

          constructor(width: number, height: number) {
            this.width = width;
            this.height = height;
            this.data = new Uint8ClampedArray(width * height * 4);
          }
        },
      });
    }
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads source thumbnails for visible batch items without rendering non-current frames', async () => {
    const { getBatchThumbnail, triggerRender } = setupViewerState();

    render(<Viewer />);

    await waitFor(() => expect(screen.getAllByTestId('viewer-filmstrip-source-thumbnail').length).toBeGreaterThan(0));
    expect(getBatchThumbnail.mock.calls.map(call => call[1])).toEqual([0, 1, 2]);
    expect(triggerRender).not.toHaveBeenCalled();
    expect(screen.getByTestId('mock-media-strip').querySelectorAll('button')).toHaveLength(3);
  });

  it('keeps filmstrip thumbnail clicks wired to the active frame', async () => {
    setupViewerState();

    render(<Viewer />);

    await waitFor(() => expect(screen.getByTitle('mona_lisa')).toBeTruthy());
    fireEvent.click(screen.getByTitle('mona_lisa'));

    expect(useGraphStore.getState().currentFrame).toBe(1);
  });
});
