// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const PNG_HEADER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('WasmEngine method bindings', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('calls optional batch methods on the engine instance', async () => {
    class MockEngine {
      __wbg_ptr = 1;

      async init_gpu(): Promise<void> {}

      add_node(typeId: string): { id: string; typeId: string } {
        if (!this.__wbg_ptr) throw new Error('missing wasm instance');
        return { id: 'batch1', typeId };
      }

      batch_add_image(): void {
        if (!this.__wbg_ptr) throw new Error('missing wasm instance');
      }

      get_batch_image_data(): Uint8Array {
        if (!this.__wbg_ptr) throw new Error('missing wasm instance');
        return Uint8Array.from([1, 2, 3]);
      }

      get_batch_thumbnail(): Uint8Array {
        if (!this.__wbg_ptr) throw new Error('missing wasm instance');
        return PNG_HEADER;
      }
    }

    vi.doMock('../../wasm-pkg/cascade_wasm', () => ({
      default: vi.fn(async () => undefined),
      Engine: MockEngine,
      migrate_document_json: vi.fn((json: string) => json),
      needs_migration_json: vi.fn(() => false),
      types_compatible_standalone: vi.fn(() => true),
    }));

    const { initWasmEngine, WasmEngine } = await import('../wasmEngine');
    await initWasmEngine();
    const bridge = new WasmEngine();
    const batchNode = (await bridge.addNode('load_image_batch', 0, 0)).id;
    await bridge.batchAddImage(batchNode, 'sample.png', Uint8Array.from([9]));

    await expect(bridge.getBatchImageData(batchNode, 0)).resolves.toEqual(Uint8Array.from([1, 2, 3]));
    await expect(bridge.getBatchThumbnail(batchNode, 0, 128)).resolves.toEqual(PNG_HEADER);
  });
});
