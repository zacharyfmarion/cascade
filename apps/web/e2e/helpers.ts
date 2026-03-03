import type { Page } from '@playwright/test';

export interface CompositorTestHarness {
  waitForEngine(): Promise<void>;
  addNode(type: string, position?: { x: number; y: number }): Promise<string>;
  connect(from: string, fromPort: string, to: string, toPort: string): Promise<void>;
  disconnect(toNode: string, toPort: string): Promise<void>;
  setParam(nodeId: string, param: string, value: unknown): Promise<void>;
  waitForRenderIdle(): Promise<void>;
  getViewerResult(
    viewerId: string,
  ): Promise<{ hasPixels: boolean; width: number; height: number; type?: string } | null>;
  getNodeErrors(): Promise<Record<string, unknown>>;
  getNodeSpecs(): Promise<Array<{ id: string }>>;
  exportImage(nodeId: string): Promise<void>;
  getState(): Promise<Record<string, unknown>>;
  editTransaction(actions: Array<{ action: string; args: unknown[] }>): Promise<void>;
  createGroup(nodeIds: string[], name?: string): Promise<void>;
  getEditingStack(): Promise<unknown[]>;
  enterGroup(groupNodeId: string): Promise<void>;
  exitGroup(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  newProject(): Promise<void>;
  removeNode(nodeId: string): Promise<void>;
  exportGraph(): Promise<unknown>;
  setInputDefault(nodeId: string, portName: string, value: unknown): Promise<void>;
  saveProject(): Promise<unknown>;
  loadProject(project: unknown): Promise<void>;
  selectNode(nodeId: string | null): Promise<void>;
  getSelectedNodes(): Promise<string[]>;
  setSelectedNodes(nodeIds: string[]): Promise<void>;
  toggleMuteSelected(): Promise<void>;
  setCurrentFrame(frame: number): Promise<void>;
  stepForward(): Promise<void>;
  stepBackward(): Promise<void>;
  togglePlayback(): Promise<void>;
  setFps(fps: number): Promise<void>;
  setLoopPlayback(loopPlayback: boolean): Promise<void>;
}

export interface HarnessWindow extends Window {
  __compositorTest: CompositorTestHarness;
}

export async function waitForApp(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30_000 });
  await page.waitForFunction(() => !!(window as unknown as HarnessWindow).__compositorTest, {
    timeout: 10_000,
  });
  await page.evaluate(() => (window as unknown as HarnessWindow).__compositorTest.waitForEngine());
}

export async function harness(
  page: Page,
  method: keyof CompositorTestHarness,
  ...args: unknown[]
): Promise<unknown> {
  return page.evaluate(
    ({ method, args }) => {
      const h = (window as unknown as HarnessWindow).__compositorTest;
      const fn = h[method];
      if (typeof fn !== 'function') throw new Error(`Harness method ${String(method)} not found`);
      return fn.apply(h, args);
    },
    { method, args },
  );
}
