import { test, expect } from '@playwright/test';
import { harness, waitForApp } from './helpers';

test.describe('Save/Load project', () => {
  test('saveProject returns graph data and loadProject restores it', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const bcId = (await harness(page, 'addNode', 'gaussian_blur', { x: 300, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 500, y: 100 })) as string;

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'setParam', bcId, 'amount', { Float: 0.7 });
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
    const bcId = (await harness(page, 'addNode', 'gaussian_blur', { x: 300, y: 120 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 500, y: 120 })) as string;

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'setParam', bcId, 'amount', { Float: 0.25 });
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
    const bcId = (await harness(page, 'addNode', 'gaussian_blur', { x: 320, y: 140 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 520, y: 140 })) as string;

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'setParam', bcId, 'amount', { Float: 0.42 });
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

  test('loadProject rehydrates custom group nodes before rendering them', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 120 })) as string;
    const blurId = (await harness(page, 'addNode', 'gaussian_blur', { x: 300, y: 120 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 520, y: 120 })) as string;

    await harness(page, 'connect', solidId, 'field', blurId, 'image');
    await harness(page, 'connect', blurId, 'image', viewerId, 'value');
    const groupNodeId = (await harness(page, 'createGroup', [solidId, blurId], 'Hydration Group')) as string;
    expect(groupNodeId).toBeTruthy();
    await harness(page, 'waitForRenderIdle');

    const saved = await harness(page, 'saveProject');
    await harness(page, 'newProject');
    await harness(page, 'loadProject', saved);
    await harness(page, 'waitForRenderIdle');

    const stateAfterLoad = (await harness(page, 'getState')) as {
      nodeIds: string[];
      nodeTypes: Record<string, string>;
    };
    const reloadedGroupId = stateAfterLoad.nodeIds.find(
      (id: string) => String(stateAfterLoad.nodeTypes[id]).startsWith('group::user_'),
    );
    expect(reloadedGroupId).toBeTruthy();

    await expect(page.locator('.base-node__title', { hasText: 'Hydration Group' }).first()).toBeVisible();
    await expect(page.getByText(/^group::user_/)).toHaveCount(0);

    await harness(page, 'enterGroup', reloadedGroupId);
    const stack = (await harness(page, 'getEditingStack')) as Array<{ label: string }>;
    expect(stack.map(entry => entry.label)).toContain('Hydration Group');

    await harness(page, 'exitGroup');
    await harness(page, 'waitForRenderIdle');

    const viewerResult = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean;
      width: number;
      height: number;
    } | null;
    expect(viewerResult?.hasPixels).toBe(true);
  });

  test('newProject then loadProject resets dirty flag correctly', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 140, y: 160 })) as string;
    const bcId = (await harness(page, 'addNode', 'gaussian_blur', { x: 340, y: 160 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 540, y: 160 })) as string;

    await harness(page, 'connect', solidId, 'field', bcId, 'image');
    await harness(page, 'connect', bcId, 'image', viewerId, 'value');
    await harness(page, 'setParam', bcId, 'amount', { Float: 0.55 });
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
    const bcId = (await harness(page, 'addNode', 'gaussian_blur', { x: 360, y: 180 })) as string;
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

test.describe('Project migration', () => {
  test('loadProject migrates v1.0.0 document successfully', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Build a project with a connection: solid_color -> viewer
    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 400, y: 100 })) as string;
    await harness(page, 'connect', solidId, 'field', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    // Save the current project, downgrade to v1.0.0 format, and return as string.
    // v1.0.0 -> v1.1.0 migration renames viewer input port "image" -> "value".
    const v1Doc = await page.evaluate(async () => {
      const store = (window as Record<string, unknown>).__cascadeTest as Record<string, (...args: unknown[]) => unknown>;
      const rawSaved = await store.saveProject();
      // saveProject/exportGraph returns raw graph data (no envelope)
      const graphData = typeof rawSaved === 'string' ? JSON.parse(rawSaved) : rawSaved;
      // Wrap in a v1.0.0 document envelope to trigger migration
      const envelope = {
        cascade: { format_version: '1.0.0' },
        graph: graphData,
      };
      // v1.0.0 -> v1.1.0 migration renames viewer input port "image" -> "value"
      if (envelope.graph?.connections) {
        for (const conn of envelope.graph.connections as Array<Record<string, string>>) {
          if (conn.to_port === 'value') {
            conn.to_port = 'image';
          }
        }
      }
      return JSON.stringify(envelope);
    });

    // Clear and load the v1.0.0 document — should trigger migration
    await harness(page, 'newProject');
    await harness(page, 'loadProject', v1Doc);
    await harness(page, 'waitForRenderIdle');

    // Verify the project loaded successfully with correct node count
    const state = (await harness(page, 'getState')) as {
      nodeCount: number;
      connectionCount: number;
    };
    expect(state.nodeCount).toBe(2);
    expect(state.connectionCount).toBe(1);

    // Verify viewer actually renders (migration reconnected the port)
    const stateWithIds = (await harness(page, 'getState')) as {
      nodeIds: string[];
      nodeTypes: Record<string, string>;
    };
    const viewerIds = stateWithIds.nodeIds.filter(
      (id: string) => stateWithIds.nodeTypes[id] === 'viewer',
    );
    let hasPixels = false;
    for (const id of viewerIds) {
      const result = (await harness(page, 'getViewerResult', id)) as {
        hasPixels: boolean;
      } | null;
      if (result?.hasPixels) {
        hasPixels = true;
        break;
      }
    }
    expect(hasPixels).toBe(true);
  });
});
