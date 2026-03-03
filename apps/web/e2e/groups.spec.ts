import { test, expect } from '@playwright/test';
import { harness, waitForApp } from './helpers';

test.describe('Group operations', () => {
  test('createGroup bundles selected nodes', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const brightId = (await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 500, y: 100 })) as string;

    await harness(page, 'connect', solidId, 'field', brightId, 'image');
    await harness(page, 'connect', brightId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'createGroup', [solidId, brightId], 'MyGroup');
    await harness(page, 'waitForRenderIdle');

    const stateAfterGroup = (await harness(page, 'getState')) as {
      nodeCount: number; connectionCount: number; canUndo: boolean;
    };
    expect(stateAfterGroup.nodeCount).toBe(2);
    expect(stateAfterGroup.connectionCount).toBeGreaterThan(0);
    expect(stateAfterGroup.canUndo).toBe(true);
  });

  test('enterGroup shows internal graph', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const brightId = (await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 500, y: 100 })) as string;

    await harness(page, 'connect', solidId, 'field', brightId, 'image');
    await harness(page, 'connect', brightId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'createGroup', [solidId, brightId], 'MyGroup');
    await harness(page, 'waitForRenderIdle');

    const stateAfterGroup = (await harness(page, 'getState')) as {
      nodeIds: string[]; nodeTypes: Record<string, string>;
    };
    const groupNodeId = stateAfterGroup.nodeIds.find(
      (id: string) => String(stateAfterGroup.nodeTypes[id]).includes('group'),
    );
    expect(groupNodeId).toBeTruthy();

    await harness(page, 'enterGroup', groupNodeId);
    await harness(page, 'waitForRenderIdle');

    const editingStack = (await harness(page, 'getEditingStack')) as unknown[];
    expect(editingStack.length).toBe(2);

    const stateInsideGroup = (await harness(page, 'getState')) as {
      nodeCount: number; nodeTypes: Record<string, string>;
    };
    // Group contains original nodes plus IO proxy nodes (group_input, group_output)
    expect(stateInsideGroup.nodeCount).toBeGreaterThanOrEqual(2);
    const insideTypes = Object.values(stateInsideGroup.nodeTypes);
    expect(insideTypes).toContain('solid_color');
    expect(insideTypes).toContain('brightness_contrast');
  });

  test('exitGroup returns to outer graph', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const brightId = (await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 500, y: 100 })) as string;

    await harness(page, 'connect', solidId, 'field', brightId, 'image');
    await harness(page, 'connect', brightId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'createGroup', [solidId, brightId], 'MyGroup');
    await harness(page, 'waitForRenderIdle');

    const stateAfterGroup = (await harness(page, 'getState')) as {
      nodeIds: string[]; nodeTypes: Record<string, string>;
    };
    const groupNodeId = stateAfterGroup.nodeIds.find(
      (id: string) => String(stateAfterGroup.nodeTypes[id]).includes('group'),
    );
    expect(groupNodeId).toBeTruthy();

    await harness(page, 'enterGroup', groupNodeId);
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'exitGroup');
    await harness(page, 'waitForRenderIdle');

    const editingStack = (await harness(page, 'getEditingStack')) as unknown[];
    expect(editingStack.length).toBe(1);

    const stateAfterExit = (await harness(page, 'getState')) as {
      nodeCount: number; nodeTypes: Record<string, string>;
    };
    expect(stateAfterExit.nodeCount).toBe(2);
    const outerTypes = Object.values(stateAfterExit.nodeTypes);
    expect(outerTypes).toContain('viewer');
  });

  test('undo after createGroup restores original nodes', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const brightId = (await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 500, y: 100 })) as string;

    await harness(page, 'connect', solidId, 'field', brightId, 'image');
    await harness(page, 'connect', brightId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'createGroup', [solidId, brightId], 'MyGroup');
    await harness(page, 'waitForRenderIdle');

    await harness(page, 'undo');
    await harness(page, 'waitForRenderIdle');

    const stateAfterUndo = (await harness(page, 'getState')) as {
      nodeCount: number; nodeTypes: Record<string, string>;
    };
    expect(stateAfterUndo.nodeCount).toBe(3);
    const nodeTypes = Object.values(stateAfterUndo.nodeTypes);
    expect(nodeTypes).toContain('solid_color');
    expect(nodeTypes).toContain('brightness_contrast');
    expect(nodeTypes).toContain('viewer');
  });

  test('creating group preserves viewer rendering', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const solidId = (await harness(page, 'addNode', 'solid_color', { x: 100, y: 100 })) as string;
    const brightId = (await harness(page, 'addNode', 'brightness_contrast', { x: 300, y: 100 })) as string;
    const viewerId = (await harness(page, 'addNode', 'viewer', { x: 500, y: 100 })) as string;

    await harness(page, 'connect', solidId, 'field', brightId, 'image');
    await harness(page, 'connect', brightId, 'image', viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const resultBefore = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(resultBefore).not.toBeNull();
    expect(resultBefore?.hasPixels).toBe(true);

    await harness(page, 'createGroup', [solidId, brightId]);
    await harness(page, 'waitForRenderIdle');

    const resultAfter = (await harness(page, 'getViewerResult', viewerId)) as {
      hasPixels: boolean; width: number; height: number;
    } | null;
    expect(resultAfter).not.toBeNull();
    expect(resultAfter?.hasPixels).toBe(true);
  });
});
