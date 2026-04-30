import { test, expect } from '@playwright/test';
import { harness, waitForApp } from './helpers';

type DslShadowForTest = {
  version: number;
  text: string;
  graphHash: string;
  handles: Array<{ nodeId: string; handle: string }>;
  customDefinitionNames: Array<{ runtimeId: string; name: string }>;
  status: string;
};

const toPersistedDsl = (shadow: DslShadowForTest) => ({
  version: shadow.version,
  text: shadow.text,
  graph_hash: shadow.graphHash,
  handles: shadow.handles.map(entry => ({ node_id: entry.nodeId, handle: entry.handle })),
  custom_definition_names: shadow.customDefinitionNames.map(entry => ({
    runtime_id: entry.runtimeId,
    name: entry.name,
  })),
});

const expectDslApplySuccess = (result: { success: boolean; errors?: Array<{ message: string }> }) => {
  expect(result.errors, JSON.stringify(result.errors ?? [], null, 2)).toBeUndefined();
  expect(result.success).toBe(true);
};

test.describe('DSL editor production flows', () => {
  test('root DSL edits apply graph changes and invalid DSL leaves graph intact', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const valid = [
      'graph {',
      '  load1 = LoadImage()',
      '  viewer1 = Viewer()',
      '',
      '  load1.image -> viewer1.value',
      '}',
    ].join('\n');
    const applied = await harness(page, 'applyDslText', valid) as { success: boolean; errors?: Array<{ message: string }> };
    expectDslApplySuccess(applied);

    const stateAfterApply = await harness(page, 'getState') as {
      nodeCount: number;
      connectionCount: number;
      nodeTypes: Record<string, string>;
    };
    expect(stateAfterApply.nodeCount).toBe(2);
    expect(stateAfterApply.connectionCount).toBe(1);
    expect(Object.values(stateAfterApply.nodeTypes)).toContain('load_image');

    const invalid = await harness(page, 'applyDslText', 'graph {\n  blur1 = GaussianBlur(amount 5.0)\n}') as {
      success: boolean;
      errors?: Array<{ message: string }>;
    };
    expect(invalid.success).toBe(false);
    expect(invalid.errors?.[0]?.message).toContain('Invalid param syntax');

    const stateAfterInvalid = await harness(page, 'getState') as { nodeCount: number; connectionCount: number };
    expect(stateAfterInvalid.nodeCount).toBe(stateAfterApply.nodeCount);
    expect(stateAfterInvalid.connectionCount).toBe(stateAfterApply.connectionCount);
  });

  test('GPU script DSL edits update the node definition and shadow text', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await harness(page, 'addNode', 'gpu_script', { x: 100, y: 100 });
    const initialDsl = await harness(page, 'getDslText') as string;
    expect(initialDsl).toContain('node GpuNode1 = gpu');

    const editedDsl = initialDsl.replace('return color;', 'return vec4(color.rgb * 0.5, color.a);');
    const result = await harness(page, 'applyDslText', editedDsl) as { success: boolean; errors?: Array<{ message: string }> };
    expectDslApplySuccess(result);

    const nextDsl = await harness(page, 'getDslText') as string;
    expect(nextDsl).toContain('return vec4(color.rgb * 0.5, color.a);');
    expect(nextDsl).toContain('gpu1 = GpuNode1()');
  });

  test('group rename syncs to DSL definition and root instance syntax', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const blurId = await harness(page, 'addNode', 'gaussian_blur', { x: 100, y: 100 }) as string;
    const groupId = await harness(page, 'createGroup', [blurId], 'Node Group') as string;
    expect(groupId).toBeTruthy();

    await harness(page, 'renameGroup', groupId, 'Curves Group');
    const dsl = await harness(page, 'getDslText') as string;
    expect(dsl).toContain('node CurvesGroup = group {');
    expect(dsl).toContain('curves_group1 = CurvesGroup()');
    expect(dsl).not.toContain('node NodeGroup = group');
  });

  test('save/load preserves DSL shadow comments and edited GPU code', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await harness(page, 'addNode', 'gpu_script', { x: 100, y: 100 });
    const initialDsl = await harness(page, 'getDslText') as string;
    const editedDsl = initialDsl
      .replace('node GpuNode1 = gpu {', '# shader note\nnode GpuNode1 = gpu {')
      .replace('return color;', 'return vec4(color.rgb * 0.25, color.a);');
    const applied = await harness(page, 'applyDslText', editedDsl) as { success: boolean; errors?: Array<{ message: string }> };
    expectDslApplySuccess(applied);

    const graph = await harness(page, 'exportGraph');
    expect(JSON.stringify(graph)).toContain('__script_manifest');
    const shadow = await harness(page, 'getDslShadow') as DslShadowForTest;
    expect(shadow.status).toBe('valid');
    const document = {
      cascade: { format_version: '1.3.0', app_version: '', created_at: '', modified_at: '' },
      project: { name: 'DSL E2E', author: '', description: '' },
      graph,
      assets: {},
      scripts: {},
      dsl: toPersistedDsl(shadow),
    };

    await harness(page, 'newProject');
    await harness(page, 'loadProject', document);
    const loadedShadow = await harness(page, 'getDslShadow') as DslShadowForTest | null;
    expect(loadedShadow?.text).toContain('# shader note');
    expect(loadedShadow?.status).toBe('valid');
    const loadedDsl = await harness(page, 'getDslText') as string;
    expect(loadedDsl).toContain('# shader note');
    expect(loadedDsl).toContain('return vec4(color.rgb * 0.25, color.a);');
  });
});
