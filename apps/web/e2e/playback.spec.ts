import { test, expect, Page } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HarnessWindow = Window & { __compositorTest: any };

async function harness(page: Page, method: string, ...args: unknown[]): Promise<any> {
  return page.evaluate(
    ({ method, args }) => {
      const h = (window as unknown as HarnessWindow).__compositorTest;
      const fn = h[method];
      if (typeof fn !== 'function') throw new Error(`Unknown harness method: ${method}`);
      return fn.apply(h, args);
    },
    { method, args },
  );
}

async function waitForApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as HarnessWindow).__compositorTest,
    { timeout: 10_000 },
  );
  await harness(page, 'waitForEngine');
}

test.describe('Playback and rendering', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test('togglePlayback starts and stops playback', async ({ page }) => {
    // Test without a viewer — playback state transitions are the contract we care about.
    // Rendering during playback is already covered by rendering/viewer tests.
    const solidId = await harness(page, 'addNode', 'solid_color');
    expect(solidId).toBeTruthy();

    const initialState = await harness(page, 'getState');
    expect(initialState.isPlaying).toBe(false);

    // Start playback — togglePlayback sets isPlaying synchronously
    await page.evaluate(() => {
      (window as unknown as HarnessWindow).__compositorTest.togglePlayback();
    });

    // isPlaying should be true immediately (set() is synchronous in Zustand)
    const playingState = await page.evaluate(() => {
      const h = (window as unknown as HarnessWindow).__compositorTest;
      return h.getState();
    });
    expect(playingState.isPlaying).toBe(true);

    // Stop playback
    await page.evaluate(() => {
      (window as unknown as HarnessWindow).__compositorTest.togglePlayback();
    });

    const stoppedState = await page.evaluate(() => {
      const h = (window as unknown as HarnessWindow).__compositorTest;
      return h.getState();
    });
    expect(stoppedState.isPlaying).toBe(false);
  });

  test('playback advances frames when running', async ({ page }) => {
    // Without a viewer, playback still advances frames via the internal loop.
    const solidId = await harness(page, 'addNode', 'solid_color');
    expect(solidId).toBeTruthy();

    await harness(page, 'setFps', 30);

    const before = await harness(page, 'getState');
    expect(before.currentFrame).toBe(0);

    // Start playback
    await page.evaluate(() => {
      (window as unknown as HarnessWindow).__compositorTest.togglePlayback();
    });

    // Wait for some frames to advance
    await page.waitForTimeout(600);

    // Stop playback so we can read state without WASM blocking
    await page.evaluate(() => {
      (window as unknown as HarnessWindow).__compositorTest.togglePlayback();
    });

    const after = await page.evaluate(() => {
      const h = (window as unknown as HarnessWindow).__compositorTest;
      return h.getState();
    });
    expect(after.isPlaying).toBe(false);
    // Frames should have advanced (at 30fps, 600ms ≈ 18 frames, but timing varies)
    expect(after.currentFrame).toBeGreaterThan(0);
  });

  test('setParam during playback does not crash', async ({ page }) => {
    const solidId = await harness(page, 'addNode', 'solid_color');
    const bcId = await harness(page, 'addNode', 'brightness_contrast');
    await harness(page, 'connect', solidId, 'field', bcId, 'image');

    // Start playback (no viewer, so no WASM render blocking)
    await page.evaluate(() => {
      (window as unknown as HarnessWindow).__compositorTest.togglePlayback();
    });

    // Set param during playback — should not crash or hang
    await page.evaluate(
      ({ bcId }) => {
        const h = (window as unknown as HarnessWindow).__compositorTest;
        h.setParam(bcId, 'brightness', { Float: 0.25 });
      },
      { bcId },
    );

    await page.waitForTimeout(200);

    // Stop playback
    await page.evaluate(() => {
      (window as unknown as HarnessWindow).__compositorTest.togglePlayback();
    });

    const state = await page.evaluate(() => {
      const h = (window as unknown as HarnessWindow).__compositorTest;
      return h.getState();
    });
    expect(state.isPlaying).toBe(false);
    // Should not have crashed — if we got here, the test passes
  });

  test('setFps updates playback speed', async ({ page }) => {
    await harness(page, 'setFps', 5);

    const state1 = await harness(page, 'getState');
    expect(state1.fps).toBe(5);

    await harness(page, 'setFps', 60);

    const state2 = await harness(page, 'getState');
    expect(state2.fps).toBe(60);
  });

  test('setLoopPlayback toggles loop state', async ({ page }) => {
    const initialState = await harness(page, 'getState');
    // loopPlayback defaults to true (from settingsStore)
    expect(initialState.loopPlayback).toBe(true);

    await harness(page, 'setLoopPlayback', false);
    const state1 = await harness(page, 'getState');
    expect(state1.loopPlayback).toBe(false);

    await harness(page, 'setLoopPlayback', true);
    const state2 = await harness(page, 'getState');
    expect(state2.loopPlayback).toBe(true);
  });
});
