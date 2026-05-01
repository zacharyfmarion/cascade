import { test, expect } from '@playwright/test';
import { harness, waitForApp } from './helpers';

test.describe('Photo Adjust', () => {
  test('renders after connecting image and changing wired input defaults', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await waitForApp(page);

    const specs = (await harness(page, 'getNodeSpecs')) as Array<{ id: string }>;
    test.skip(
      !specs.some((spec) => spec.id === 'group::photo_adjust'),
      'Photo Adjust is GPU-only and this browser did not register GPU nodes',
    );

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const adjustId = (await harness(page, 'addNode', 'group::photo_adjust', { x: 320, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 560, y: 100 })) as string;

    await harness(page, 'connect', solidId, 'field', adjustId, 'image');
    await harness(page, 'connect', adjustId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'setInputDefault', adjustId, 'exposure', { Float: 1.0 });
    await harness(page, 'waitForRenderIdle');

    const result = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean;
      width?: number;
      height?: number;
    } | null;
    const errors = (await harness(page, 'getNodeErrors')) as Record<string, string>;

    expect(pageErrors).toEqual([]);
    expect(errors).toEqual({});
    expect(result).not.toBeNull();
    expect(result?.hasPixels).toBe(true);
    expect(result?.width).toBeGreaterThan(0);
    expect(result?.height).toBeGreaterThan(0);
  });
});
