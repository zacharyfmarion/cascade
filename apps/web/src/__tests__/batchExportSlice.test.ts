import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEngine, resetNodeCounter } from './engineMock';

if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true });
}

const saveMock = vi.fn();

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: saveMock,
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
  if (enabled) {
    (window as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as Record<string, unknown>).__TAURI_INTERNALS__;
  }
};

beforeEach(async () => {
  vi.resetModules();
  setTauriMode(false);
  saveMock.mockReset();

  mockExportImageToPath = vi.fn().mockResolvedValue(undefined);
  mockEngine = createMockEngine();
  mockEngine.exportImageToPath = mockExportImageToPath;

  const mod = await import('../store/graphStore');
  useGraphStore = mod.useGraphStore;
  resetNodeCounter();
  await useGraphStore.getState().initEngine();
});

const addExportImageNode = async (formatIdx = 0) => {
  const id = await useGraphStore.getState().addNode('export_image', { x: 0, y: 0 });
  useGraphStore.getState().setParam(id, 'format', { Int: formatIdx });
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

    let capturedAnchor: HTMLAnchorElement | null = null;
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        capturedAnchor = el as HTMLAnchorElement;
        Object.defineProperty(el, 'click', { value: vi.fn(), writable: true });
      }
      return el;
    });

    const id = await addExportImageNode(0);
    useGraphStore.getState().exportImage(id);
    await flushPromises();

    expect(capturedAnchor?.download).toBe('export.png');
    vi.restoreAllMocks();
  });

  it('sets download attribute to .jpg for format 1', async () => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    URL.revokeObjectURL = vi.fn();

    let capturedAnchor: HTMLAnchorElement | null = null;
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        capturedAnchor = el as HTMLAnchorElement;
        Object.defineProperty(el, 'click', { value: vi.fn(), writable: true });
      }
      return el;
    });

    const id = await addExportImageNode(1);
    useGraphStore.getState().exportImage(id);
    await flushPromises();

    expect(capturedAnchor?.download).toBe('export.jpg');
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
    saveMock.mockResolvedValue('/tmp/export.png');

    const id = await addExportImageNode(0);
    useGraphStore.getState().exportImage(id);
    await flushPromises();

    expect(saveMock).toHaveBeenCalledOnce();
    const saveArgs = saveMock.mock.calls[0][0];
    expect(saveArgs.filters[0].extensions).toContain('png');
    expect(mockExportImageToPath).toHaveBeenCalledWith(id, 0, '/tmp/export.png');
  });

  it('uses .jpg extension for format 1', async () => {
    saveMock.mockResolvedValue('/tmp/export.jpg');

    const id = await addExportImageNode(1);
    useGraphStore.getState().exportImage(id);
    await flushPromises();

    const saveArgs = saveMock.mock.calls[0][0];
    expect(saveArgs.filters[0].extensions).toContain('jpg');
    expect(mockExportImageToPath).toHaveBeenCalledWith(id, 0, '/tmp/export.jpg');
  });

  it('does NOT call exportImageToPath when dialog is cancelled (null)', async () => {
    saveMock.mockResolvedValue(null);

    const id = await addExportImageNode(0);
    useGraphStore.getState().exportImage(id);
    await flushPromises();

    expect(saveMock).toHaveBeenCalledOnce();
    expect(mockExportImageToPath).not.toHaveBeenCalled();
    expect(useGraphStore.getState().lastError).toBeNull();
  });

  it('sets lastError when exportImageToPath rejects', async () => {
    saveMock.mockResolvedValue('/tmp/export.png');
    mockExportImageToPath.mockRejectedValue(new Error('disk full'));

    const id = await addExportImageNode(0);
    useGraphStore.getState().exportImage(id);
    await flushPromises(5);

    expect(useGraphStore.getState().lastError).not.toBeNull();
  });
});
