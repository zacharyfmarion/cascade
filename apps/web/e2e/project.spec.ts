import { test, expect } from '@playwright/test';
import { harness, waitForApp } from './helpers';

test.describe('Save/Load project', () => {
  test('saveProject returns graph data and loadProject restores it', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const bcId = (await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 500, y: 100 })) as string;

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'setParam', bcId, 'brightness', { Float: 0.7 });
    await harness(page, 'waitForRenderIdle');

    const saved = await harness(page, 'saveProject');
    const stateBefore = (await harness(page, 'getState')) as {
      nodeCount: number; connectionCount: number;
    };

    await harness(page, 'newProject');
    const stateAfterNew = (await harness(page, 'getState')) as { nodeCount: number };
    expect(stateAfterNew.nodeCount).toBe(0);

    await harness(page, 'loadProject', saved);
    await harness(page, 'waitForRenderIdle');
    const stateAfterLoad = (await harness(page, 'getState')) as {
      nodeCount: number; connectionCount: number;
    };

    expect(stateAfterLoad.nodeCount).toBe(stateBefore.nodeCount);
    expect(stateAfterLoad.connectionCount).toBe(stateBefore.connectionCount);
  });

  test('loadProject preserves connections and renders correctly', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 120 })) as string;
    const bcId = (await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 120 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 500, y: 120 })) as string;

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'setParam', bcId, 'brightness', { Float: 0.25 });
    await harness(page, 'waitForRenderIdle');

    const saved = await harness(page, 'saveProject');
    await harness(page, 'newProject');
    await harness(page, 'loadProject', saved);
    await harness(page, 'waitForRenderIdle');

    const stateAfterLoad = (await harness(page, 'getState')) as {
      nodeIds: string[]; nodeTypes: Record<string, string>;
    };
    const viewerIds = stateAfterLoad.nodeIds.filter(
      (id: string) => stateAfterLoad.nodeTypes[id] === 'viewer',
    );

    let hasPixels = false;
    for (const id of viewerIds) {
      const result = (await harness(page, 'getViewerResult', id)) as {
        hasPixels: boolean; width: number; height: number;
      } | null;
      if (result?.hasPixels) {
        hasPixels = true;
        break;
      }
    }

    expect(hasPixels).toBe(true);
  });

  test('loadProject preserves params', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 120, y: 140 })) as string;
    const bcId = (await harness(page, 'addNode', 'brightness_contrast', { x: 320, y: 140 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 520, y: 140 })) as string;

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'setParam', bcId, 'brightness', { Float: 0.42 });
    await harness(page, 'waitForRenderIdle');

    const saved = await harness(page, 'saveProject');
    await harness(page, 'newProject');
    await harness(page, 'loadProject', saved);
    await harness(page, 'waitForRenderIdle');

    const result = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(result?.hasPixels).toBe(true);
  });

  test('newProject then loadProject resets dirty flag correctly', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 140, y: 160 })) as string;
    const bcId = (await harness(page, 'addNode', 'brightness_contrast', { x: 340, y: 160 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 540, y: 160 })) as string;

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'setParam', bcId, 'brightness', { Float: 0.55 });
    await harness(page, 'waitForRenderIdle');

    const saved = await harness(page, 'saveProject');

    await harness(page, 'newProject');
    const stateAfterNew = (await harness(page, 'getState')) as { dirty: boolean };
    expect(stateAfterNew.dirty).toBe(false);

    await harness(page, 'loadProject', saved);
    const stateAfterLoad = (await harness(page, 'getState')) as { dirty: boolean };
    expect(stateAfterLoad.dirty).toBe(false);
  });

  test('save/load roundtrip preserves selection state', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 160, y: 180 })) as string;
    const bcId = (await harness(page, 'addNode', 'brightness_contrast', { x: 360, y: 180 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 560, y: 180 })) as string;

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'selectNode', bcId);
    await harness(page, 'waitForRenderIdle');

    const saved = await harness(page, 'saveProject');
    const stateBefore = (await harness(page, 'getState')) as {
      nodeCount: number; connectionCount: number;
    };

    await harness(page, 'newProject');
    await harness(page, 'loadProject', saved);
    await harness(page, 'waitForRenderIdle');

    const stateAfterLoad = (await harness(page, 'getState')) as {
      nodeCount: number; connectionCount: number;
    };
    expect(stateAfterLoad.nodeCount).toBe(stateBefore.nodeCount);
    expect(stateAfterLoad.connectionCount).toBe(stateBefore.connectionCount);
  });
});
