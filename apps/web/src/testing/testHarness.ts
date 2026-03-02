/**
 * E2E Test Harness — exposes store actions via window.__compositorTest
 * for Playwright integration tests.
 *
 * This module is ONLY loaded in development/test mode.
 * It provides a stable, programmatic API for driving the app
 * without fragile UI interactions (dragging ports, etc.).
 */
import { useGraphStore } from '../store/graphStore';
import type { ParamValue } from '../store/types';

export interface CompositorTestHarness {
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
}

function createTestHarness(): CompositorTestHarness {
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
      const engine = useGraphStore.getState();
      // Use the internal engine bridge to get the serialized graph
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (engine as any)._getEngine?.()?.exportGraph?.() ?? null;
    },

    async importGraph(data: unknown): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const engine = (useGraphStore.getState() as any)._getEngine?.();
      if (engine?.importGraph) {
        engine.importGraph(JSON.stringify(data));
        // Refresh the store state from engine
        // Note: refreshFromEngine is not available — state will be synced on next render
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
  };
}

/**
 * Install the test harness on the window object.
 * Call this from the app entry point in dev/test mode.
 */
export function installTestHarness(): void {
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__compositorTest = createTestHarness();
  }
}
