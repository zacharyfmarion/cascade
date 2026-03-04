import { test, expect } from '@playwright/test';
import { waitForApp, harness } from './helpers';

/**
 * E2E tests for time manipulation nodes: TimeOffset, FrameHold, FrameBlend.
 *
 * These verify that the nodes exist, can be connected, render correctly,
 * and respond to parameter changes. Since we use a SolidColor source
 * (frame-independent), the time offset produces the same output regardless
 * of frame — but the tests validate the full pipeline works without errors.
 */
test.describe('Time Nodes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
  });

  test('time_offset node exists and can be added to graph', async ({ page }) => {
    const nodeId = (await harness(page, 'addNode', 'time_offset')) as string;
    expect(nodeId).toBeTruthy();

    const state = (await harness(page, 'getState')) as { nodeCount: number };
    expect(state.nodeCount).toBeGreaterThanOrEqual(1);
  });

  test('frame_hold node exists and can be added to graph', async ({ page }) => {
    const nodeId = (await harness(page, 'addNode', 'frame_hold')) as string;
    expect(nodeId).toBeTruthy();
  });

  test('frame_blend node exists and can be added to graph', async ({ page }) => {
    const nodeId = (await harness(page, 'addNode', 'frame_blend')) as string;
    expect(nodeId).toBeTruthy();
  });

  test('solid_color → time_offset → viewer produces valid output', async ({ page }) => {
    const solid = (await harness(page, 'addNode', 'solid_color')) as string;
    const offset = (await harness(page, 'addNode', 'time_offset')) as string;
    const viewer = (await harness(page, 'addNode', 'viewer')) as string;

    await harness(page, 'connect', solid, 'field', offset, 'input');
    await harness(page, 'connect', offset, 'output', viewer, 'value');
    await harness(page, 'waitForRenderIdle');

    const result = (await harness(page, 'getViewerResult', viewer)) as {
      hasPixels: boolean;
      width: number;
      height: number;
    } | null;

    expect(result).not.toBeNull();
    expect(result?.hasPixels).toBe(true);
    expect(result?.width).toBeGreaterThan(0);
    expect(result?.height).toBeGreaterThan(0);
  });

  test('solid_color → frame_hold → viewer produces valid output', async ({ page }) => {
    const solid = (await harness(page, 'addNode', 'solid_color')) as string;
    const hold = (await harness(page, 'addNode', 'frame_hold')) as string;
    const viewer = (await harness(page, 'addNode', 'viewer')) as string;

    await harness(page, 'connect', solid, 'field', hold, 'input');
    await harness(page, 'connect', hold, 'output', viewer, 'value');
    await harness(page, 'waitForRenderIdle');

    const result = (await harness(page, 'getViewerResult', viewer)) as {
      hasPixels: boolean;
    } | null;

    expect(result).not.toBeNull();
    expect(result?.hasPixels).toBe(true);
  });

  test('solid_color → frame_blend → viewer produces valid output', async ({ page }) => {
    const solid = (await harness(page, 'addNode', 'solid_color')) as string;
    const blend = (await harness(page, 'addNode', 'frame_blend')) as string;
    const viewer = (await harness(page, 'addNode', 'viewer')) as string;

    await harness(page, 'connect', solid, 'field', blend, 'input');
    await harness(page, 'connect', blend, 'output', viewer, 'value');
    await harness(page, 'waitForRenderIdle');

    const result = (await harness(page, 'getViewerResult', viewer)) as {
      hasPixels: boolean;
    } | null;

    expect(result).not.toBeNull();
    expect(result?.hasPixels).toBe(true);
  });

  test('time_offset param change triggers re-render without errors', async ({ page }) => {
    const solid = (await harness(page, 'addNode', 'solid_color')) as string;
    const offset = (await harness(page, 'addNode', 'time_offset')) as string;
    const viewer = (await harness(page, 'addNode', 'viewer')) as string;

    await harness(page, 'connect', solid, 'field', offset, 'input');
    await harness(page, 'connect', offset, 'output', viewer, 'value');
    await harness(page, 'waitForRenderIdle');

    // Change offset param
    await harness(page, 'setParam', offset, 'offset', { Integer: 5 });
    await harness(page, 'waitForRenderIdle');

    const result = (await harness(page, 'getViewerResult', viewer)) as {
      hasPixels: boolean;
    } | null;
    expect(result?.hasPixels).toBe(true);

    // Change to negative offset
    await harness(page, 'setParam', offset, 'offset', { Integer: -3 });
    await harness(page, 'waitForRenderIdle');

    const result2 = (await harness(page, 'getViewerResult', viewer)) as {
      hasPixels: boolean;
    } | null;
    expect(result2?.hasPixels).toBe(true);

    // No errors should have occurred
    const errors = (await harness(page, 'getNodeErrors')) as Record<string, unknown>;
    expect(Object.keys(errors).length).toBe(0);
  });

  test('frame_hold param change works without errors', async ({ page }) => {
    const solid = (await harness(page, 'addNode', 'solid_color')) as string;
    const hold = (await harness(page, 'addNode', 'frame_hold')) as string;
    const viewer = (await harness(page, 'addNode', 'viewer')) as string;

    await harness(page, 'connect', solid, 'field', hold, 'input');
    await harness(page, 'connect', hold, 'output', viewer, 'value');
    await harness(page, 'waitForRenderIdle');

    // Change held frame
    await harness(page, 'setParam', hold, 'frame', { Integer: 10 });
    await harness(page, 'waitForRenderIdle');

    const result = (await harness(page, 'getViewerResult', viewer)) as {
      hasPixels: boolean;
    } | null;
    expect(result?.hasPixels).toBe(true);

    const errors = (await harness(page, 'getNodeErrors')) as Record<string, unknown>;
    expect(Object.keys(errors).length).toBe(0);
  });

  test('frame_blend param change works without errors', async ({ page }) => {
    const solid = (await harness(page, 'addNode', 'solid_color')) as string;
    const blend = (await harness(page, 'addNode', 'frame_blend')) as string;
    const viewer = (await harness(page, 'addNode', 'viewer')) as string;

    await harness(page, 'connect', solid, 'field', blend, 'input');
    await harness(page, 'connect', blend, 'output', viewer, 'value');
    await harness(page, 'waitForRenderIdle');

    // Change blend factor
    await harness(page, 'setParam', blend, 'blend', { Float: 0.75 });
    await harness(page, 'waitForRenderIdle');

    const result = (await harness(page, 'getViewerResult', viewer)) as {
      hasPixels: boolean;
    } | null;
    expect(result?.hasPixels).toBe(true);

    const errors = (await harness(page, 'getNodeErrors')) as Record<string, unknown>;
    expect(Object.keys(errors).length).toBe(0);
  });

  test('time_offset in multi-node chain works correctly', async ({ page }) => {
    // solid_color → brightness_contrast → time_offset → viewer
    const solid = (await harness(page, 'addNode', 'solid_color')) as string;
    const bc = (await harness(page, 'addNode', 'brightness_contrast')) as string;
    const offset = (await harness(page, 'addNode', 'time_offset')) as string;
    const viewer = (await harness(page, 'addNode', 'viewer')) as string;

    await harness(page, 'connect', solid, 'field', bc, 'image');
    await harness(page, 'connect', bc, 'image', offset, 'input');
    await harness(page, 'connect', offset, 'output', viewer, 'value');
    await harness(page, 'waitForRenderIdle');

    const result = (await harness(page, 'getViewerResult', viewer)) as {
      hasPixels: boolean;
      width: number;
      height: number;
    } | null;

    expect(result).not.toBeNull();
    expect(result?.hasPixels).toBe(true);
    expect(result?.width).toBeGreaterThan(0);

    const errors = (await harness(page, 'getNodeErrors')) as Record<string, unknown>;
    expect(Object.keys(errors).length).toBe(0);
  });

  test('time_offset with frame change evaluates without errors', async ({ page }) => {
    const solid = (await harness(page, 'addNode', 'solid_color')) as string;
    const offset = (await harness(page, 'addNode', 'time_offset')) as string;
    const viewer = (await harness(page, 'addNode', 'viewer')) as string;

    await harness(page, 'connect', solid, 'field', offset, 'input');
    await harness(page, 'connect', offset, 'output', viewer, 'value');
    await harness(page, 'setParam', offset, 'offset', { Integer: -2 });
    await harness(page, 'waitForRenderIdle');

    // Change current frame
    await harness(page, 'setCurrentFrame', 10);
    await harness(page, 'waitForRenderIdle');

    const result = (await harness(page, 'getViewerResult', viewer)) as {
      hasPixels: boolean;
    } | null;
    expect(result?.hasPixels).toBe(true);

    // Change to another frame
    await harness(page, 'setCurrentFrame', 0);
    await harness(page, 'waitForRenderIdle');

    const result2 = (await harness(page, 'getViewerResult', viewer)) as {
      hasPixels: boolean;
    } | null;
    expect(result2?.hasPixels).toBe(true);

    const errors = (await harness(page, 'getNodeErrors')) as Record<string, unknown>;
    expect(Object.keys(errors).length).toBe(0);
  });
});
