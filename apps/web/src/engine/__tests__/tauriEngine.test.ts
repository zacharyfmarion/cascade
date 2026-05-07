import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

describe('TauriEngine AI bridge', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('runs AI nodes through the desktop command bridge', async () => {
    const { TauriEngine } = await import('../tauriEngine');
    const engine = new TauriEngine();
    invokeMock.mockResolvedValue(undefined);

    await engine.runAiNode('node-1');

    expect(invokeMock).toHaveBeenCalledWith('run_ai_node', { nodeId: 'node-1' });
  });

  it('reads AI node execution state from the desktop command bridge', async () => {
    const { TauriEngine } = await import('../tauriEngine');
    const engine = new TauriEngine();
    invokeMock.mockResolvedValue(JSON.stringify({
      status: 'error',
      isStale: true,
      error: 'API failure',
    }));

    await expect(engine.getNodeExecutionState('node-1')).resolves.toEqual({
      status: 'error',
      isStale: true,
      error: 'API failure',
    });
    expect(invokeMock).toHaveBeenCalledWith('get_node_execution_state', { nodeId: 'node-1' });
  });

  it('passes previewScale through root viewer renders', async () => {
    const { TauriEngine } = await import('../tauriEngine');
    const engine = new TauriEngine();
    const buf = new ArrayBuffer(21);
    const view = new DataView(buf);
    view.setUint8(0, 0);
    view.setUint32(1, 1, true);
    view.setUint32(5, 1, true);
    view.setUint32(9, 2, true);
    view.setUint32(13, 3, true);
    new Uint8ClampedArray(buf, 17).set([1, 2, 3, 255]);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'render_viewer') return buf;
      if (command === 'get_last_render_timings') return '{}';
      return undefined;
    });

    await expect(engine.renderViewer('viewer-1', 12, 0.25)).resolves.toMatchObject({
      originalWidth: 2,
      originalHeight: 3,
    });

    expect(invokeMock).toHaveBeenCalledWith('render_viewer', {
      viewerNodeId: 'viewer-1',
      frame: 12,
      previewScale: 0.25,
    });
  });
});
