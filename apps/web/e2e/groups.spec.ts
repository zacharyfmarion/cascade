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

test.describe('Group operations', () => {
  test('createGroup bundles selected nodes', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const brightId = await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 500, y: 100 });

    await harness(page, 'connect', solidId, 'field', brightId, 'image');
    await harness(page, 'connect', brightId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'createGroup', [solidId, brightId], 'MyGroup');
    await harness(page, 'waitForRenderIdle');

    const stateAfterGroup = await harness(page, 'getState');
    expect(stateAfterGroup.nodeCount).toBe(2);
    expect(stateAfterGroup.connectionCount).toBeGreaterThan(0);
    expect(stateAfterGroup.canUndo).toBe(true);
  });

  test('enterGroup shows internal graph', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const brightId = await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 500, y: 100 });

    await harness(page, 'connect', solidId, 'field', brightId, 'image');
    await harness(page, 'connect', brightId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'createGroup', [solidId, brightId], 'MyGroup');
    await harness(page, 'waitForRenderIdle');

    const stateAfterGroup = await harness(page, 'getState');
    const groupNodeId = stateAfterGroup.nodeIds.find(
      (id: string) => String(stateAfterGroup.nodeTypes[id]).includes('group'),
    );
    expect(groupNodeId).toBeTruthy();

    await harness(page, 'enterGroup', groupNodeId);
    await harness(page, 'waitForRenderIdle');

    const editingStack = await harness(page, 'getEditingStack');
    expect(editingStack.length).toBe(2);

    const stateInsideGroup = await harness(page, 'getState');
    // Group contains original nodes plus IO proxy nodes (group_input, group_output)
    expect(stateInsideGroup.nodeCount).toBeGreaterThanOrEqual(2);
    const insideTypes = Object.values(stateInsideGroup.nodeTypes);
    expect(insideTypes).toContain('solid_color');
    expect(insideTypes).toContain('brightness_contrast');
  });

  test('exitGroup returns to outer graph', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const brightId = await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 500, y: 100 });

    await harness(page, 'connect', solidId, 'field', brightId, 'image');
    await harness(page, 'connect', brightId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'createGroup', [solidId, brightId], 'MyGroup');
    await harness(page, 'waitForRenderIdle');

    const stateAfterGroup = await harness(page, 'getState');
    const groupNodeId = stateAfterGroup.nodeIds.find(
      (id: string) => String(stateAfterGroup.nodeTypes[id]).includes('group'),
    );
    expect(groupNodeId).toBeTruthy();

    await harness(page, 'enterGroup', groupNodeId);
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'exitGroup');
    await harness(page, 'waitForRenderIdle');

    const editingStack = await harness(page, 'getEditingStack');
    expect(editingStack.length).toBe(1);

    const stateAfterExit = await harness(page, 'getState');
    expect(stateAfterExit.nodeCount).toBe(2);
    const outerTypes = Object.values(stateAfterExit.nodeTypes);
    expect(outerTypes).toContain('viewer');
  });

  test('undo after createGroup restores original nodes', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const brightId = await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 500, y: 100 });

    await harness(page, 'connect', solidId, 'field', brightId, 'image');
    await harness(page, 'connect', brightId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'createGroup', [solidId, brightId], 'MyGroup');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'undo');
    await harness(page, 'waitForRenderIdle');

    const stateAfterUndo = await harness(page, 'getState');
    expect(stateAfterUndo.nodeCount).toBe(3);
    const nodeTypes = Object.values(stateAfterUndo.nodeTypes);
    expect(nodeTypes).toContain('solid_color');
    expect(nodeTypes).toContain('brightness_contrast');
    expect(nodeTypes).toContain('viewer');
  });

  test('creating group preserves viewer rendering', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const brightId = await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 100 });
    const viewerId = await harness(page, 'addNode', 'viewer', { x: 500, y: 100 });

    await harness(page, 'connect', solidId, 'field', brightId, 'image');
    await harness(page, 'connect', brightId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const resultBefore = await harness(page, 'getViewerResult', viewerId);
    expect(resultBefore).not.toBeNull();
    expect(resultBefore.hasPixels).toBe(true);

    await harness(page, 'createGroup', [solidId, brightId]);
    await harness(page, 'waitForRenderIdle');

    const resultAfter = await harness(page, 'getViewerResult', viewerId);
    expect(resultAfter).not.toBeNull();
    expect(resultAfter.hasPixels).toBe(true);
  });
});
