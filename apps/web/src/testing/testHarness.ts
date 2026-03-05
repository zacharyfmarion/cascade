/**
 * E2E Test Harness — exposes store actions via window.__cascadeTest
 * for Playwright integration tests.
 *
 * This module is ONLY loaded in development/test mode.
 * It provides a stable, programmatic API for driving the app
 * without fragile UI interactions (dragging ports, etc.).
 */
import { useGraphStore, getEngine } from '../store/graphStore';
import type { NodeSpec, ParamValue } from '../store/types';

export interface CascadeTestHarness {
  /** Wait for the WASM engine to be fully initialized */
  waitForEngine(): Promise<void>;

  // --- Node CRUD ---
  addNode(typeId: string, position?: { x: number; y: number }): Promise<string>;
  removeNode(nodeId: string): Promise<void>;

  // --- Connections ---
  connect(fromNode: string, fromPort: string, toNode: string, toPort: string): Promise<void>;
  disconnect(toNode: string, toPort: string): Promise<void>;

  // --- Params ---
  setParam(nodeId: string, paramKey: string, value: ParamValue): void;
  setParamLive(nodeId: string, paramKey: string, value: ParamValue): void;
  setParamCommit(nodeId: string, paramKey: string, value: ParamValue): void;
  setInputDefault(nodeId: string, portName: string, value: ParamValue): void;

  // --- Selection ---
  selectNode(nodeId: string | null): void;
  setSelectedNodes(nodeIds: string[]): void;
  getSelectedNodes(): string[];
  toggleMuteSelected(): void;

  // --- Position ---
  setPosition(nodeId: string, position: { x: number; y: number }): void;

  // --- Playback ---
  setCurrentFrame(frame: number): void;
  stepForward(): void;
  stepBackward(): void;

  // --- Groups ---
  createGroup(nodeIds: string[], name?: string): Promise<void>;
  enterGroup(groupNodeId: string): Promise<void>;
  exitGroup(): void;
  getEditingStack(): Array<{ id: string; label: string }>;

  // --- Playback (extended) ---
  togglePlayback(): void;
  setFps(fps: number): void;
  setLoopPlayback(loop: boolean): void;

  // --- Save/Load ---
  saveProject(): unknown;
  loadProject(data: unknown): Promise<void>;

  // --- Export ---
  exportImage(nodeId: string): Promise<void>;

  // --- State queries ---
  getState(): {
    engineReady: boolean;
    nodeCount: number;
    connectionCount: number;
    nodeIds: string[];
    nodeTypes: Record<string, string>;
    currentFrame: number;
    dirty: boolean;
    canUndo: boolean;
    canRedo: boolean;
    isPlaying: boolean;
    fps: number;
    loopPlayback: boolean;
    editingStackDepth: number;
    selectedNodeIds: string[];
    connections: Array<{
      fromNode: string;
      fromPort: string;
      toNode: string;
      toPort: string;
    }>;
  };
  getNodeSpecs(): Array<{ id: string; displayName: string; category: string }>;
  getViewerResult(viewerNodeId: string): {
    type: string;
    hasPixels: boolean;
    width?: number;
    height?: number;
  } | null;
  getNodeErrors(): Record<string, string>;
  getNodeSpec(nodeId: string): {
    id: string;
    inputs: Array<{ name: string; value_type: string }>;
    outputs: Array<{ name: string; value_type: string }>;
  } | null;

  // --- Viewer display controls ---
  getViewerDisplayState(): { channel: string | null; gain: number; gamma: number } | null;
  getPixelInspectorValue(): { x: number; y: number; r: number; g: number; b: number; a: number } | null;

  // --- Rendering ---
  waitForRenderIdle(): Promise<void>;

  // --- Undo/Redo ---
  undo(): void;
  redo(): void;

  // --- Project ---
  newProject(): void;
  exportGraph(): unknown;
  importGraph(data: unknown): Promise<void>;

  // --- Transactions ---
  editTransaction(mutations: Array<{ action: string; args: unknown[] }>): void;

  // --- Image loading ---
  loadImageFile(nodeId: string, data: number[], fileName?: string): Promise<void>;
}

