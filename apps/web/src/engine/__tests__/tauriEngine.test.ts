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
});
