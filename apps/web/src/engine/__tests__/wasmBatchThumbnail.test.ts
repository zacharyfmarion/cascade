// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import init, { Engine } from '../../wasm-pkg/cascade_wasm';

const PNG_4X2 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAE0lEQVR4nGP8z8DwnwEJMDGgAQA/JwIC6pw8sQAAAABJRU5ErkJggg==';

let initPromise: Promise<void> | null = null;

const initWasm = async () => {
  initPromise ??= (async () => {
    const wasmPath = fileURLToPath(new URL('../../wasm-pkg/cascade_wasm_bg.wasm', import.meta.url));
    const wasmBytes = await readFile(wasmPath);
    await init({ module_or_path: wasmBytes });
  })();
  await initPromise;
};

const bytesFromBase64 = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, 'base64'));

describe('WASM batch thumbnails', () => {
  it('returns source thumbnail PNG bytes for web-loaded batches', async () => {
    await initWasm();
    const engine = new Engine();
    try {
      const batchNode = engine.add_node('load_image_batch', 0, 0).id as string;
      engine.batch_add_image(batchNode, 'sample.png', bytesFromBase64(PNG_4X2));

      const thumbnail = engine.get_batch_thumbnail(batchNode, 0, 128);

      expect(Array.from(thumbnail.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(thumbnail.byteLength).toBeGreaterThan(0);
    } finally {
      engine.free();
    }
  });
});
