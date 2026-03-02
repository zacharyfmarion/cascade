import { test, expect } from '@playwright/test';

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

test.describe('Multi-node graph rendering', () => {
  test('renders SolidColor → BrightnessContrast → Viewer chain', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const bcId = await harness(page, 'addNode', 'brightness_contrast', { x: 320, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 540, y: 100 });

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const result = await harness(page, 'getViewerResult', viewerId);
    expect(result).not.toBeNull();
    expect(result?.hasPixels).toBe(true);
  });

  test('renders SolidColor → BrightnessContrast → Invert → Viewer chain', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 140 });
    const bcId = await harness(page, 'addNode', 'brightness_contrast', { x: 320, y: 140 });
    const invertId = await harness(page, 'addNode', 'invert', { x: 540, y: 140 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 760, y: 140 });

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', invertId, 'image');
    await harness(page, 'connect', invertId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const result = await harness(page, 'getViewerResult', viewerId);
    expect(result).not.toBeNull();
    expect(result?.hasPixels).toBe(true);
  });

  test('renders diamond topology with shared source', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 80, y: 200 });
    const bcId = await harness(page, 'addNode', 'brightness_contrast', { x: 280, y: 120 });
    const invertId = await harness(page, 'addNode', 'invert', { x: 280, y: 280 });
    const viewerA = await harness(page, 'addNode', 'viewer', { x: 520, y: 120 });
    const viewerB = await harness(page, 'addNode', 'viewer', { x: 520, y: 280 });

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', solidId, 'field', invertId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerA, 'value');
    await harness(page, 'connect', invertId, 'image', viewerB, 'value');
    await harness(page, 'waitForRenderIdle');

    const resultA = await harness(page, 'getViewerResult', viewerA);
    const resultB = await harness(page, 'getViewerResult', viewerB);
    expect(resultA).not.toBeNull();
    expect(resultB).not.toBeNull();

    const state = await harness(page, 'getState');
    expect(state.connectionCount).toBe(4);
  });

  test('upstream param changes propagate to downstream viewer', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 240 });
    const bcId = await harness(page, 'addNode', 'brightness_contrast', { x: 320, y: 240 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 540, y: 240 });

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const before = await harness(page, 'getViewerResult', viewerId);
    expect(before).not.toBeNull();

    await harness(page, 'setParam', bcId, 'brightness', { type: 'float', value: 0.25 });
    await harness(page, 'waitForRenderIdle');

    const after = await harness(page, 'getViewerResult', viewerId);
    expect(after).not.toBeNull();
  });
});

