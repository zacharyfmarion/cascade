import { test, expect } from '@playwright/test';

// Helper: wait for the test harness to be available and engine ready
async function waitForApp(page: import('@playwright/test').Page) {
  // Wait for app-ready (engine loaded, UI rendered)
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30_000 });

  // Wait for test harness to be installed
  await page.waitForFunction(() => !!(window as any).__compositorTest, {
    timeout: 10_000,
  });

  // Wait for engine to be fully ready
  await page.evaluate(() => (window as any).__compositorTest.waitForEngine());
}

// Helper: call a harness method and return result
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

test.describe('Save/Load project', () => {
  test('saveProject returns graph data and loadProject restores it', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const bcId = await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 500, y: 100 });

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'setParam', bcId, 'brightness', { Float: 0.7 });
    await harness(page, 'waitForRenderIdle');

    const saved = await harness(page, 'saveProject');
    const stateBefore = await harness(page, 'getState');

    await harness(page, 'newProject');
    const stateAfterNew = await harness(page, 'getState');
    expect(stateAfterNew.nodeCount).toBe(0);

    await harness(page, 'loadProject', saved);
    await harness(page, 'waitForRenderIdle');
    const stateAfterLoad = await harness(page, 'getState');

    expect(stateAfterLoad.nodeCount).toBe(stateBefore.nodeCount);
    expect(stateAfterLoad.connectionCount).toBe(stateBefore.connectionCount);
  });

  test('loadProject preserves connections and renders correctly', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 120 });
    const bcId = await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 120 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 500, y: 120 });

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'setParam', bcId, 'brightness', { Float: 0.25 });
    await harness(page, 'waitForRenderIdle');

    const saved = await harness(page, 'saveProject');
    await harness(page, 'newProject');
    await harness(page, 'loadProject', saved);
    await harness(page, 'waitForRenderIdle');

    const stateAfterLoad = await harness(page, 'getState');
    const viewerIds = stateAfterLoad.nodeIds.filter(
      (id: string) => stateAfterLoad.nodeTypes[id] === 'viewer',
    );

    let hasPixels = false;
    for (const id of viewerIds) {
      const result = await harness(page, 'getViewerResult', id);
      if (result?.hasPixels) {
        hasPixels = true;
        break;
      }
    }

    expect(hasPixels).toBe(true);
  });

  test('loadProject preserves params', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 120, y: 140 });
    const bcId = await harness(page, 'addNode', 'brightness_contrast', { x: 320, y: 140 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 520, y: 140 });

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'setParam', bcId, 'brightness', { Float: 0.42 });
    await harness(page, 'waitForRenderIdle');

    const saved = await harness(page, 'saveProject');
    await harness(page, 'newProject');
    await harness(page, 'loadProject', saved);
    await harness(page, 'waitForRenderIdle');

    const result = await harness(page, 'getViewerResult', viewerId);
    expect(result?.hasPixels).toBe(true);
  });

  test('newProject then loadProject resets dirty flag correctly', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 140, y: 160 });
    const bcId = await harness(page, 'addNode', 'brightness_contrast', { x: 340, y: 160 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 540, y: 160 });

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'setParam', bcId, 'brightness', { Float: 0.55 });
    await harness(page, 'waitForRenderIdle');

    const saved = await harness(page, 'saveProject');

    await harness(page, 'newProject');
    const stateAfterNew = await harness(page, 'getState');
    expect(stateAfterNew.dirty).toBe(false);

    await harness(page, 'loadProject', saved);
    const stateAfterLoad = await harness(page, 'getState');
    expect(stateAfterLoad.dirty).toBe(false);
  });

  test('save/load roundtrip preserves selection state', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 160, y: 180 });
    const bcId = await harness(page, 'addNode', 'brightness_contrast', { x: 360, y: 180 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 560, y: 180 });

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'selectNode', bcId);
    await harness(page, 'waitForRenderIdle');

    const saved = await harness(page, 'saveProject');
    const stateBefore = await harness(page, 'getState');

    await harness(page, 'newProject');
    await harness(page, 'loadProject', saved);
    await harness(page, 'waitForRenderIdle');

    const stateAfterLoad = await harness(page, 'getState');
    expect(stateAfterLoad.nodeCount).toBe(stateBefore.nodeCount);
    expect(stateAfterLoad.connectionCount).toBe(stateBefore.connectionCount);
  });
});