function createTestHarness(): CascadeTestHarness {
  return {
    waitForEngine(): Promise<void> {
      return new Promise((resolve) => {
        const check = () => {
          if (useGraphStore.getState().engineReady) {
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });
    },

    async addNode(
      typeId: string,
      position: { x: number; y: number } = { x: 0, y: 0 },
    ): Promise<string> {
      return useGraphStore.getState().addNode(typeId, position);
    },

    async connect(
      fromNode: string,
      fromPort: string,
      toNode: string,
      toPort: string,
    ): Promise<void> {
      await useGraphStore.getState().connect(fromNode, fromPort, toNode, toPort);
    },

    async disconnect(toNode: string, toPort: string): Promise<void> {
      const store = useGraphStore.getState();
      const conn = store.connections.find(c => c.toNode === toNode && c.toPort === toPort);
      if (conn) {
        await store.disconnect(conn.id);
      }
    },

    setParam(nodeId: string, paramKey: string, value: ParamValue): void {
      useGraphStore.getState().setParam(nodeId, paramKey, value);
    },
    getState() {
      const s = useGraphStore.getState();
      const nodeTypes: Record<string, string> = {};
      for (const [id, node] of s.nodes) {
        nodeTypes[id] = node.typeId;
      }
      return {
        engineReady: s.engineReady,
        nodeCount: s.nodes.size,
        connectionCount: s.connections.length,
        nodeIds: [...s.nodes.keys()],
        nodeTypes,
        currentFrame: s.currentFrame,
        dirty: s.dirty,
        canUndo: s.canUndo,
        canRedo: s.canRedo,
        isPlaying: s.isPlaying,
        fps: s.fps,
        loopPlayback: s.loopPlayback,
        editingStackDepth: s.editingStack.length,
        selectedNodeIds: [...s.selectedNodeIds],
        connections: s.connections.map((c) => ({
          fromNode: c.fromNode,
          fromPort: c.fromPort,
          toNode: c.toNode,
          toPort: c.toPort,
        })),
      };
    },

    getNodeSpecs() {
      return useGraphStore.getState().nodeSpecs.map((spec) => ({
        id: spec.id,
        displayName: spec.display_name,
        category: spec.category,
      }));
    },

    getViewerResult(viewerNodeId: string) {
      const result = useGraphStore.getState().renderResults.get(viewerNodeId);
      if (!result) return null;

      if ('pixels' in result && result.pixels) {
        return {
          type: 'image',
          hasPixels: true,
          width: result.width,
          height: result.height,
        };
      }

      return {
        type: result.type ?? 'unknown',
        hasPixels: false,
      };
    },

    waitForRenderIdle(): Promise<void> {
      // Give time for render lock chain to settle
      return new Promise((resolve) => setTimeout(resolve, 500));
    },

    undo(): void {
      useGraphStore.getState().undo();
    },

    redo(): void {
      useGraphStore.getState().redo();
    },

    newProject(): void {
      useGraphStore.getState().newProject();
    },

    // --- New methods ---

    async removeNode(nodeId: string): Promise<void> {
      await useGraphStore.getState().removeNode(nodeId);
    },

    setParamLive(nodeId: string, paramKey: string, value: ParamValue): void {
      useGraphStore.getState().setParamLive(nodeId, paramKey, value);
    },

    setParamCommit(nodeId: string, paramKey: string, value: ParamValue): void {
      useGraphStore.getState().setParamCommit(nodeId, paramKey, value);
    },

    setInputDefault(nodeId: string, portName: string, value: ParamValue): void {
      useGraphStore.getState().setInputDefault(nodeId, portName, value);
    },

    selectNode(nodeId: string | null): void {
      useGraphStore.getState().selectNode(nodeId);
    },

    setSelectedNodes(nodeIds: string[]): void {
      useGraphStore.getState().setSelectedNodes(nodeIds);
    },

    getSelectedNodes(): string[] {
      return [...useGraphStore.getState().selectedNodeIds];
    },

    toggleMuteSelected(): void {
      useGraphStore.getState().toggleMuteSelected();
    },

    setPosition(nodeId: string, position: { x: number; y: number }): void {
      useGraphStore.getState().setPosition(nodeId, position);
    },

    setCurrentFrame(frame: number): void {
      useGraphStore.getState().setCurrentFrame(frame);
    },

    stepForward(): void {
      useGraphStore.getState().stepForward();
    },

    stepBackward(): void {
      useGraphStore.getState().stepBackward();
    },

    getNodeErrors(): Record<string, string> {
      const errors: Record<string, string> = {};
      for (const [id, err] of useGraphStore.getState().nodeErrors) {
        errors[id] = err.message ?? String(err);
      }
      return errors;
    },

    exportGraph(): unknown {
      try {
        return getEngine().exportGraph();
      } catch {
        return null;
      }
    },

    async importGraph(data: unknown): Promise<void> {
      try {
        const graphData = typeof data === 'string' ? data : JSON.stringify(data);
        await getEngine().importGraph(graphData);
      } catch {
        // Engine not initialized or import failed
      }
    },

    editTransaction(mutations: Array<{ action: string; args: unknown[] }>): void {
      useGraphStore.getState().editTransaction({ origin: 'ui' }, () => {
        const s = useGraphStore.getState();
        for (const { action, args } of mutations) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fn = (s as any)[action];
          if (typeof fn === 'function') {
            fn.apply(s, args);
          }
        }
      });
    },

    // --- Groups ---
    async createGroup(nodeIds: string[], name?: string): Promise<void> {
      await useGraphStore.getState().createGroup(nodeIds, name);
    },
    async enterGroup(groupNodeId: string): Promise<void> {
      await useGraphStore.getState().enterGroup(groupNodeId);
    },
    exitGroup(): void {
      const s = useGraphStore.getState();
      if (s.editingStack.length > 1) {
        s.navigateToBreadcrumb(0);
      }
    },
    getEditingStack(): Array<{ id: string; label: string }> {
      return useGraphStore.getState().editingStack.map((e) => ({
        id: e.id,
        label: e.label,
      }));
    },

    // --- Playback (extended) ---
    togglePlayback(): void {
      useGraphStore.getState().togglePlayback();
    },
    setFps(fps: number): void {
      useGraphStore.getState().setFps(fps);
    },
    setLoopPlayback(loop: boolean): void {
      useGraphStore.getState().setLoopPlayback(loop);
    },

    // --- Save/Load ---
    saveProject(): unknown {
      // Delegate to our exportGraph method that accesses the engine bridge directly
      return this.exportGraph();
    },
    async loadProject(data: unknown): Promise<void> {
      // Create a synthetic File and use the store's loadProject to ensure
      // all migrations, state syncing, and applyGraphData happen correctly.
      const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
      const file = new File([jsonStr], 'test-project.json', { type: 'application/json' });
      useGraphStore.getState().loadProject(file);
      // loadProject reads file async — wait a tick for state to settle
      await new Promise(resolve => setTimeout(resolve, 200));
    },

    // --- Export ---
    async exportImage(nodeId: string): Promise<void> {
      await useGraphStore.getState().exportImage(nodeId);
    },

    // --- Image loading ---
    async loadImageFile(nodeId: string, data: number[], fileName?: string): Promise<void> {
      const bytes = new Uint8Array(data);
      const file = new File([bytes], fileName ?? 'test.png', { type: 'image/png' });
      useGraphStore.getState().loadImageFile(nodeId, file);
      // loadImageFile reads the file async — wait for it to settle
      await new Promise(resolve => setTimeout(resolve, 200));
    },

    // --- Viewer display controls ---
    getViewerDisplayState(): { channel: string | null; gain: number; gamma: number } | null {
      const viewer = document.querySelector('[data-testid="viewer-panel"]');
      if (!viewer) return null;
      const channel = viewer.getAttribute('data-viewer-channel') || null;
      const gain = parseFloat(viewer.getAttribute('data-viewer-gain') ?? '1');
      const gamma = parseFloat(viewer.getAttribute('data-viewer-gamma') ?? '1');
      return { channel: channel || null, gain, gamma };
    },

    getPixelInspectorValue(): { x: number; y: number; r: number; g: number; b: number; a: number } | null {
      const el = document.querySelector('[data-testid="pixel-inspector"]');
      if (!el) return null;
      const raw = el.getAttribute('data-pixel-info');
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },

    getNodeSpec(nodeId: string): {
      id: string;
      inputs: Array<{ name: string; value_type: string }>;
      outputs: Array<{ name: string; value_type: string }>;
    } | null {
      // Try per-instance spec first (dynamic ports), then fall back to engine
      const instanceSpec = useGraphStore.getState().nodeSpecsById.get(nodeId);
      if (instanceSpec) {
        return {
          id: instanceSpec.id,
          inputs: instanceSpec.inputs.map((inp) => ({
            name: inp.name,
            value_type: inp.ty,
          })),
          outputs: instanceSpec.outputs.map((out) => ({
            name: out.name,
            value_type: out.ty,
          })),
        };
      }
      // Fall back to engine bridge
      try {
        const engine = getEngine();
        if (engine.getNodeSpec) {
          const spec = engine.getNodeSpec(nodeId);
          if (spec && typeof spec === 'object' && 'id' in spec) {
            const s = spec as NodeSpec;
            return {
              id: s.id,
              inputs: s.inputs.map((inp) => ({
                name: inp.name,
                value_type: inp.ty,
              })),
              outputs: s.outputs.map((out) => ({
                name: out.name,
                value_type: out.ty,
              })),
            };
          }
        }
      } catch {
        // Engine not available
      }
      return null;
    },
  };
}

/**
 * Install the test harness on the window object.
 * Call this from the app entry point in dev/test mode.
 */
export function installTestHarness(): void {
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__cascadeTest = createTestHarness();
  }
}
