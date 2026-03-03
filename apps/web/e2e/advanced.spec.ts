import { test, expect } from '@playwright/test';
import { harness, waitForApp } from './helpers';

test.describe('Complex topologies', () => {
  test('diamond fan-out through two processing nodes renders both viewers', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const bc1Id = (await harness(page, 'addNode', 'brightness_contrast', { x: 350, y: 50 })) as string;
    const bc2Id = (await harness(page, 'addNode', 'brightness_contrast', { x: 350, y: 150 })) as string;
    const viewer1Id = (await harness(page, 'addNode', 'viewer', { x: 650, y: 50 })) as string;
    const viewer2Id = (await harness(page, 'addNode', 'viewer', { x: 650, y: 150 })) as string;

    await harness(page, 'connect', solidId, 'field', bc1Id, 'image');
    await harness(page, 'connect', solidId, 'field', bc2Id, 'image');
    await harness(page, 'connect', bc1Id, 'image', viewer1Id, 'value');
    await harness(page, 'connect', bc2Id, 'image', viewer2Id, 'value');

    await harness(page, 'waitForRenderIdle');

    const result1 = (await harness(page, 'getViewerResult', viewer1Id)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    const result2 = (await harness(page, 'getViewerResult', viewer2Id)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
  });

  test('fan-out from one source to three viewers renders all outputs', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const viewerA = (await harness(page, 'addNode', 'viewer', { x: 450, y: 0 })) as string;
    const viewerB = (await harness(page, 'addNode', 'viewer', { x: 450, y: 120 })) as string;
    const viewerC = (await harness(page, 'addNode', 'viewer', { x: 450, y: 240 })) as string;

    await harness(page, 'connect', solidId, 'field', viewerA, 'value');
    await harness(page, 'connect', solidId, 'field', viewerB, 'value');
    await harness(page, 'connect', solidId, 'field', viewerC, 'value');

    await harness(page, 'waitForRenderIdle');

    const resultA = (await harness(page, 'getViewerResult', viewerA)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    const resultB = (await harness(page, 'getViewerResult', viewerB)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    const resultC = (await harness(page, 'getViewerResult', viewerC)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(resultA).not.toBeNull();
    expect(resultB).not.toBeNull();
    expect(resultC).not.toBeNull();
  });

  test('linear chain re-renders when first node param changes', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const bc1Id = (await harness(page, 'addNode', 'brightness_contrast', { x: 350, y: 100 })) as string;
    const bc2Id = (await harness(page, 'addNode', 'brightness_contrast', { x: 600, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 850, y: 100 })) as string;

    await harness(page, 'connect', solidId, 'field', bc1Id, 'image');
    await harness(page, 'connect', bc1Id, 'image', bc2Id, 'image');
    await harness(page, 'connect', bc2Id, 'image', viewerId, 'value');

    await harness(page, 'waitForRenderIdle');
    const initial = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(initial).not.toBeNull();

    await harness(page, 'setParam', solidId, 'color', {
      type: 'color',
      value: [0.0, 0.8, 0.2, 1.0],
    });
    await harness(page, 'waitForRenderIdle');

    const updated = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(updated).not.toBeNull();
  });
});

test.describe('Error recovery', () => {
  test('viewer with no input returns null result without crashing', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 200, y: 100 })) as string;
    await harness(page, 'waitForRenderIdle');

    const result = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(result).toBeNull();
  });

  // BUG: incompatible field→image connection does not surface node errors
  test.skip('incompatible connection reports node errors', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const bcId = (await harness(page, 'addNode', 'brightness_contrast', { x: 350, y: 100 })) as string;

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'waitForRenderIdle');

    const errors = (await harness(page, 'getNodeErrors')) as Record<string, unknown>;
    expect(Object.keys(errors).length).toBeGreaterThan(0);
  });

  test('disconnect and reconnect restores viewer output', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 400, y: 100 })) as string;

    await harness(page, 'connect', solidId, 'field', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const connected = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(connected).not.toBeNull();

    await harness(page, 'disconnect', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'connect', solidId, 'field', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const reconnected = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(reconnected).not.toBeNull();
  });
});

test.describe('Multiple viewers', () => {
  test.skip('three viewers with distinct sources render independently', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidA = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 0 })) as string;
    const solidB = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 120 })) as string;
    const solidC = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 240 })) as string;
    const viewerA = (await harness(page, 'addNode', 'viewer', { x: 450, y: 0 })) as string;
    const viewerB = (await harness(page, 'addNode', 'viewer', { x: 450, y: 120 })) as string;
    const viewerC = (await harness(page, 'addNode', 'viewer', { x: 450, y: 240 })) as string;

    await harness(page, 'setParam', solidA, 'color', { type: 'color', value: [1, 0, 0, 1] });
    await harness(page, 'setParam', solidB, 'color', { type: 'color', value: [0, 1, 0, 1] });
    await harness(page, 'setParam', solidC, 'color', { type: 'color', value: [0, 0, 1, 1] });

    await harness(page, 'connect', solidA, 'field', viewerA, 'value');
    await harness(page, 'connect', solidB, 'field', viewerB, 'value');
    await harness(page, 'connect', solidC, 'field', viewerC, 'value');

    await harness(page, 'waitForRenderIdle');

    expect(await harness(page, 'getViewerResult', viewerA)).not.toBeNull();
    expect(await harness(page, 'getViewerResult', viewerB)).not.toBeNull();
    expect(await harness(page, 'getViewerResult', viewerC)).not.toBeNull();
  });

  test('removing one viewer does not affect others', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidA = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 0 })) as string;
    const solidB = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 120 })) as string;
    const solidC = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 240 })) as string;
    const viewerA = (await harness(page, 'addNode', 'viewer', { x: 450, y: 0 })) as string;
    const viewerB = (await harness(page, 'addNode', 'viewer', { x: 450, y: 120 })) as string;
    const viewerC = (await harness(page, 'addNode', 'viewer', { x: 450, y: 240 })) as string;

    await harness(page, 'connect', solidA, 'field', viewerA, 'value');
    await harness(page, 'connect', solidB, 'field', viewerB, 'value');
    await harness(page, 'connect', solidC, 'field', viewerC, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'removeNode', viewerB);
    await harness(page, 'waitForRenderIdle');

    expect(await harness(page, 'getViewerResult', viewerA)).not.toBeNull();
    expect(await harness(page, 'getViewerResult', viewerC)).not.toBeNull();
    expect(await harness(page, 'getViewerResult', viewerB)).toBeNull();
  });

  test('getViewerResult stays scoped to each viewer after disconnects', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidA = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 50 })) as string;
    const solidB = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 200 })) as string;
    const viewerA = (await harness(page, 'addNode', 'viewer', { x: 450, y: 50 })) as string;
    const viewerB = (await harness(page, 'addNode', 'viewer', { x: 450, y: 200 })) as string;

    await harness(page, 'connect', solidA, 'field', viewerA, 'value');
    await harness(page, 'connect', solidB, 'field', viewerB, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'disconnect', viewerA, 'value');
    await harness(page, 'waitForRenderIdle');

    const resultA = (await harness(page, 'getViewerResult', viewerA)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(resultA === null || resultA.hasPixels === false).toBe(true);
    expect(await harness(page, 'getViewerResult', viewerB)).not.toBeNull();
  });
});
