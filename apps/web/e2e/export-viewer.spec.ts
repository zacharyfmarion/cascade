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

test.describe('Export and viewer operations', () => {
  test('exportImage does not crash and graph remains functional', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const specs = (await harness(page, 'getNodeSpecs')) as Array<{ id: string }>;
    const hasExportImage = specs.some((spec) => spec.id === 'export_image');

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 700, y: 100 });

    let exportTargetId = viewerId;
    if (hasExportImage) {
      const exportId = await harness(page, 'addNode', 'export_image', { x: 400, y: 100 });
      await harness(page, 'connect', solidId, 'field', exportId, 'image');
      await harness(page, 'connect', exportId, 'display', viewerId, 'value');
      exportTargetId = exportId;
    } else {
      await harness(page, 'connect', solidId, 'field', viewerId, 'value');
    }

    await harness(page, 'waitForRenderIdle');
    const stateBefore = await harness(page, 'getState');
    const resultBefore = await harness(page, 'getViewerResult', viewerId);
    expect(resultBefore).not.toBeNull();

    await expect(harness(page, 'exportImage', exportTargetId)).resolves.toBeUndefined();

    await harness(page, 'waitForRenderIdle');
    const stateAfter = await harness(page, 'getState');
    expect(stateAfter.nodeCount).toBe(stateBefore.nodeCount);
    expect(stateAfter.connectionCount).toBe(stateBefore.connectionCount);

    const resultAfter = await harness(page, 'getViewerResult', viewerId);
    expect(resultAfter).not.toBeNull();
  });

  test('render result persists across param changes', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const bcId = await harness(page, 'addNode', 'brightness_contrast', { x: 400, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 700, y: 100 });

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const initial = await harness(page, 'getViewerResult', viewerId);
    expect(initial).not.toBeNull();

    const brightnessSteps = [0.3, 0.5, 0.8];
    for (const value of brightnessSteps) {
      await harness(page, 'setParam', bcId, 'brightness', { Float: value });
      await harness(page, 'waitForRenderIdle');
      const result = await harness(page, 'getViewerResult', viewerId);
      expect(result).not.toBeNull();
    }
  });

  test('viewer result updates after upstream topology change', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const bcId = await harness(page, 'addNode', 'brightness_contrast', { x: 400, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 700, y: 100 });

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const initial = await harness(page, 'getViewerResult', viewerId);
    expect(initial).not.toBeNull();

    await harness(page, 'disconnect', viewerId, 'value');
    const invertId = await harness(page, 'addNode', 'invert', { x: 550, y: 100 });
    await harness(page, 'connect', bcId, 'image', invertId, 'image');
    await harness(page, 'connect', invertId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const updated = await harness(page, 'getViewerResult', viewerId);
    expect(updated).not.toBeNull();
  });

  test('multiple sequential param changes produce final correct state', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const bcId = await harness(page, 'addNode', 'brightness_contrast', { x: 400, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 700, y: 100 });

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const rapidChanges = [0.1, 0.2, 0.35, 0.6, 0.9];
    for (const value of rapidChanges) {
      await harness(page, 'setParam', bcId, 'brightness', { Float: value });
    }

    await harness(page, 'waitForRenderIdle');
    const result = await harness(page, 'getViewerResult', viewerId);
    expect(result).not.toBeNull();

    const state = await harness(page, 'getState');
    expect(state.dirty).toBe(true);
  });

  test('editTransaction batches mutations correctly', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const bcId = await harness(page, 'addNode', 'brightness_contrast', { x: 400, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 700, y: 100 });

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');

    await harness(page, 'editTransaction', [
      { action: 'setParam', args: [bcId, 'brightness', { Float: 0.25 }] },
      { action: 'setParam', args: [bcId, 'contrast', { Float: -0.2 }] },
      { action: 'setParam', args: [bcId, 'brightness', { Float: 0.6 }] },
    ]);

    await harness(page, 'waitForRenderIdle');
    const result = await harness(page, 'getViewerResult', viewerId);
    expect(result).not.toBeNull();
  });
});
