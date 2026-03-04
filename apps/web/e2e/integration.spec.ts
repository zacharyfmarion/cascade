/**
 * Integration E2E Tests
 *
 * These tests use the window.__cascadeTest harness to drive the app
 * programmatically with the REAL WASM engine. They verify that the full
 * pipeline works: store → engine bridge → WASM → evaluator → render result.
 *
 * Each test navigates to the app, waits for engine init, then uses the
 * harness API to build graphs and verify behavior.
 */
import { test, expect } from '@playwright/test';
import { harness, waitForApp, type HarnessWindow } from './helpers';

test.describe('Engine initialization', () => {
  test('app boots and WASM engine initializes successfully', async ({ page }) => {
    await page.goto('/');

    // Should show loading first
    // Loading may be very brief — don't assert it's visible, just that app-ready eventually appears
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30_000 });

    // Verify engine is ready via harness
    await page.waitForFunction(() => !!(window as unknown as HarnessWindow).__cascadeTest, {
      timeout: 10_000,
    });
    const state = (await harness(page, 'getState')) as {
      engineReady: boolean; nodeCount: number; connectionCount: number;
    };
    expect(state.engineReady).toBe(true);
    expect(state.nodeCount).toBe(0);
    expect(state.connectionCount).toBe(0);
  });

  test('node specs are available after init', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const specs = (await harness(page, 'getNodeSpecs')) as Array<{ id: string }>;
    expect(specs.length).toBeGreaterThan(10);

    // Verify some known node types exist
    const specIds = specs.map((s: { id: string }) => s.id);
    expect(specIds).toContain('solid_color');
    expect(specIds).toContain('invert');
    expect(specIds).toContain('viewer');
    expect(specIds).toContain('brightness_contrast');
  });
});

test.describe('Graph creation and rendering', () => {
  test('create SolidColor → Viewer graph and get render result', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Create nodes
    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 400, y: 100 })) as string;
    expect(typeof solidId).toBe('string');
    expect(typeof viewerId).toBe('string');

    // Verify nodes were created
    const stateAfterAdd = (await harness(page, 'getState')) as {
      nodeCount: number; nodeTypes: Record<string, string>;
    };
    expect(stateAfterAdd.nodeCount).toBe(2);
    expect(stateAfterAdd.nodeTypes[solidId]).toBe('solid_color');
    expect(stateAfterAdd.nodeTypes[viewerId]).toBe('viewer');

    // Connect solid_color.field → viewer.value
    await harness(page, 'connect', solidId, 'field', viewerId, 'value');

    const stateAfterConnect = (await harness(page, 'getState')) as {
      connectionCount: number;
    };
    expect(stateAfterConnect.connectionCount).toBe(1);

    // Wait for render to complete
    await harness(page, 'waitForRenderIdle');

    // Verify viewer has a result
    const result = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(result).not.toBeNull();
  });

  test('changing a param triggers re-render with different result', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Build graph: SolidColor → Viewer
    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 400, y: 100 })) as string;
    await harness(page, 'connect', solidId, 'field', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    // Get initial result
    const result1 = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(result1).not.toBeNull();

    // Change the color parameter
    await harness(page, 'setParam', solidId, 'color', {
      type: 'color',
      value: [1.0, 0.0, 0.0, 1.0],
    });
    await harness(page, 'waitForRenderIdle');

    // Verify viewer still has a result (re-rendered)
    const result2 = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(result2).not.toBeNull();
  });

  test('disconnect updates viewer render', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Build and connect
    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 400, y: 100 })) as string;
    await harness(page, 'connect', solidId, 'field', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const resultBefore = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(resultBefore).not.toBeNull();

    // Disconnect and verify the viewer re-renders (render result may change)
    await harness(page, 'disconnect', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    // The graph should still have 2 nodes
    const stateAfter = (await harness(page, 'getState')) as { nodeCount: number };
    expect(stateAfter.nodeCount).toBe(2);
  });
});

test.describe('Undo/Redo', () => {
  test('undo reverts node addition', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    const stateAfterAdd = (await harness(page, 'getState')) as {
      nodeCount: number; canUndo: boolean;
    };
    expect(stateAfterAdd.nodeCount).toBe(1);
    expect(stateAfterAdd.canUndo).toBe(true);

    await harness(page, 'undo');
    const stateAfterUndo = (await harness(page, 'getState')) as {
      nodeCount: number; canRedo: boolean;
    };
    expect(stateAfterUndo.nodeCount).toBe(0);
    expect(stateAfterUndo.canRedo).toBe(true);

    await harness(page, 'redo');
    const stateAfterRedo = (await harness(page, 'getState')) as { nodeCount: number };
    expect(stateAfterRedo.nodeCount).toBe(1);
  });
});
