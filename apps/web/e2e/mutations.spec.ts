import { test, expect } from '@playwright/test';

type GraphNodeData = {
  id: string;
  type_id: string;
  params?: Record<string, unknown>;
  input_defaults?: Record<string, unknown>;
};

type GraphConnectionData = {
  from_node: string;
  from_port: string;
  to_node: string;
  to_port: string;
};

type GraphData = {
  nodes?: GraphNodeData[];
  connections?: GraphConnectionData[];
};

async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30_000 });
  await page.waitForFunction(() => !!(window as any).__compositorTest, { timeout: 10_000 });
  await page.evaluate(() => (window as any).__compositorTest.waitForEngine());
}

async function harness(page: import('@playwright/test').Page, method: string, ...args: unknown[]) {
  return page.evaluate(
    ({ method, args }) => {
      const h = (window as any).__compositorTest;
      const fn = h[method];
      if (typeof fn !== 'function') throw new Error(`Harness method ${method} not found`);
      return fn.apply(h, args);
    },
    { method, args },
  );
}

const extractGraph = (data: unknown): GraphData => {
  if (data && typeof data === 'object' && 'graph' in (data as any)) {
    return ((data as any).graph ?? {}) as GraphData;
  }
  return (data ?? {}) as GraphData;
};


const normalizeGraph = (graph: GraphData) => {
  const nodes = [...(graph.nodes ?? [])].map(node => ({
    ...node,
    params: node.params ?? {},
    input_defaults: node.input_defaults ?? {},
  }));
  const connections = [...(graph.connections ?? [])];
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  connections.sort((a, b) => {
    const left = `${a.from_node}:${a.from_port}->${a.to_node}:${a.to_port}`;
    const right = `${b.from_node}:${b.from_port}->${b.to_node}:${b.to_port}`;
    return left.localeCompare(right);
  });
  return { nodes, connections };
};

test.describe('Undo/redo across mutation types', () => {
  test('add → connect → setParam, then undo/redo each step', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const resizeId = await harness(page, 'addNode', 'resize', { x: 300, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 600, y: 100 });
    await harness(page, 'connect', solidId, 'field', resizeId, 'image');
    await harness(page, 'connect', resizeId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const resultBefore = await harness(page, 'getViewerResult', viewerId);
    expect(resultBefore).not.toBeNull();
    const widthBefore = resultBefore?.width ?? null;

    await harness(page, 'setParam', resizeId, 'width', { Int: 640 });
    await harness(page, 'waitForRenderIdle');

    const resultAfter = await harness(page, 'getViewerResult', viewerId);
    expect(resultAfter?.width).toBe(640);
    expect(resultAfter?.width).not.toBe(widthBefore);

    await harness(page, 'undo');
    await harness(page, 'waitForRenderIdle');
    const resultAfterUndoParam = await harness(page, 'getViewerResult', viewerId);
    expect(resultAfterUndoParam?.width).toBe(widthBefore);

    await harness(page, 'undo');
    const stateAfterUndoConnect = await harness(page, 'getState');
    expect(stateAfterUndoConnect.connectionCount).toBe(1);

    await harness(page, 'undo');
    const stateAfterUndoConnectTwo = await harness(page, 'getState');
    expect(stateAfterUndoConnectTwo.connectionCount).toBe(0);

    await harness(page, 'undo');
    const stateAfterUndoViewer = await harness(page, 'getState');
    expect(stateAfterUndoViewer.nodeCount).toBe(2);

    await harness(page, 'undo');
    const stateAfterUndoResize = await harness(page, 'getState');
    expect(stateAfterUndoResize.nodeCount).toBe(1);

    await harness(page, 'undo');
    const stateAfterUndoSolid = await harness(page, 'getState');
    expect(stateAfterUndoSolid.nodeCount).toBe(0);

    await harness(page, 'redo');
    const stateAfterRedoSolid = await harness(page, 'getState');
    expect(stateAfterRedoSolid.nodeCount).toBe(1);

    await harness(page, 'redo');
    const stateAfterRedoResize = await harness(page, 'getState');
    expect(stateAfterRedoResize.nodeCount).toBe(2);

    await harness(page, 'redo');
    const stateAfterRedoViewer = await harness(page, 'getState');
    expect(stateAfterRedoViewer.nodeCount).toBe(3);

    await harness(page, 'redo');
    const stateAfterRedoConnect = await harness(page, 'getState');
    expect(stateAfterRedoConnect.connectionCount).toBe(1);

    await harness(page, 'redo');
    const stateAfterRedoConnectTwo = await harness(page, 'getState');
    expect(stateAfterRedoConnectTwo.connectionCount).toBe(2);

    await harness(page, 'redo');
    await harness(page, 'waitForRenderIdle');
    const resultAfterRedo = await harness(page, 'getViewerResult', viewerId);
    expect(resultAfterRedo?.width).toBe(640);
  });

  test('undo removes connections', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 400, y: 100 });
    await harness(page, 'connect', solidId, 'field', viewerId, 'value');

    const stateAfterConnect = await harness(page, 'getState');
    expect(stateAfterConnect.connectionCount).toBe(1);

    await harness(page, 'undo');
    const stateAfterUndo = await harness(page, 'getState');
    expect(stateAfterUndo.connectionCount).toBe(0);
  });

  test('multiple undos then redos restore exact graph state', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 400, y: 100 });
    await harness(page, 'connect', solidId, 'field', viewerId, 'value');

    const expected = normalizeGraph(extractGraph(await harness(page, 'exportGraph')));

    await harness(page, 'undo');
    await harness(page, 'undo');
    await harness(page, 'undo');

    await harness(page, 'redo');
    await harness(page, 'redo');
    await harness(page, 'redo');

    const finalGraph = normalizeGraph(extractGraph(await harness(page, 'exportGraph')));
    expect(finalGraph).toEqual(expected);
  });

  test('undo after setParam restores previous param and re-renders', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const resizeId = await harness(page, 'addNode', 'resize', { x: 300, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 600, y: 100 });
    await harness(page, 'connect', solidId, 'field', resizeId, 'image');
    await harness(page, 'connect', resizeId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'setParam', resizeId, 'width', { Int: 300 });
    await harness(page, 'waitForRenderIdle');
    const widthAfterSet = (await harness(page, 'getViewerResult', viewerId))?.width ?? null;
    expect(widthAfterSet).toBe(300);

    await harness(page, 'setParam', resizeId, 'width', { Int: 480 });
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'undo');
    await harness(page, 'waitForRenderIdle');
    const widthAfterUndo = (await harness(page, 'getViewerResult', viewerId))?.width ?? null;
    expect(widthAfterUndo).toBe(300);
    const viewerResult = await harness(page, 'getViewerResult', viewerId);
    expect(viewerResult).not.toBeNull();
  });

  test('newProject clears undo stack', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const stateAfterAdd = await harness(page, 'getState');
    expect(stateAfterAdd.canUndo).toBe(true);

    await harness(page, 'newProject');
    const stateAfterNew = await harness(page, 'getState');
    expect(stateAfterNew.canUndo).toBe(false);
    expect(stateAfterNew.nodeCount).toBe(0);
  });
});

