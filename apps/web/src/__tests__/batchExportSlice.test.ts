import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEngine, resetNodeCounter } from './engineMock';

if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true });
}

const dialogMocks = vi.hoisted(() => ({
  save: vi.fn(),
  open: vi.fn(),
}));
const runtimeMocks = vi.hoisted(() => ({
  isDesktop: false,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: dialogMocks.save,
  open: dialogMocks.open,
}));

vi.mock('../platform/runtime', () => ({
  getRuntimeSurface: () => runtimeMocks.isDesktop ? 'desktop' : 'web',
  isDesktopRuntime: () => runtimeMocks.isDesktop,
  isWebRuntime: () => !runtimeMocks.isDesktop,
}));

let mockEngine = createMockEngine();
let mockExportImageToPath: ReturnType<typeof vi.fn>;

vi.mock('../engine/wasmEngine', () => ({
  initWasmEngine: vi.fn(),
  get wasmEngine() { return mockEngine; },
}));

type GraphStore = typeof import('../store/graphStore')['useGraphStore'];
let useGraphStore: GraphStore;

const flushPromises = async (ticks = 3) => {
  for (let i = 0; i < ticks; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

const setTauriMode = (enabled: boolean) => {
  runtimeMocks.isDesktop = enabled;
  if (enabled) {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  }
};

beforeEach(async () => {
  vi.resetModules();
  setTauriMode(false);
  dialogMocks.save.mockReset();
  dialogMocks.open.mockReset();

  mockExportImageToPath = vi.fn().mockResolvedValue(undefined);
  mockEngine = createMockEngine();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockEngine.exportImageToPath = mockExportImageToPath as any;

  const mod = await import('../store/graphStore');
  useGraphStore = mod.useGraphStore;
  resetNodeCounter();
  await useGraphStore.getState().initEngine();
});

const addExportImageNode = async (formatIdx = 0, outputPath = '') => {
  const id = await useGraphStore.getState().addNode('export_image', { x: 0, y: 0 });
  useGraphStore.getState().setParam(id, 'format', { Int: formatIdx });
  if (outputPath) {
    useGraphStore.getState().setParam(id, 'output_path', { String: outputPath });
  }
  return id;
};

// ───────────────────────────────────────────────
// Web path
// ───────────────────────────────────────────────

describe('exportImage — web path (isTauri = false)', () => {
  it('calls engine.exportImage and triggers browser download via anchor click', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    const revokeObjectURL = vi.fn();
    const clickMock = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: clickMock, writable: true });
      }
      return el;
    });

    const id = await addExportImageNode(0);
    useGraphStore.getState().exportImage(id);
    await flushPromises();

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickMock).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(mockExportImageToPath).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('sets download attribute to .png for format 0', async () => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    URL.revokeObjectURL = vi.fn();

    const downloads: string[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: vi.fn(), writable: true });
        Object.defineProperty(el, 'download', {
          get() { return downloads[0] ?? ''; },
          set(v: string) { downloads[0] = v; },
          configurable: true,
        });
      }
      return el;
    });

    const id = await addExportImageNode(0);
    useGraphStore.getState().exportImage(id);
    await flushPromises();

    expect(downloads[0]).toBe('export.png');
    vi.restoreAllMocks();
  });

  it('sets download attribute to .jpg for format 1', async () => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    URL.revokeObjectURL = vi.fn();

    const downloads: string[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: vi.fn(), writable: true });
        Object.defineProperty(el, 'download', {
          get() { return downloads[0] ?? ''; },
          set(v: string) { downloads[0] = v; },
          configurable: true,
        });
      }
      return el;
    });

    const id = await addExportImageNode(1);
    useGraphStore.getState().exportImage(id);
    await flushPromises();

    expect(downloads[0]).toBe('export.jpg');
    vi.restoreAllMocks();
  });
});

// ───────────────────────────────────────────────
// Tauri path
// ───────────────────────────────────────────────

