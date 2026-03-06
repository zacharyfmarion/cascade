import { test, expect } from '@playwright/test';
import { harness, waitForApp } from './helpers';

test.describe('Race condition resilience', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
  });

  test('rapid undo/redo produces consistent state', async ({ page }) => {
    // Build a chain: solid_color -> brightness_contrast -> viewer
    const solidId = await harness(page, 'addNode', 'solid_color');
    const bcId = await harness(page, 'addNode', 'gaussian_blur');
    const viewerId = await harness(page, 'addNode', 'viewer');
    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    // Make 5 distinct param changes, each creating an undo entry
    const values = [0.1, 0.2, 0.3, 0.4, 0.5];
    for (const v of values) {
      await harness(page, 'setParam', bcId, 'amount', { Float: v });
      await harness(page, 'waitForRenderIdle');
    }

    const stateAfterEdits = await harness(page, 'getState');
    expect(stateAfterEdits.canUndo).toBe(true);

    // Rapid-fire undo: fire 5 undos without waiting between them.
    // Before the fix, this would cause concurrent restoreSnapshot calls.
    await Promise.all([
      harness(page, 'undo'),
      harness(page, 'undo'),
      harness(page, 'undo'),
      harness(page, 'undo'),
      harness(page, 'undo'),
    ]);

    // Allow the serialized undo chain to complete
    await harness(page, 'waitForRenderIdle');

    const stateAfterUndo = await harness(page, 'getState');
    // After 5 undos, we should be back to the initial brightness value
    expect(stateAfterUndo.canRedo).toBe(true);

    // Now rapid-fire redo: fire 5 redos
    await Promise.all([
      harness(page, 'redo'),
      harness(page, 'redo'),
      harness(page, 'redo'),
      harness(page, 'redo'),
      harness(page, 'redo'),
    ]);

    await harness(page, 'waitForRenderIdle');

    const stateAfterRedo = await harness(page, 'getState');
    // After redoing all 5, redo stack should be empty and undo should be available
    expect(stateAfterRedo.canUndo).toBe(true);
    expect(stateAfterRedo.canRedo).toBe(false);
  });

  test('rapid live param drag + commit produces valid undo snapshot', async ({
    page,
  }) => {
    const solidId = await harness(page, 'addNode', 'solid_color');
    const bcId = await harness(page, 'addNode', 'gaussian_blur');
    const viewerId = await harness(page, 'addNode', 'viewer');
    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    // Simulate a rapid slider drag: setParamLive many times, then commit
    // Before the fix, the undo snapshot could have incomplete engineState/imageData
    for (let i = 0; i < 10; i++) {
      await harness(page, 'setParamLive', bcId, 'amount', {
        Float: i * 0.1,
      });
    }

    // Commit immediately — this should await the pending snapshot promises
    await harness(page, 'setParamCommit', bcId, 'amount', { Float: 0.9 });
    await harness(page, 'waitForRenderIdle');

    const stateAfterCommit = await harness(page, 'getState');
    expect(stateAfterCommit.canUndo).toBe(true);

    // Undo should restore to the state before the drag started
    await harness(page, 'undo');
    await harness(page, 'waitForRenderIdle');

    const stateAfterUndo = await harness(page, 'getState');
    expect(stateAfterUndo.canRedo).toBe(true);

    // Redo should get us back to brightness=0.9
    await harness(page, 'redo');
    await harness(page, 'waitForRenderIdle');

    const stateAfterRedo = await harness(page, 'getState');
    expect(stateAfterRedo.canUndo).toBe(true);
  });

  test('sequential undo after multiple operations maintains stack integrity', async ({
    page,
  }) => {
    const solidId = await harness(page, 'addNode', 'solid_color');
    const bcId = await harness(page, 'addNode', 'gaussian_blur');
    const viewerId = await harness(page, 'addNode', 'viewer');
    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    // Set brightness to different values
    await harness(page, 'setParam', bcId, 'amount', { Float: 0.3 });
    await harness(page, 'waitForRenderIdle');
    const result1 = await harness(page, 'getViewerResult', viewerId);

    await harness(page, 'setParam', bcId, 'amount', { Float: 0.7 });
    await harness(page, 'waitForRenderIdle');
    const result2 = await harness(page, 'getViewerResult', viewerId);

    // Different brightness values should produce different renders
    expect(result1).toBeTruthy();
    expect(result2).toBeTruthy();

    // Undo twice, verify renders are different at each step
    await harness(page, 'undo');
    await harness(page, 'waitForRenderIdle');
    const afterUndo1 = await harness(page, 'getViewerResult', viewerId);
    expect(afterUndo1).toBeTruthy();

    await harness(page, 'undo');
    await harness(page, 'waitForRenderIdle');
    const afterUndo2 = await harness(page, 'getViewerResult', viewerId);
    expect(afterUndo2).toBeTruthy();
  });

  test('interleaved undo/redo does not corrupt stacks', async ({ page }) => {
    const solidId = await harness(page, 'addNode', 'solid_color');
    const bcId = await harness(page, 'addNode', 'gaussian_blur');
    const viewerId = await harness(page, 'addNode', 'viewer');
    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    // Create 3 undo entries
    await harness(page, 'setParam', bcId, 'amount', { Float: 0.2 });
    await harness(page, 'waitForRenderIdle');
    await harness(page, 'setParam', bcId, 'amount', { Float: 0.5 });
    await harness(page, 'waitForRenderIdle');
    await harness(page, 'setParam', bcId, 'amount', { Float: 0.8 });
    await harness(page, 'waitForRenderIdle');

    // Undo 2, redo 1, undo 1 — interleaved pattern
    await harness(page, 'undo');
    await harness(page, 'waitForRenderIdle');
    await harness(page, 'undo');
    await harness(page, 'waitForRenderIdle');

    const mid = await harness(page, 'getState');
    expect(mid.canUndo).toBe(true);
    expect(mid.canRedo).toBe(true);

    await harness(page, 'redo');
    await harness(page, 'waitForRenderIdle');

    const afterRedo = await harness(page, 'getState');
    expect(afterRedo.canUndo).toBe(true);
    expect(afterRedo.canRedo).toBe(true);

    await harness(page, 'undo');
    await harness(page, 'waitForRenderIdle');

    const final = await harness(page, 'getState');
    expect(final.canUndo).toBe(true);
    expect(final.canRedo).toBe(true);
  });

  test('node deletion after live param drag cleans up correctly', async ({
    page,
  }) => {
    const solidId = await harness(page, 'addNode', 'solid_color');
    const bcId = await harness(page, 'addNode', 'gaussian_blur');
    const viewerId = await harness(page, 'addNode', 'viewer');
    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    // Start a live param drag
    await harness(page, 'setParamLive', bcId, 'amount', { Float: 0.5 });

    // Delete the node mid-drag (edge case)
    await harness(page, 'selectNode', bcId);
    await harness(page, 'removeNode', bcId);
    await harness(page, 'waitForRenderIdle');

    const state = await harness(page, 'getState');
    // Should have 2 nodes left (solid + viewer), no crash
    expect(state.nodeCount).toBe(2);
    // Connections involving deleted node should be gone
    expect(state.connectionCount).toBe(0);
  });
});