test.describe('Node removal cascade', () => {
  test('removing middle node clears connections but keeps endpoints', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const sourceId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const middleId = await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 600, y: 100 });
    await harness(page, 'connect', sourceId, 'field', middleId, 'image');
    await harness(page, 'connect', middleId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'removeNode', middleId);
    const stateAfterRemove = await harness(page, 'getState');
    expect(stateAfterRemove.nodeCount).toBe(2);
    expect(stateAfterRemove.nodeIds).toContain(sourceId);
    expect(stateAfterRemove.nodeIds).toContain(viewerId);
    expect(stateAfterRemove.connectionCount).toBe(0);
  });

  test('removing one node in a fan-out only removes its connections', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const sourceId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const viewerA = await harness(page, 'addNode', 'viewer', { x: 400, y: 50 });
    const viewerB = await harness(page, 'addNode', 'viewer', { x: 400, y: 150 });
    await harness(page, 'connect', sourceId, 'field', viewerA, 'value');
    await harness(page, 'connect', sourceId, 'field', viewerB, 'value');

    const stateAfterConnect = await harness(page, 'getState');
    expect(stateAfterConnect.connectionCount).toBe(2);

    await harness(page, 'removeNode', viewerA);
    const stateAfterRemove = await harness(page, 'getState');
    expect(stateAfterRemove.nodeCount).toBe(2);
    expect(stateAfterRemove.nodeIds).toContain(sourceId);
    expect(stateAfterRemove.nodeIds).toContain(viewerB);
    expect(stateAfterRemove.connectionCount).toBe(1);
    expect(stateAfterRemove.connections).toEqual([
      {
        fromNode: sourceId,
        fromPort: 'field',
        toNode: viewerB,
        toPort: 'value',
      },
    ]);
  });

  test('removing a connected node triggers viewer update', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const sourceId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const middleId = await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 600, y: 100 });
    await harness(page, 'connect', sourceId, 'field', middleId, 'image');
    await harness(page, 'connect', middleId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const resultBefore = await harness(page, 'getViewerResult', viewerId);
    expect(resultBefore).not.toBeNull();
    expect(resultBefore?.hasPixels).toBe(true);

    await harness(page, 'removeNode', middleId);
    await harness(page, 'waitForRenderIdle');
    await harness(page, 'waitForRenderIdle');
    const resultAfter = await harness(page, 'getViewerResult', viewerId);
    expect(resultAfter === null || resultAfter.hasPixels === false).toBe(true);
  });
});

test.describe('Input default values', () => {
  test('setting an input default triggers a viewer render', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const viewerId = await harness(page, 'addNode', 'viewer', { x: 200, y: 100 });
    await harness(page, 'setInputDefault', viewerId, 'value', { Float: 0.25 });
    await harness(page, 'waitForRenderIdle');

    const result = await harness(page, 'getViewerResult', viewerId);
    expect(result).not.toBeNull();
    expect(result?.hasPixels).toBe(false);
    expect(result?.type).toBe('float');
  });

  test('connected input overrides input default', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const sourceId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 400, y: 100 });

    await harness(page, 'setInputDefault', viewerId, 'value', { Float: 0.5 });
    await harness(page, 'waitForRenderIdle');
    const resultDefault = await harness(page, 'getViewerResult', viewerId);
    expect(resultDefault).not.toBeNull();
    expect(resultDefault?.hasPixels).toBe(false);
    expect(resultDefault?.type).toBe('float');

    await harness(page, 'connect', sourceId, 'field', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');
    const resultConnected = await harness(page, 'getViewerResult', viewerId);
    expect(resultConnected).not.toBeNull();
    expect(resultConnected?.hasPixels).toBe(true);
  });
});
