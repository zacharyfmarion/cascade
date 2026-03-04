import { test, expect } from '@playwright/test';
import { waitForApp } from './helpers';

test.describe('Image drop preview', () => {
  test('dropped image shows thumbnail preview in load_image node', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // The ReactFlow canvas where nodes live
    const canvas = page.locator('.react-flow');

    // Simulate dropping an image file onto the canvas.
    // We use page.evaluate to construct a real DragEvent + File + DataTransfer
    // because Playwright's dispatchEvent doesn't support File/DataTransfer natively.
    await canvas.evaluate(async (el) => {
      // Build a minimal valid PNG in the browser
      // prettier-ignore
      const pngBytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x02,
        0x00, 0x00, 0x00, 0x02,
        0x08, 0x02, 0x00, 0x00, 0x00,
        0x72, 0x73, 0xf4, 0x71,
        0x00, 0x00, 0x00, 0x12,
        0x49, 0x44, 0x41, 0x54,
        0x78, 0x9c, 0x62, 0xf8, 0xcf, 0xc0, 0x00, 0x06,
        0x00, 0x01, 0x86, 0x00, 0xc5, 0x68, 0x80, 0x4c,
        0x31, 0x55,
        0x00, 0x00, 0x00, 0x00,
        0x49, 0x45, 0x4e, 0x44,
        0xae, 0x42, 0x60, 0x82,
      ]);
      const file = new File([pngBytes], 'test-image.png', { type: 'image/png' });

      // Create a DataTransfer with the file
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      // First fire dragover so the canvas recognizes the drag
      const dragOverEvent = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      el.dispatchEvent(dragOverEvent);

      // Then fire the drop event at the center of the canvas
      const rect = el.getBoundingClientRect();
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      });
      el.dispatchEvent(dropEvent);
    });

    // Wait for the load_image node to appear and the thumbnail <img> to render
    // inside it. The node-thumbnail class is applied to the preview image.
    const thumbnailImg = page.locator('.node-thumbnail');
    await expect(thumbnailImg).toBeVisible({ timeout: 10_000 });

    // Verify the image has a valid blob: or data: src (not empty/broken)
    const src = await thumbnailImg.getAttribute('src');
    expect(src).toBeTruthy();
    expect(src!.startsWith('blob:') || src!.startsWith('data:')).toBe(true);
  });
});
