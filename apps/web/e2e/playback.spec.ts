import { test, expect } from '@playwright/test';
import { harness, waitForApp, type HarnessWindow } from './helpers';

test.describe('Playback and rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
  });

  test('togglePlayback starts and stops playback', async ({ page }) => {
    // Test without a viewer — playback state transitions are the contract we care about.
    // Rendering during playback is already covered by rendering/viewer tests.
    const solidId = (await harness(page, 'addNode', 'solid_color')) as string;
    expect(solidId).toBeTruthy();

    const initialState = (await harness(page, 'getState')) as { isPlaying: boolean };
    expect(initialState.isPlaying).toBe(false);

    // Start playback — togglePlayback sets isPlaying synchronously
    await page.evaluate(() => {
      (window as unknown as HarnessWindow).__cascadeTest.togglePlayback();
    });

    // isPlaying should be true immediately (set() is synchronous in Zustand)
    const playingState = await page.evaluate(() => {
      const h = (window as unknown as HarnessWindow).__cascadeTest;
      return h.getState();
    }) as { isPlaying: boolean };
    expect(playingState.isPlaying).toBe(true);

    // Stop playback
    await page.evaluate(() => {
      (window as unknown as HarnessWindow).__cascadeTest.togglePlayback();
    });

    const stoppedState = await page.evaluate(() => {
      const h = (window as unknown as HarnessWindow).__cascadeTest;
      return h.getState();
    }) as { isPlaying: boolean };
    expect(stoppedState.isPlaying).toBe(false);
  });

  test('playback advances frames when running', async ({ page }) => {
    // Without a viewer, playback still advances frames via the internal loop.
    const solidId = (await harness(page, 'addNode', 'solid_color')) as string;
    expect(solidId).toBeTruthy();

    await harness(page, 'setFps', 30);

    const before = (await harness(page, 'getState')) as { currentFrame: number };
    expect(before.currentFrame).toBe(0);

    // Start playback
    await page.evaluate(() => {
      (window as unknown as HarnessWindow).__cascadeTest.togglePlayback();
    });

    // Wait for some frames to advance
    await page.waitForTimeout(600);

    // Stop playback so we can read state without WASM blocking
    await page.evaluate(() => {
      (window as unknown as HarnessWindow).__cascadeTest.togglePlayback();
    });

    const after = await page.evaluate(() => {
      const h = (window as unknown as HarnessWindow).__cascadeTest;
      return h.getState();
    }) as { isPlaying: boolean; currentFrame: number };
    expect(after.isPlaying).toBe(false);
    // Frames should have advanced (at 30fps, 600ms ≈ 18 frames, but timing varies)
    expect(after.currentFrame).toBeGreaterThan(0);
  });

  test('setParam during playback does not crash', async ({ page }) => {
    const solidId = (await harness(page, 'addNode', 'solid_color')) as string;
    const bcId = (await harness(page, 'addNode', 'gaussian_blur')) as string;
    await harness(page, 'connect', solidId, 'field', bcId, 'image');

    // Start playback (no viewer, so no WASM render blocking)
    await page.evaluate(() => {
      (window as unknown as HarnessWindow).__cascadeTest.togglePlayback();
    });

    // Set param during playback — should not crash or hang
    await page.evaluate(
      ({ bcId }) => {
        const h = (window as unknown as HarnessWindow).__cascadeTest;
        h.setParam(bcId, 'amount', { Float: 0.25 });
      },
      { bcId },
    );

    await page.waitForTimeout(200);

    // Stop playback
    await page.evaluate(() => {
      (window as unknown as HarnessWindow).__cascadeTest.togglePlayback();
    });

    const state = await page.evaluate(() => {
      const h = (window as unknown as HarnessWindow).__cascadeTest;
      return h.getState();
    }) as { isPlaying: boolean };
    expect(state.isPlaying).toBe(false);
    // Should not have crashed — if we got here, the test passes
  });

  test('setFps updates playback speed', async ({ page }) => {
    await harness(page, 'setFps', 5);

    const state1 = (await harness(page, 'getState')) as { fps: number };
    expect(state1.fps).toBe(5);

    await harness(page, 'setFps', 60);

    const state2 = (await harness(page, 'getState')) as { fps: number };
    expect(state2.fps).toBe(60);
  });

  test('setLoopPlayback toggles loop state', async ({ page }) => {
    const initialState = (await harness(page, 'getState')) as { loopPlayback: boolean };
    // loopPlayback defaults to true (from settingsStore)
    expect(initialState.loopPlayback).toBe(true);

    await harness(page, 'setLoopPlayback', false);
    const state1 = (await harness(page, 'getState')) as { loopPlayback: boolean };
    expect(state1.loopPlayback).toBe(false);

    await harness(page, 'setLoopPlayback', true);
    const state2 = (await harness(page, 'getState')) as { loopPlayback: boolean };
    expect(state2.loopPlayback).toBe(true);
  });
});
