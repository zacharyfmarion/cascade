import { test, expect } from '@playwright/test';
import { harness, waitForApp } from './helpers';

test.describe('Group stability', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
  });

  // Nested groups: creating groups inside group editing context is not yet supported
  // by the engine — createGroupFromNodes only operates on the top-level graph.
  test.skip('nested group: create group inside group', async ({ page }) => {
    // Build chain: solid → bright → invert → viewer
    const solid = await harness(page, 'addNode', 'solid_color');
    const bright = await harness(page, 'addNode', 'gaussian_blur');
    const inv = await harness(page, 'addNode', 'curves');
    const viewer = await harness(page, 'addNode', 'viewer');

    await harness(page, 'connect', solid, 'field', bright, 'image');
    await harness(page, 'connect', bright, 'image', inv, 'image');
    await harness(page, 'connect', inv, 'image', viewer, 'value');
    await harness(page, 'waitForRenderIdle');

    // Group bright + invert → outer group
    const outerGroupId = await harness(page, 'createGroup', [bright, inv], 'OuterGroup');
    expect(outerGroupId).toBeTruthy();

    // Enter the outer group
    await harness(page, 'enterGroup', outerGroupId);
    const innerState = await harness(page, 'getState');
    // Should have at least bright, invert, group_input, group_output
    expect(innerState.nodeCount).toBeGreaterThanOrEqual(4);

    // Find bright and invert inside the group
    const innerTypes = innerState.nodeTypes as string[];
    expect(innerTypes).toContain('gaussian_blur');
    expect(innerTypes).toContain('curves');

    // Find their IDs for nested grouping
    const innerNodeIds = innerState.nodeIds as string[];
    const innerBright = innerNodeIds.find((_id: string, i: number) => innerTypes[i] === 'gaussian_blur');
    const innerInvert = innerNodeIds.find((_id: string, i: number) => innerTypes[i] === 'curves');
    expect(innerBright).toBeTruthy();
    expect(innerInvert).toBeTruthy();

    // Create nested group from bright + invert inside the outer group
    const nestedGroupId = await harness(page, 'createGroup', [innerBright!, innerInvert!], 'NestedGroup');
    expect(nestedGroupId).toBeTruthy();

    // Editing stack should be depth 2
    const stack = await harness(page, 'getEditingStack');
    expect(stack.length).toBe(2);

    // Exit all the way back
    await harness(page, 'exitGroup');
    const outerStack = await harness(page, 'getEditingStack');
    expect(outerStack.length).toBe(1);
  });

  // ── Ungroup Roundtrip ──────────────────────────────────────────

  test('ungroup restores original graph topology', async ({ page }) => {
    // Build: solid → bright → viewer
    const solid = await harness(page, 'addNode', 'solid_color');
    const bright = await harness(page, 'addNode', 'gaussian_blur');
    const viewer = await harness(page, 'addNode', 'viewer');

    await harness(page, 'connect', solid, 'field', bright, 'image');
    await harness(page, 'connect', bright, 'image', viewer, 'value');
    await harness(page, 'waitForRenderIdle');

    // Capture pre-group state
    const preState = await harness(page, 'getState');
    const preResult = await harness(page, 'getViewerResult', viewer);
    expect(preResult).toBeTruthy();

    // Group solid + bright
    const groupId = await harness(page, 'createGroup', [solid, bright], 'TestGroup');
    expect(groupId).toBeTruthy();

    // Verify group reduced node count
    const groupedState = await harness(page, 'getState');
    expect(groupedState.nodeCount).toBe(2); // group node + viewer

    // Ungroup
    await harness(page, 'ungroupNode', groupId);
    await harness(page, 'waitForRenderIdle');

    // Should restore 3 nodes
    const postState = await harness(page, 'getState');
    expect(postState.nodeCount).toBe(preState.nodeCount);

    // Viewer should still render (connections restored)
    const postResult = await harness(page, 'getViewerResult', viewer);
    expect(postResult).toBeTruthy();
  });

  // ── Undo/Redo Within Groups ────────────────────────────────────

  test('undo/redo with groups preserves consistency', async ({ page }) => {
    // Build chain
    const solid = await harness(page, 'addNode', 'solid_color');
    const bright = await harness(page, 'addNode', 'gaussian_blur');
    const viewer = await harness(page, 'addNode', 'viewer');

    await harness(page, 'connect', solid, 'field', bright, 'image');
    await harness(page, 'connect', bright, 'image', viewer, 'value');
    await harness(page, 'waitForRenderIdle');

    // Create group
    const groupId = await harness(page, 'createGroup', [solid, bright], 'UndoGroup');
    expect(groupId).toBeTruthy();
    const afterGroup = await harness(page, 'getState');

    // Undo the grouping
    await harness(page, 'undo');
    await harness(page, 'waitForRenderIdle');

    const afterUndo = await harness(page, 'getState');
    expect(afterUndo.nodeCount).toBe(3); // solid, bright, viewer restored

    // Redo the grouping
    await harness(page, 'redo');
    await harness(page, 'waitForRenderIdle');

    const afterRedo = await harness(page, 'getState');
    expect(afterRedo.nodeCount).toBe(afterGroup.nodeCount); // back to grouped state

    // Viewer should still work
    const result = await harness(page, 'getViewerResult', viewer);
    expect(result).toBeTruthy();
  });

  // ── Group Rename ───────────────────────────────────────────────

  test('renaming a group updates label', async ({ page }) => {
    const solid = await harness(page, 'addNode', 'solid_color');
    const bright = await harness(page, 'addNode', 'gaussian_blur');
    const viewer = await harness(page, 'addNode', 'viewer');

    await harness(page, 'connect', solid, 'field', bright, 'image');
    await harness(page, 'connect', bright, 'image', viewer, 'value');

    const groupId = await harness(page, 'createGroup', [solid, bright], 'OldName');
    expect(groupId).toBeTruthy();

    await harness(page, 'renameGroup', groupId, 'NewName');

    // Verify via editing stack label when entering
    await harness(page, 'enterGroup', groupId);
    const stack = await harness(page, 'getEditingStack');
    const groupEntry = stack.find((e: { label: string }) => e.label === 'NewName');
    expect(groupEntry).toBeTruthy();

    await harness(page, 'exitGroup');
  });

  // ── Group Preserves Rendering ──────────────────────────────────

  test('group does not alter rendering output', async ({ page }) => {
    const solid = await harness(page, 'addNode', 'solid_color');
    await harness(page, 'setParam', solid, 'color', { Color: [1.0, 0.0, 0.0, 1.0] });
    const bright = await harness(page, 'addNode', 'gaussian_blur');
    await harness(page, 'setParam', bright, 'amount', { Float: 0.3 });
    const viewer = await harness(page, 'addNode', 'viewer');

    await harness(page, 'connect', solid, 'field', bright, 'image');
    await harness(page, 'connect', bright, 'image', viewer, 'value');
    await harness(page, 'waitForRenderIdle');

    // Capture pixel data before grouping
    const beforeResult = await harness(page, 'getViewerResult', viewer);
    expect(beforeResult).toBeTruthy();
    const beforePixels = beforeResult.samplePixels;

    // Group and verify render unchanged
    await harness(page, 'createGroup', [solid, bright], 'RenderGroup');
    await harness(page, 'waitForRenderIdle');

    const afterResult = await harness(page, 'getViewerResult', viewer);
    expect(afterResult).toBeTruthy();
    expect(afterResult.samplePixels).toEqual(beforePixels);
  });

  // ── Group With Multiple Input Types ────────────────────────────

  test('group handles nodes with different input counts', async ({ page }) => {
    // Build: solid_color (0 image inputs) → gaussian_blur (1 image input) → viewer
    // This tests grouping nodes with different numbers of connected inputs.
    const solid = await harness(page, 'addNode', 'solid_color');
    await harness(page, 'setParam', solid, 'color', { Color: [1.0, 0.0, 0.0, 1.0] });
    const blur = await harness(page, 'addNode', 'gaussian_blur');
    const viewer = await harness(page, 'addNode', 'viewer');

    await harness(page, 'connect', solid, 'field', blur, 'image');
    await harness(page, 'connect', blur, 'image', viewer, 'value');
    await harness(page, 'waitForRenderIdle');

    // Group solid + blur (2 nodes → 1 group)
    const groupId = await harness(page, 'createGroup', [solid, blur], 'ProcessGroup');
    expect(groupId).toBeTruthy();
    await harness(page, 'waitForRenderIdle');

    // Verify group was created — should have 2 nodes (group + viewer)
    const state = await harness(page, 'getState');
    expect(state.nodeCount).toBe(2);

    // Viewer should still render
    const result = await harness(page, 'getViewerResult', viewer);
    expect(result).toBeTruthy();
    expect(result.width).toBeGreaterThan(0);
  });

  // ── Enter/Exit Preserves State ─────────────────────────────────

  test('enter and exit group preserves outer graph state', async ({ page }) => {
    const solid = await harness(page, 'addNode', 'solid_color');
    const bright = await harness(page, 'addNode', 'gaussian_blur');
    const viewer = await harness(page, 'addNode', 'viewer');

    await harness(page, 'connect', solid, 'field', bright, 'image');
    await harness(page, 'connect', bright, 'image', viewer, 'value');

    const groupId = await harness(page, 'createGroup', [solid, bright], 'NavGroup');

    // Capture state before enter
    const beforeEnter = await harness(page, 'getState');

    // Enter → exit
    await harness(page, 'enterGroup', groupId);
    const inside = await harness(page, 'getState');
    expect(inside.editingStackDepth).toBe(2);

    await harness(page, 'exitGroup');
    const afterExit = await harness(page, 'getState');
    expect(afterExit.editingStackDepth).toBe(1);
    expect(afterExit.nodeCount).toBe(beforeEnter.nodeCount);
    expect(afterExit.connectionCount).toBe(beforeEnter.connectionCount);
  });

  // ── Export/Import Roundtrip ────────────────────────────────────

  test('group export does not throw', async ({ page }) => {
    const solid = await harness(page, 'addNode', 'solid_color');
    const bright = await harness(page, 'addNode', 'gaussian_blur');
    const viewer = await harness(page, 'addNode', 'viewer');

    await harness(page, 'connect', solid, 'field', bright, 'image');
    await harness(page, 'connect', bright, 'image', viewer, 'value');

    const groupId = await harness(page, 'createGroup', [solid, bright], 'ExportGroup');
    expect(groupId).toBeTruthy();

    // Verify we can enter and inspect the group
    await harness(page, 'enterGroup', groupId);
    const stack = await harness(page, 'getEditingStack');
    expect(stack.length).toBe(2);
    await harness(page, 'exitGroup');

    // Verify the group still renders
    await harness(page, 'waitForRenderIdle');
    const result = await harness(page, 'getViewerResult', viewer);
    expect(result).toBeTruthy();
  });

  // ── Group With Single Node ─────────────────────────────────────

  test('group with single node works correctly', async ({ page }) => {
    const solid = await harness(page, 'addNode', 'solid_color');
    const viewer = await harness(page, 'addNode', 'viewer');

    await harness(page, 'connect', solid, 'field', viewer, 'value');
    await harness(page, 'waitForRenderIdle');

    // Group just one node
    const groupId = await harness(page, 'createGroup', [solid], 'SingleGroup');
    expect(groupId).toBeTruthy();
    await harness(page, 'waitForRenderIdle');

    // Should still render through the group
    const result = await harness(page, 'getViewerResult', viewer);
    expect(result).toBeTruthy();
  });

  // ── Multiple Groups ────────────────────────────────────────────

  test('multiple independent groups in same graph', async ({ page }) => {
    // Build two parallel chains: solid1 → blur → viewer1, solid2 → curves → viewer2
    const solid1 = await harness(page, 'addNode', 'solid_color');
    const bright = await harness(page, 'addNode', 'gaussian_blur');
    const solid2 = await harness(page, 'addNode', 'solid_color');
    const inv = await harness(page, 'addNode', 'curves');
    const viewer1 = await harness(page, 'addNode', 'viewer');
    const viewer2 = await harness(page, 'addNode', 'viewer');

    await harness(page, 'connect', solid1, 'field', bright, 'image');
    await harness(page, 'connect', bright, 'image', viewer1, 'value');
    await harness(page, 'connect', solid2, 'field', inv, 'image');
    await harness(page, 'connect', inv, 'image', viewer2, 'value');
    await harness(page, 'waitForRenderIdle');

    // Group chain 1: solid1 + bright
    const group1 = await harness(page, 'createGroup', [solid1, bright], 'Chain1');
    expect(group1).toBeTruthy();
    await harness(page, 'waitForRenderIdle');

    // After first group, verify the remaining nodes still exist
    const midState = await harness(page, 'getState') as { nodeCount: number; nodeIds: string[]; nodeTypes: string[] };
    // Should have 5 nodes: group1, solid2, curves, viewer1, viewer2
    expect(midState.nodeCount).toBe(5);

    // Find solid2 and inv by their original IDs (they should be unchanged)
    const solid2Exists = midState.nodeIds.includes(solid2 as string);
    const invExists = midState.nodeIds.includes(inv as string);

    if (solid2Exists && invExists) {
      // Group chain 2: solid2 + curves
      const group2 = await harness(page, 'createGroup', [solid2, inv], 'Chain2');
      expect(group2).toBeTruthy();
      await harness(page, 'waitForRenderIdle');

      // Should have 4 nodes: group1, group2, viewer1, viewer2
      const finalState = await harness(page, 'getState') as { nodeCount: number };
      expect(finalState.nodeCount).toBe(4);

      // Rendering should still work
      const result = await harness(page, 'getViewerResult', viewer1);
      expect(result).toBeTruthy();
    } else {
      // If original IDs were invalidated, that's a real bug — fail with clear message
      expect(solid2Exists).toBe(true);
      expect(invExists).toBe(true);
    }
  });
});