test.describe('Selective viewer invalidation', () => {
  test('changing branch 1 params keeps branch 2 connected and rendered', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidA = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const viewerA = await harness(page, 'addNode', 'viewer', { x: 340, y: 100 });
    const solidB = await harness(page, 'addNode', 'solid_color', { x: 100, y: 260 });
    const viewerB = await harness(page, 'addNode', 'viewer', { x: 340, y: 260 });

    await harness(page, 'connect', solidA, 'field', viewerA, 'value');
    await harness(page, 'connect', solidB, 'field', viewerB, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'setParam', solidA, 'color', { type: 'color', value: [0, 1, 0, 1] });
    await harness(page, 'waitForRenderIdle');

    const resultA = await harness(page, 'getViewerResult', viewerA);
    const resultB = await harness(page, 'getViewerResult', viewerB);
    expect(resultA).not.toBeNull();
    expect(resultB).not.toBeNull();

    const state = await harness(page, 'getState');
    expect(state.connectionCount).toBe(2);
  });

  test('disconnecting one branch leaves the other branch intact', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidA = await harness(page, 'addNode', 'solid_color', { x: 100, y: 120 });
    const viewerA = await harness(page, 'addNode', 'viewer', { x: 340, y: 120 });
    const solidB = await harness(page, 'addNode', 'solid_color', { x: 100, y: 300 });
    const viewerB = await harness(page, 'addNode', 'viewer', { x: 340, y: 300 });

    await harness(page, 'connect', solidA, 'field', viewerA, 'value');
    await harness(page, 'connect', solidB, 'field', viewerB, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'disconnect', viewerA, 'value');
    await harness(page, 'waitForRenderIdle');

    const state = await harness(page, 'getState');
    expect(state.connectionCount).toBe(1);
    expect(state.connections[0]).toMatchObject({ toNode: viewerB, toPort: 'value' });

    const resultB = await harness(page, 'getViewerResult', viewerB);
    expect(resultB).not.toBeNull();
  });

  test('reconnecting a branch restores viewer rendering', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidA = await harness(page, 'addNode', 'solid_color', { x: 100, y: 140 });
    const viewerA = await harness(page, 'addNode', 'viewer', { x: 340, y: 140 });
    const solidB = await harness(page, 'addNode', 'solid_color', { x: 100, y: 340 });
    const viewerB = await harness(page, 'addNode', 'viewer', { x: 340, y: 340 });

    await harness(page, 'connect', solidA, 'field', viewerA, 'value');
    await harness(page, 'connect', solidB, 'field', viewerB, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'disconnect', viewerA, 'value');
    await harness(page, 'waitForRenderIdle');
    await harness(page, 'connect', solidA, 'field', viewerA, 'value');
    await harness(page, 'waitForRenderIdle');

    const state = await harness(page, 'getState');
    expect(state.connectionCount).toBe(2);

    const resultA = await harness(page, 'getViewerResult', viewerA);
    expect(resultA).not.toBeNull();
  });

  test('frame changes update all viewers', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidA = await harness(page, 'addNode', 'solid_color', { x: 120, y: 160 });
    const viewerA = await harness(page, 'addNode', 'viewer', { x: 360, y: 160 });
    const solidB = await harness(page, 'addNode', 'solid_color', { x: 120, y: 360 });
    const viewerB = await harness(page, 'addNode', 'viewer', { x: 360, y: 360 });

    await harness(page, 'connect', solidA, 'field', viewerA, 'value');
    await harness(page, 'connect', solidB, 'field', viewerB, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'setCurrentFrame', 12);
    await harness(page, 'waitForRenderIdle');

    const state = await harness(page, 'getState');
    expect(state.currentFrame).toBe(12);

    const resultA = await harness(page, 'getViewerResult', viewerA);
    const resultB = await harness(page, 'getViewerResult', viewerB);
    expect(resultA).not.toBeNull();
    expect(resultB).not.toBeNull();
  });
});

test.describe('Render suspension via editTransaction', () => {
  test('batches multiple param updates before rendering', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 120, y: 220 });
    const bcId = await harness(page, 'addNode', 'brightness_contrast', { x: 340, y: 220 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 560, y: 220 });

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'editTransaction', [
      { action: 'setParam', args: [bcId, 'brightness', { type: 'float', value: 0.4 }] },
      { action: 'setParam', args: [bcId, 'contrast', { type: 'float', value: -0.2 }] },
    ]);

    const stateAfter = await harness(page, 'getState');
    expect(stateAfter.dirty).toBe(true);

    await harness(page, 'waitForRenderIdle');
    const result = await harness(page, 'getViewerResult', viewerId);
    expect(result).not.toBeNull();
  });

  test('editTransaction keeps graph state consistent', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 120, y: 260 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 360, y: 260 });

    await harness(page, 'connect', solidId, 'field', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'editTransaction', [
      { action: 'setSelectedNodes', args: [[solidId, viewerId]] },
      { action: 'setParam', args: [solidId, 'scale_x', { type: 'float', value: 1.5 }] },
      { action: 'setParam', args: [solidId, 'scale_y', { type: 'float', value: 0.75 }] },
    ]);

    const state = await harness(page, 'getState');
    expect(state.connectionCount).toBe(1);
    expect(state.selectedNodeIds).toEqual([solidId, viewerId]);
    expect(state.dirty).toBe(true);
  });
});
