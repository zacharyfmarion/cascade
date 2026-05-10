// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, NodeInstance, ViewerResult } from '../../store/types';
import { useGraphStore } from '../../store/graphStore';
import { Viewer } from '../Viewer';

const mediaStripState = vi.hoisted(() => ({
  estimateItemSize: undefined as undefined | ((index: number) => number),
}));

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
      estimateItemSize,
      onVisibleIndexesChange,
      renderItem,
    }: {
      count: number;
      estimateItemSize?: (index: number) => number;
      onVisibleIndexesChange?: (indexes: number[]) => void;
      renderItem: (index: number) => React.ReactNode;
    }) => {
      mediaStripState.estimateItemSize = estimateItemSize;
      const indexes = Array.from({ length: Math.min(count, 3) }, (_, index) => index);
      ReactModule.useEffect(() => {
        onVisibleIndexesChange?.(indexes);
      }, [onVisibleIndexesChange, indexes]);
      return <div data-testid="mock-media-strip">{indexes.map(index => renderItem(index))}</div>;
    },
  };
});

const pngBytes = (width: number, height: number) => {
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

const imageResult = (
  nodeId: string,
  frame: number,
  width = 1,
  height = 1,
  pixels = new Uint8ClampedArray([255, 0, 0, 255]),
): ViewerResult => ({
  type: 'image',
  nodeId,
  width,
  height,
  originalWidth: width,
  originalHeight: height,
  bufferWidth: width,
  bufferHeight: height,
  displayWidth: width,
  displayHeight: height,
  frame,
  pixels,
});

const batchNode: NodeInstance = {
  id: 'batch1',
  typeId: 'load_image_batch',
  position: { x: 0, y: 0 },
  params: {},
  inputDefaults: {},
  muted: false,
};

const sequenceNode: NodeInstance = {
  id: 'sequence1',
  typeId: 'load_image_sequence',
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
  const getBatchThumbnail = vi.fn(async (_nodeId: string, index: number, _maxEdge: number) => (
    index === 0 ? pngBytes(120, 80) : index === 1 ? pngBytes(40, 120) : pngBytes(90, 90)
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
    graphRevision: 0,
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
    mediaStripState.estimateItemSize = undefined;
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
    expect(getBatchThumbnail.mock.calls.map(call => call[2])).toEqual([128, 128, 128]);
    expect(triggerRender).not.toHaveBeenCalled();
    expect(screen.getByTestId('mock-media-strip').querySelectorAll('button')).toHaveLength(3);
    await waitFor(() => expect(mediaStripState.estimateItemSize?.(0)).not.toBe(mediaStripState.estimateItemSize?.(1)));
  });

  it('does not show a loaded batch filmstrip for an unconnected viewer', async () => {
    setupViewerState();
    act(() => {
      useGraphStore.setState({
        connections: [],
        activeTransportSourceId: batchNode.id,
      });
    });

    render(<Viewer />);

    await waitFor(() => expect(screen.queryByTestId('mock-media-strip')).toBeNull());
    await waitFor(() => expect(useGraphStore.getState().activeTransportSourceId).toBeNull());
  });

  it('clears the filmstrip when the upstream batch is disconnected', async () => {
    setupViewerState();

    render(<Viewer />);

    await waitFor(() => expect(screen.getByTestId('mock-media-strip')).toBeTruthy());

    act(() => {
      useGraphStore.setState({
        connections: [],
      });
    });

    await waitFor(() => expect(screen.queryByTestId('mock-media-strip')).toBeNull());
    await waitFor(() => expect(useGraphStore.getState().activeTransportSourceId).toBeNull());
  });

  it('uses the loaded media source upstream of the active viewer instead of another loaded batch', async () => {
    setupViewerState();
    const secondBatchNode: NodeInstance = {
      ...batchNode,
      id: 'batch2',
    };

    act(() => {
      useGraphStore.setState({
        nodes: new Map([
          [batchNode.id, batchNode],
          [secondBatchNode.id, secondBatchNode],
          [viewerNode.id, viewerNode],
        ]),
        connections: [{
          id: 'c2',
          fromNode: secondBatchNode.id,
          fromPort: 'image',
          toNode: viewerNode.id,
          toPort: 'value',
        }],
        activeTransportSourceId: batchNode.id,
        mediaIteratorInfoMap: new Map([
          [
            batchNode.id,
            {
              sourceNodeId: batchNode.id,
              kind: 'batch',
              label: 'first',
              startFrame: 0,
              endFrame: 2,
              count: 3,
              itemLabels: ['dog', 'mona_lisa', 'portrait'],
              supportsRandomAccess: true,
            },
          ],
          [
            secondBatchNode.id,
            {
              sourceNodeId: secondBatchNode.id,
              kind: 'batch',
              label: 'second',
              startFrame: 0,
              endFrame: 1,
              count: 2,
              itemLabels: ['cedar', 'ocean'],
              supportsRandomAccess: true,
            },
          ],
        ]),
      });
    });

    render(<Viewer />);

    await waitFor(() => expect(screen.getByTitle('cedar')).toBeTruthy());
    expect(screen.queryByTitle('dog')).toBeNull();
    await waitFor(() => expect(useGraphStore.getState().activeTransportSourceId).toBe(secondBatchNode.id));
  });

  it('hides the filmstrip when multiple loaded media sources are upstream', async () => {
    setupViewerState();
    const secondBatchNode: NodeInstance = {
      ...batchNode,
      id: 'batch2',
    };
    const blendNode: NodeInstance = {
      id: 'blend1',
      typeId: 'blend',
      position: { x: 50, y: 0 },
      params: {},
      inputDefaults: {},
      muted: false,
    };

    act(() => {
      useGraphStore.setState({
        nodes: new Map([
          [batchNode.id, batchNode],
          [secondBatchNode.id, secondBatchNode],
          [blendNode.id, blendNode],
          [viewerNode.id, viewerNode],
        ]),
        connections: [
          {
            id: 'c1',
            fromNode: batchNode.id,
            fromPort: 'image',
            toNode: blendNode.id,
            toPort: 'a',
          },
          {
            id: 'c2',
            fromNode: secondBatchNode.id,
            fromPort: 'image',
            toNode: blendNode.id,
            toPort: 'b',
          },
          {
            id: 'c3',
            fromNode: blendNode.id,
            fromPort: 'image',
            toNode: viewerNode.id,
            toPort: 'value',
          },
        ],
        activeTransportSourceId: batchNode.id,
        mediaIteratorInfoMap: new Map([
          [
            batchNode.id,
            {
              sourceNodeId: batchNode.id,
              kind: 'batch',
              label: 'first',
              startFrame: 0,
              endFrame: 2,
              count: 3,
              itemLabels: ['dog', 'mona_lisa', 'portrait'],
              supportsRandomAccess: true,
            },
          ],
          [
            secondBatchNode.id,
            {
              sourceNodeId: secondBatchNode.id,
              kind: 'batch',
              label: 'second',
              startFrame: 0,
              endFrame: 1,
              count: 2,
              itemLabels: ['cedar', 'ocean'],
              supportsRandomAccess: true,
            },
          ],
        ]),
      });
    });

    render(<Viewer />);

    await waitFor(() => expect(screen.queryByTestId('mock-media-strip')).toBeNull());
    await waitFor(() => expect(useGraphStore.getState().activeTransportSourceId).toBeNull());
  });

  it('keeps filmstrip thumbnail clicks wired to the active frame', async () => {
    setupViewerState();

    render(<Viewer />);

    await waitFor(() => expect(screen.getByTitle('mona_lisa')).toBeTruthy());
    fireEvent.click(screen.getByTitle('mona_lisa'));

    expect(useGraphStore.getState().currentFrame).toBe(1);
  });

  it('keeps processed thumbnails for visited frames and prefers them over source thumbnails', async () => {
    setupViewerState();

    render(<Viewer />);

    await waitFor(() => expect(within(screen.getByTitle('dog')).getByTestId('viewer-filmstrip-processed-thumbnail')).toBeTruthy());

    act(() => {
      useGraphStore.setState({
        currentFrame: 1,
        renderResults: new Map([[viewerNode.id, imageResult(viewerNode.id, 1)]]),
      });
    });

    await waitFor(() => expect(within(screen.getByTitle('mona_lisa')).getByTestId('viewer-filmstrip-processed-thumbnail')).toBeTruthy());
    expect(within(screen.getByTitle('dog')).getByTestId('viewer-filmstrip-processed-thumbnail')).toBeTruthy();
    expect(within(screen.getByTitle('dog')).queryByTestId('viewer-filmstrip-source-thumbnail')).toBeNull();
  });

  it('invalidates processed thumbnails when the graph revision changes', async () => {
    setupViewerState();

    render(<Viewer />);

    await waitFor(() => expect(within(screen.getByTitle('dog')).getByTestId('viewer-filmstrip-processed-thumbnail')).toBeTruthy());

    act(() => {
      useGraphStore.setState({
        currentFrame: 1,
        graphRevision: 1,
        renderResults: new Map([[viewerNode.id, imageResult(viewerNode.id, 1)]]),
      });
    });

    await waitFor(() => expect(within(screen.getByTitle('mona_lisa')).getByTestId('viewer-filmstrip-processed-thumbnail')).toBeTruthy());
    await waitFor(() => expect(within(screen.getByTitle('dog')).queryByTestId('viewer-filmstrip-processed-thumbnail')).toBeNull());
    expect(within(screen.getByTitle('dog')).getByTestId('viewer-filmstrip-source-thumbnail')).toBeTruthy();
  });
});

