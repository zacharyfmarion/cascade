import { test, expect } from '@playwright/test';
import { harness, waitForApp } from './helpers';

async function createSolidToViewer(page: import('@playwright/test').Page) {
  const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
  const viewerId = (await harness(page, 'addNode', 'viewer', { x: 400, y: 100 })) as string;
  await harness(page, 'connect', solidId, 'field', viewerId, 'value');
  await harness(page, 'waitForRenderIdle');
  return { solidId, viewerId };
}

test.describe('Selection state', () => {
  test('selecting a node reports it as selected', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    await harness(page, 'selectNode', solidId);

    const selected = (await harness(page, 'getSelectedNodes')) as string[];
    expect(selected).toEqual([solidId]);
  });

  test('selecting null clears selection', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    await harness(page, 'selectNode', solidId);
    await harness(page, 'selectNode', null);

    const selected = (await harness(page, 'getSelectedNodes')) as string[];
    expect(selected).toEqual([]);
  });

  test('setSelectedNodes selects multiple and survives mutations', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const invertId = (await harness(page, 'addNode', 'curves', { x: 300, y: 100 })) as string;
    await harness(page, 'setSelectedNodes', [solidId, invertId]);

    const selectedInitial = (await harness(page, 'getSelectedNodes')) as string[];
    expect(selectedInitial).toEqual([solidId, invertId]);

    await harness(page, 'setParam', solidId, 'color', {
      type: 'color',
      value: [0.2, 0.4, 0.6, 1.0],
    });
    await harness(page, 'addNode', 'gaussian_blur', { x: 500, y: 100 });

    const selectedAfter = (await harness(page, 'getSelectedNodes')) as string[];
    expect(selectedAfter).toEqual([solidId, invertId]);
  });
});

test.describe('Mute toggle', () => {
  test('toggle mute on selected node re-renders viewer output', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const { solidId, viewerId } = await createSolidToViewer(page);
    await harness(page, 'selectNode', solidId);

    const resultBefore = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(resultBefore).not.toBeNull();
    expect(resultBefore?.hasPixels).toBe(true);

    await harness(page, 'toggleMuteSelected');
    await harness(page, 'waitForRenderIdle');

    const resultAfter = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(resultAfter).not.toBeNull();
    expect(resultAfter?.hasPixels).toBe(false);
  });

  test('mute then unmute restores viewer output', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const { solidId, viewerId } = await createSolidToViewer(page);
    await harness(page, 'selectNode', solidId);

    await harness(page, 'toggleMuteSelected');
    await harness(page, 'waitForRenderIdle');

    const mutedResult = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(mutedResult).not.toBeNull();
    expect(mutedResult?.hasPixels).toBe(false);

    await harness(page, 'toggleMuteSelected');
    await harness(page, 'waitForRenderIdle');

    const unmutedResult = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(unmutedResult).not.toBeNull();
    expect(unmutedResult?.hasPixels).toBe(true);
  });
});

test.describe('Playback / Frame', () => {
  test('setCurrentFrame updates state', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await harness(page, 'setCurrentFrame', 5);
    const state = (await harness(page, 'getState')) as { currentFrame: number };
    expect(state.currentFrame).toBe(5);
  });

  test('stepForward/stepBackward increments and decrements frame', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await harness(page, 'setCurrentFrame', 3);
    await harness(page, 'stepForward');
    let state = (await harness(page, 'getState')) as { currentFrame: number };
    expect(state.currentFrame).toBe(4);

    await harness(page, 'stepBackward');
    state = (await harness(page, 'getState')) as { currentFrame: number };
    expect(state.currentFrame).toBe(3);
  });

  test('stepBackward at frame 0 stays at 0', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await harness(page, 'setCurrentFrame', 0);
    await harness(page, 'stepBackward');
    const state = (await harness(page, 'getState')) as { currentFrame: number };
    expect(state.currentFrame).toBe(0);
  });
});

test.describe('Dirty flag', () => {
  test('fresh project is not dirty', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const state = (await harness(page, 'getState')) as { dirty: boolean };
    expect(state.dirty).toBe(false);
  });

  test('addNode marks dirty and newProject clears dirty', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });
    let state = (await harness(page, 'getState')) as { dirty: boolean };
    expect(state.dirty).toBe(true);

    await harness(page, 'newProject');
    state = (await harness(page, 'getState')) as { dirty: boolean };
    expect(state.dirty).toBe(false);
  });
});

test.describe('Project lifecycle', () => {
  test('newProject clears nodes and connections', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 400, y: 100 })) as string;
    await harness(page, 'connect', solidId, 'field', viewerId, 'value');

    let state = (await harness(page, 'getState')) as {
      nodeCount: number; connectionCount: number;
    };
    expect(state.nodeCount).toBe(2);
    expect(state.connectionCount).toBe(1);

    await harness(page, 'newProject');
    state = (await harness(page, 'getState')) as {
      nodeCount: number; connectionCount: number;
    };
    expect(state.nodeCount).toBe(0);
    expect(state.connectionCount).toBe(0);
  });

  test('newProject resets frame and supports new graphs', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await harness(page, 'setCurrentFrame', 12);
    await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 });

    // BUG: newProject does not reset currentFrame to 0
    await harness(page, 'newProject');
    const state = (await harness(page, 'getState')) as {
      currentFrame: number; dirty: boolean;
    };
    expect(state.currentFrame).toBe(0);
    expect(state.dirty).toBe(false);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 400, y: 100 })) as string;
    await harness(page, 'connect', solidId, 'field', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const result = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(result).not.toBeNull();
  });
});
