import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { waitForApp, harness } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureDir = path.join(__dirname, 'fixtures');

/**
 * Load an EXR or PNG fixture file into a LoadImage node via the test harness.
 * Returns the raw file bytes as a number array to pass through page.evaluate.
 */
function readFixture(name: string): number[] {
  const filePath = path.join(fixtureDir, name);
  const buf = fs.readFileSync(filePath);
  return Array.from(buf);
}

test.describe('EXR file loading', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
  });

  test('single-layer EXR renders through viewer', async ({ page }) => {
    const nodeId = await harness(page, 'addNode', 'load_image');
    const viewerId = await harness(page, 'addNode', 'viewer');
    await harness(page, 'connect', nodeId, 'image', viewerId, 'value');

    const bytes = readFixture('test_single.exr');
    await harness(page, 'loadImageFile', nodeId, bytes, 'test_single.exr');
    await harness(page, 'waitForRenderIdle');

    const result = await harness(page, 'getViewerResult', viewerId);
    expect(result).not.toBeNull();
    expect(result?.hasPixels).toBe(true);
    expect(result?.width).toBeGreaterThan(0);
    expect(result?.height).toBeGreaterThan(0);
  });

  test('multi-layer EXR creates dynamic output ports', async ({ page }) => {
    const nodeId = await harness(page, 'addNode', 'load_image');

    const bytes = readFixture('test_multilayer.exr');
    await harness(page, 'loadImageFile', nodeId, bytes, 'test_multilayer.exr');
    await harness(page, 'waitForRenderIdle');

    const spec = await harness(page, 'getNodeSpec', nodeId);
    expect(spec).not.toBeNull();

    // Multi-layer EXR should have more than just the default "image" output
    const outputNames = spec!.outputs.map(
      (o: { name: string; value_type: string }) => o.name,
    );
    expect(outputNames).toContain('image');
    // The fixture has layers BG (primary → "image") and BG.Depth (mask → dynamic port)
    expect(outputNames.length).toBeGreaterThan(1);
  });

  test('multi-layer EXR primary layer renders through viewer', async ({
    page,
  }) => {
    const nodeId = await harness(page, 'addNode', 'load_image');
    const viewerId = await harness(page, 'addNode', 'viewer');
    await harness(page, 'connect', nodeId, 'image', viewerId, 'value');

    const bytes = readFixture('test_multilayer.exr');
    await harness(page, 'loadImageFile', nodeId, bytes, 'test_multilayer.exr');
    await harness(page, 'waitForRenderIdle');

    const result = await harness(page, 'getViewerResult', viewerId);
    expect(result).not.toBeNull();
    expect(result?.hasPixels).toBe(true);
    expect(result?.width).toBe(4);
    expect(result?.height).toBe(4);
  });

  test('no eval errors on multi-layer EXR', async ({ page }) => {
    const nodeId = await harness(page, 'addNode', 'load_image');
    const viewerId = await harness(page, 'addNode', 'viewer');
    await harness(page, 'connect', nodeId, 'image', viewerId, 'value');

    const bytes = readFixture('test_multilayer.exr');
    await harness(page, 'loadImageFile', nodeId, bytes, 'test_multilayer.exr');
    await harness(page, 'waitForRenderIdle');

    const errors = await harness(page, 'getNodeErrors');
    // Should have no errors for any node involved in the EXR pipeline
    const nodeError = errors?.[nodeId];
    const viewerError = errors?.[viewerId];
    expect(nodeError).toBeUndefined();
    expect(viewerError).toBeUndefined();
  });

  test('replacing EXR with PNG removes dynamic ports', async ({ page }) => {
    const nodeId = await harness(page, 'addNode', 'load_image');

    // First load multi-layer EXR
    const exrBytes = readFixture('test_multilayer.exr');
    await harness(page, 'loadImageFile', nodeId, exrBytes, 'test_multilayer.exr');
    await harness(page, 'waitForRenderIdle');

    // Verify dynamic ports exist
    let spec = await harness(page, 'getNodeSpec', nodeId);
    expect(spec).not.toBeNull();
    const exrOutputCount = spec!.outputs.length;
    expect(exrOutputCount).toBeGreaterThan(1);

    // Now load a PNG — dynamic ports should be removed
    const pngBytes = readFixture('test_white.png');
    await harness(page, 'loadImageFile', nodeId, pngBytes, 'test.png');
    await harness(page, 'waitForRenderIdle');

    // Dynamic ports should be gone — only default "image" output
    spec = await harness(page, 'getNodeSpec', nodeId);
    expect(spec).not.toBeNull();
    const pngOutputNames = spec!.outputs.map(
      (o: { name: string; value_type: string }) => o.name,
    );
    expect(pngOutputNames).toContain('image');
    expect(pngOutputNames.length).toBe(1);
  });

  test('multi-layer EXR mask layer renders through viewer', async ({
    page,
  }) => {
    const nodeId = await harness(page, 'addNode', 'load_image');
    const viewerId = await harness(page, 'addNode', 'viewer');

    const bytes = readFixture('test_multilayer.exr');
    await harness(page, 'loadImageFile', nodeId, bytes, 'test_multilayer.exr');
    await harness(page, 'waitForRenderIdle');

    // Find the depth/mask layer output port
    const spec = await harness(page, 'getNodeSpec', nodeId);
    expect(spec).not.toBeNull();
    const maskPort = spec!.outputs.find(
      (o: { name: string; value_type: string }) =>
        o.name !== 'image',
    );
    expect(maskPort).toBeDefined();

    // Connect mask output to viewer
    await harness(page, 'connect', nodeId, maskPort!.name, viewerId, 'value');
    await harness(page, 'waitForRenderIdle');

    const result = await harness(page, 'getViewerResult', viewerId);
    expect(result).not.toBeNull();
    expect(result?.hasPixels).toBe(true);
  });
});