describe('Viewer sequence playback compatibility', () => {
  beforeEach(() => {
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

  it('does not show the batch filmstrip for image sequences and keeps the last rendered frame visible during playback', async () => {
    useGraphStore.setState({
      nodes: new Map([
        [sequenceNode.id, sequenceNode],
        [viewerNode.id, viewerNode],
      ]),
      connections: [{
        id: 'sequence-to-viewer',
        fromNode: sequenceNode.id,
        fromPort: 'image',
        toNode: viewerNode.id,
        toPort: 'value',
      }],
      selectedNodeIds: new Set([viewerNode.id]),
      renderResults: new Map([[viewerNode.id, imageResult(viewerNode.id, 97, 12, 8)]]),
      currentFrame: 98,
      graphRevision: 0,
      activeTransportSourceId: sequenceNode.id,
      mediaIteratorInfoMap: new Map([[
        sequenceNode.id,
        {
          sourceNodeId: sequenceNode.id,
          kind: 'sequence',
          label: 'cloudy_evening_1',
          startFrame: 1,
          endFrame: 192,
          count: 192,
          itemLabels: [],
          supportsRandomAccess: true,
        },
      ]]),
      lastError: null,
      playbackFps: 23.8,
      fps: 24,
    });

    render(<Viewer />);

    await waitFor(() => expect(screen.getByText('12×8')).toBeTruthy());
    expect(screen.queryByText('No output')).toBeNull();
    expect(screen.queryByTestId('mock-media-strip')).toBeNull();
    expect(screen.getByText('24 fps')).toBeTruthy();
  });
});
