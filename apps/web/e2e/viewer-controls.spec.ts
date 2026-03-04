import { test, expect } from '@playwright/test';
import { harness, waitForApp } from './helpers';

/**
 * Build a minimal SolidColor → Viewer pipeline and wait for render.
 * Returns the viewer node ID.
 */
async function setupSolidColorPipeline(
  page: import('@playwright/test').Page,
  color?: { r: number; g: number; b: number; a: number },
) {
  await page.goto('/');
  await waitForApp(page);

  const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
  const viewerId = (await harness(page, 'addNode', 'viewer', { x: 400, y: 100 })) as string;
  await harness(page, 'connect', solidId, 'field', viewerId, 'value');

  if (color) {
    await harness(page, 'setParam', solidId, 'color', [color.r, color.g, color.b, color.a]);
  }

  await harness(page, 'waitForRenderIdle');
  return { solidId, viewerId };
}

// ═══════════════════════════════════════════════════════════════
// Channel Isolation
// ═══════════════════════════════════════════════════════════════

test.describe('Viewer channel isolation', () => {
  test('channel buttons are visible in toolbar', async ({ page }) => {
    await setupSolidColorPipeline(page);

    for (const ch of ['r', 'g', 'b', 'a']) {
      await expect(page.getByTestId(`channel-btn-${ch}`)).toBeVisible();
    }
  });

  test('clicking a channel button toggles active state', async ({ page }) => {
    await setupSolidColorPipeline(page);

    // Initially no channel is active
    const state0 = (await harness(page, 'getViewerDisplayState')) as {
      channel: string | null;
    } | null;
    expect(state0?.channel).toBeNull();

    // Click R → R is active
    await page.getByTestId('channel-btn-r').click();
    const state1 = (await harness(page, 'getViewerDisplayState')) as {
      channel: string | null;
    } | null;
    expect(state1?.channel).toBe('r');

    // Click R again → deselected
    await page.getByTestId('channel-btn-r').click();
    const state2 = (await harness(page, 'getViewerDisplayState')) as {
      channel: string | null;
    } | null;
    expect(state2?.channel).toBeNull();
  });

  test('clicking a different channel switches to it', async ({ page }) => {
    await setupSolidColorPipeline(page);

    await page.getByTestId('channel-btn-r').click();
    const state1 = (await harness(page, 'getViewerDisplayState')) as {
      channel: string | null;
    } | null;
    expect(state1?.channel).toBe('r');

    await page.getByTestId('channel-btn-g').click();
    const state2 = (await harness(page, 'getViewerDisplayState')) as {
      channel: string | null;
    } | null;
    expect(state2?.channel).toBe('g');
  });

  test('keyboard shortcut r/g/b/a toggles channel when viewer focused', async ({ page }) => {
    await setupSolidColorPipeline(page);

    // Focus the viewer panel
    const viewer = page.getByTestId('viewer-panel');
    await viewer.click();

    // Press 'b' → B channel active
    await viewer.press('b');
    const state1 = (await harness(page, 'getViewerDisplayState')) as {
      channel: string | null;
    } | null;
    expect(state1?.channel).toBe('b');

    // Press 'b' again → deselected
    await viewer.press('b');
    const state2 = (await harness(page, 'getViewerDisplayState')) as {
      channel: string | null;
    } | null;
    expect(state2?.channel).toBeNull();

    // Press 'a' → A channel active
    await viewer.press('a');
    const state3 = (await harness(page, 'getViewerDisplayState')) as {
      channel: string | null;
    } | null;
    expect(state3?.channel).toBe('a');
  });
});

// ═══════════════════════════════════════════════════════════════
// Gain / Gamma controls
// ═══════════════════════════════════════════════════════════════