describe('exportImage — Tauri path (isTauri = true)', () => {
  beforeEach(() => {
    setTauriMode(true);
  });

  afterEach(() => {
    setTauriMode(false);
  });

  it('opens save dialog with correct extension and calls exportImageToPath', async () => {
    dialogMocks.save.mockResolvedValue('/tmp/export.png');

    const id = await addExportImageNode(0);
    useGraphStore.getState().exportImage(id);
    await flushPromises();

    expect(dialogMocks.save).toHaveBeenCalledOnce();
    const saveArgs = dialogMocks.save.mock.calls[0][0];
    expect(saveArgs.filters[0].extensions).toContain('png');
    expect(mockExportImageToPath).toHaveBeenCalledWith(id, 0, '/tmp/export.png');
  });

  it('uses .jpg extension for format 1', async () => {
    dialogMocks.save.mockResolvedValue('/tmp/export.jpg');

    const id = await addExportImageNode(1);
    useGraphStore.getState().exportImage(id);
    await flushPromises();

    const saveArgs = dialogMocks.save.mock.calls[0][0];
    expect(saveArgs.filters[0].extensions).toContain('jpg');
    expect(mockExportImageToPath).toHaveBeenCalledWith(id, 0, '/tmp/export.jpg');
  });

  it('does NOT call exportImageToPath when dialog is cancelled (null)', async () => {
    dialogMocks.save.mockResolvedValue(null);

    const id = await addExportImageNode(0);
    useGraphStore.getState().exportImage(id);
    await flushPromises();

    expect(dialogMocks.save).toHaveBeenCalledOnce();
    expect(mockExportImageToPath).not.toHaveBeenCalled();
    expect(useGraphStore.getState().lastError).toBeNull();
  });

  it('sets lastError when exportImageToPath rejects', async () => {
    dialogMocks.save.mockResolvedValue('/tmp/export.png');
    mockExportImageToPath.mockRejectedValue(new Error('disk full'));

    const id = await addExportImageNode(0);
    useGraphStore.getState().exportImage(id);
    await flushPromises(5);

    expect(useGraphStore.getState().lastError).not.toBeNull();
  });
});

describe('exportAllImages — web path (isTauri = false)', () => {
  it('exports every Export Image node into exports.zip', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:exports-url');
    const revokeObjectURL = vi.fn();
    const clickMock = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: clickMock, writable: true });
      }
      return el;
    });

    const exportImage = vi.fn()
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
      .mockResolvedValueOnce(new Uint8Array([4, 5, 6]));
    mockEngine.exportImage = exportImage;

    const first = await addExportImageNode(0, 'square.png');
    const second = await addExportImageNode(1, 'portrait.jpg');

    await useGraphStore.getState().exportAllImages();

    expect(exportImage).toHaveBeenCalledWith(first, 0);
    expect(exportImage).toHaveBeenCalledWith(second, 0);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickMock).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(useGraphStore.getState().renderProgress?.completed).toBe(true);

    vi.restoreAllMocks();
  });
});

describe('exportAllImages — Tauri path (isTauri = true)', () => {
  beforeEach(() => {
    setTauriMode(true);
  });

  afterEach(() => {
    setTauriMode(false);
  });

  it('prompts for an output directory and writes every export node', async () => {
    dialogMocks.open.mockResolvedValue('/tmp/exports');

    const first = await addExportImageNode(0, 'square.png');
    const second = await addExportImageNode(1);

    await useGraphStore.getState().exportAllImages();

    expect(dialogMocks.open).toHaveBeenCalledWith(expect.objectContaining({
      directory: true,
      multiple: false,
    }));
    expect(mockExportImageToPath).toHaveBeenCalledWith(first, 0, '/tmp/exports/square.png');
    expect(mockExportImageToPath).toHaveBeenCalledWith(second, 0, '/tmp/exports/export_2.jpg');
    expect(useGraphStore.getState().renderProgress?.completed).toBe(true);
  });

  it('does not export when directory selection is cancelled', async () => {
    dialogMocks.open.mockResolvedValue(null);

    await addExportImageNode(0, 'square.png');
    await useGraphStore.getState().exportAllImages();

    expect(mockExportImageToPath).not.toHaveBeenCalled();
    expect(useGraphStore.getState().lastError).toBeNull();
  });
});