test.describe('Viewer gain and gamma controls', () => {
  test('gain and gamma sliders are visible', async ({ page }) => {
    await setupSolidColorPipeline(page);

    await expect(page.getByTestId('gain-slider')).toBeVisible();
    await expect(page.getByTestId('gamma-slider')).toBeVisible();
  });

  test('default gain and gamma are 1.0', async ({ page }) => {
    await setupSolidColorPipeline(page);

    const state = (await harness(page, 'getViewerDisplayState')) as {
      gain: number;
      gamma: number;
    } | null;
    expect(state?.gain).toBeCloseTo(1.0, 1);
    expect(state?.gamma).toBeCloseTo(1.0, 1);
  });

  test('adjusting gain slider updates display state', async ({ page }) => {
    await setupSolidColorPipeline(page);

    const gainSlider = page.getByTestId('gain-slider');

    // Drag gain slider to the right (increase exposure)
    await gainSlider.fill('1'); // log2(gain) = 1 → gain = 2
    await gainSlider.dispatchEvent('change');

    const state = (await harness(page, 'getViewerDisplayState')) as {
      gain: number;
    } | null;
    expect(state?.gain).toBeCloseTo(2.0, 1);
  });

  test('adjusting gamma slider updates display state', async ({ page }) => {
    await setupSolidColorPipeline(page);

    const gammaSlider = page.getByTestId('gamma-slider');
    await gammaSlider.fill('2.2');
    await gammaSlider.dispatchEvent('change');

    const state = (await harness(page, 'getViewerDisplayState')) as {
      gamma: number;
    } | null;
    expect(state?.gamma).toBeCloseTo(2.2, 1);
  });

  test('reset button appears when gain or gamma changed and resets both', async ({ page }) => {
    await setupSolidColorPipeline(page);

    // Initially no reset button
    await expect(page.getByTestId('reset-display-btn')).not.toBeVisible();

    // Change gain
    const gainSlider = page.getByTestId('gain-slider');
    await gainSlider.fill('1');
    await gainSlider.dispatchEvent('change');

    // Reset button should appear
    await expect(page.getByTestId('reset-display-btn')).toBeVisible();

    // Click reset
    await page.getByTestId('reset-display-btn').click();

    const state = (await harness(page, 'getViewerDisplayState')) as {
      gain: number;
      gamma: number;
    } | null;
    expect(state?.gain).toBeCloseTo(1.0, 1);
    expect(state?.gamma).toBeCloseTo(1.0, 1);

    // Reset button should disappear
    await expect(page.getByTestId('reset-display-btn')).not.toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
// Pixel Inspector
// ═══════════════════════════════════════════════════════════════

test.describe('Viewer pixel inspector', () => {
  test('pixel inspector is hidden when not hovering canvas', async ({ page }) => {
    await setupSolidColorPipeline(page);

    await expect(page.getByTestId('pixel-inspector')).not.toBeVisible();
  });

  test('pixel inspector appears on canvas hover and shows RGBA values', async ({ page }) => {
    await setupSolidColorPipeline(page);

    // Hover over the canvas — use locator.hover with force to bypass dockview overlay
    const canvas = page.locator('[data-viewer-canvas]');
    await canvas.hover({ force: true });
    // Give React time to process the mousemove event
    await page.waitForTimeout(500);

    // Inspector should appear
    await expect(page.getByTestId('pixel-inspector')).toBeVisible({ timeout: 5000 });

    // Should have pixel info data attribute
    const info = (await harness(page, 'getPixelInspectorValue')) as {
      x: number;
      y: number;
      r: number;
      g: number;
      b: number;
      a: number;
    } | null;
    expect(info).not.toBeNull();
    expect(info?.x).toBeGreaterThanOrEqual(0);
    expect(info?.y).toBeGreaterThanOrEqual(0);
    // RGBA values should be valid 0-255
    expect(info?.r).toBeGreaterThanOrEqual(0);
    expect(info?.r).toBeLessThanOrEqual(255);
    expect(info?.a).toBeGreaterThanOrEqual(0);
    expect(info?.a).toBeLessThanOrEqual(255);
  });

  test('pixel inspector disappears when mouse leaves canvas', async ({ page }) => {
    await setupSolidColorPipeline(page);

    // Hover canvas → inspector visible
    const canvas = page.locator('[data-viewer-canvas]');
    await canvas.hover({ force: true });
    await page.waitForTimeout(500);
    await expect(page.getByTestId('pixel-inspector')).toBeVisible({ timeout: 5000 });

    // Move mouse to a completely different part of the page (the menu bar area)
    await page.mouse.move(640, 10);
    await page.waitForTimeout(500);

    // Inspector should disappear
    await expect(page.getByTestId('pixel-inspector')).not.toBeVisible({ timeout: 5000 });
  });
});

