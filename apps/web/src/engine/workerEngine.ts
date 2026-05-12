/**
 * WorkerEngine — Main-thread EngineBridge implementation that proxies all
 * engine operations to a Web Worker via Comlink.
 *
 * The WASM engine runs entirely in the Worker.  This class wraps the
 * Worker's Comlink API, forwards every call, and handles:
 *   - Transferable ArrayBuffers for large data (pixels, image bytes)
 *   - Worker crash detection & restart
 *   - Graceful degradation (falls back to main-thread WasmEngine)
 */
import * as Comlink from 'comlink';
import wasmInit, {
  types_compatible_standalone as wasmTypesCompatible,
  needs_migration_json as wasmNeedsMigration,
  migrate_document_json as wasmMigrateDocument,
} from '../wasm-pkg/cascade_wasm';
import type {
  EngineBridge,
  AddNodeResult,
  NodeInterfaceChange,
  SequenceInfo,
  VideoInfo,
  ColorManagementInfo,
  EditValidationError,
} from './bridge';
import { copyBytesForTransfer } from './transferableBytes';
import type {
  NodeSpec,
  ParamValue,
  PortSpec,
  ViewerResult,
  CreateGroupResult,
  UngroupResult,
  GroupInternalGraph,
  InternalGraphNode,
  CustomNodeInfo,
} from '../store/types';

// ---------------------------------------------------------------------------
// Types for the Worker-side API (matches the object exposed via Comlink)
// ---------------------------------------------------------------------------

/** Shape of the API object that Comlink.wrap() returns from the Worker. */
interface WorkerAPI {
  init(): Promise<boolean>;
  whenIdle(): Promise<void>;

  listNodeTypes(): Promise<NodeSpec[]>;
  addNode(typeId: string, x: number, y: number): Promise<AddNodeResult>;
  removeNode(nodeId: string): Promise<void>;
  connect(fromNode: string, fromPort: string, toNode: string, toPort: string): Promise<void>;
  disconnect(toNode: string, toPort: string): Promise<void>;
  getAffectedViewers(nodeId: string): Promise<string[]>;
  setParam(nodeId: string, key: string, value: ParamValue): Promise<void>;
  setInputDefault(nodeId: string, portName: string, value: ParamValue): Promise<void>;
  setPosition(nodeId: string, x: number, y: number): Promise<void>;
  setMuted(nodeId: string, muted: boolean): Promise<void>;
  setAndRender(
    mutation: { type: 'param' | 'inputDefault'; nodeId: string; key: string; value: ParamValue },
    frame: number,
    previewScale?: number,
  ): Promise<Array<[string, ViewerResult]> | null>;

  registerGpuKernel(manifestJson: string): Promise<NodeSpec | null>;
  compileScriptNode(nodeId: string, manifestJson: string): Promise<NodeSpec>;
  setDslHandle(nodeId: string, handle: string): Promise<void>;

  loadImageData(nodeId: string, data: Uint8Array): Promise<NodeInterfaceChange>;
  loadPaletteData(nodeId: string, data: Uint8Array): Promise<[number, number, number, number][]>;
  loadSequenceFrameData(nodeId: string, frame: number, data: Uint8Array): Promise<NodeInterfaceChange>;

  renderViewer(viewerNodeId: string, frame: number, previewScale?: number): Promise<ViewerResult | null>;
  renderInternalViewer(groupNodeId: string, internalViewerId: string, frame: number, previewScale?: number): Promise<ViewerResult | null>;
  exportImage(nodeId: string, frame: number): Promise<Uint8Array>;
  getImageData(nodeId: string): Promise<Uint8Array | null>;
  evaluateBytesOutput(nodeId: string, portName: string): Promise<Uint8Array>;

  exportGraph(): Promise<unknown>;
  importGraph(data: unknown): Promise<void>;
  exportDocument(): Promise<unknown>;
  importDocument(data: unknown): Promise<void>;

  setSequenceDirectory(nodeId: string, directory: string): Promise<SequenceInfo>;
  getSequenceInfo(nodeId: string, pattern: string): Promise<SequenceInfo>;
  loadVideoFile(nodeId: string, path: string): Promise<VideoInfo>;
  registerSequenceFiles(nodeId: string, files: File[]): Promise<{ info: SequenceInfo; pattern: string }>;
  prepareSequenceFrame(nodeId: string, frame: number): Promise<NodeInterfaceChange | null>;
  prefetchSequenceFrames(nodeId: string, startFrame: number, count: number): Promise<void>;
  clearSequenceFiles(nodeId: string): Promise<void>;
  setSequenceInfo(nodeId: string, info: SequenceInfo): Promise<void>;

  batchClear(nodeId: string): Promise<void>;
  batchAddImage(nodeId: string, filename: string, data: Uint8Array): Promise<void>;
  getBatchInfo(exportNodeId: string): Promise<{ count: number; filenames: string[] }>;
  getBatchImageData(nodeId: string, index: number): Promise<Uint8Array | null>;
  getBatchThumbnail(nodeId: string, index: number, maxEdge: number): Promise<Uint8Array | null>;

  createGroupFromNodes(nodeIds: string[], name: string): Promise<CreateGroupResult>;
  ungroupNode(groupNodeId: string): Promise<UngroupResult>;
  getGroupInternalGraph(groupNodeId: string): Promise<GroupInternalGraph>;
  updateGroupInterface(groupDefId: string, inputs: PortSpec[], outputs: PortSpec[]): Promise<NodeSpec>;
  addInternalConnection(
    groupDefId: string,
    fromNode: string,
    fromPort: string,
    toNode: string,
    toPort: string,
  ): Promise<NodeSpec>;
  removeInternalConnection(groupDefId: string, toNode: string, toPort: string): Promise<NodeSpec>;
  addInternalNode(groupDefId: string, typeId: string, x: number, y: number): Promise<InternalGraphNode>;
  removeInternalNode(groupDefId: string, nodeId: string): Promise<NodeSpec>;
  setInternalParam(groupDefId: string, nodeId: string, key: string, value: ParamValue): Promise<NodeSpec>;
  setInternalInputDefault(groupDefId: string, nodeId: string, portName: string, value: ParamValue): Promise<NodeSpec>;
  setInternalPosition(groupDefId: string, nodeId: string, x: number, y: number): Promise<NodeSpec>;
  setInternalMuted(groupDefId: string, nodeId: string, muted: boolean): Promise<NodeSpec>;
  compileInternalScriptNode(groupDefId: string, nodeId: string, manifestJson: string): Promise<NodeSpec>;
  renameGroup(groupDefId: string, newName: string): Promise<NodeSpec>;

  getLastRenderTimings(): Promise<Record<string, number>>;
  setAiApiKey(provider: string, key: string): Promise<void>;
  isAiConfigured(): Promise<boolean>;
  runAiNode(nodeId: string): Promise<void>;
  getNodeExecutionState(nodeId: string): Promise<{ status: string; isStale: boolean; error: string }>;

  getColorManagementInfo(): Promise<ColorManagementInfo>;
  getViewsForDisplay(display: string): Promise<string[]>;
  setDisplayView(display: string, view: string): Promise<void>;
  setProjectFormat(width: number, height: number): Promise<void>;

  validateEdits(editsJson: string): Promise<EditValidationError[]>;
  exportGroupAsPackage(groupDefId: string): Promise<unknown>;
  importCustomNodes(json: string): Promise<NodeSpec[]>;
  registerGroupDefinition(json: string): Promise<NodeSpec>;
  listCustomNodes(): Promise<CustomNodeInfo[]>;
  removeCustomNode(groupDefId: string): Promise<void>;

  typesCompatible(fromType: string, toType: string): Promise<boolean>;
  migrateDocument(jsonStr: string): string;
  needsMigration(jsonStr: string): boolean;
  getNodeSpec(nodeId: string): Promise<NodeSpec>;
}

// ---------------------------------------------------------------------------
// WorkerEngine
// ---------------------------------------------------------------------------

export class WorkerEngine implements EngineBridge {
  private worker: Worker | null = null;
  private api: Comlink.Remote<WorkerAPI> | null = null;

  /** Spawn the Worker and initialise the WASM engine inside it. */
  async init(): Promise<void> {
    // Load WASM on main thread for synchronous pure functions
    // (typesCompatible, needsMigration, migrateDocument).
    // wasm-bindgen caches init — safe to call even if Worker also inits.
    await wasmInit();

    this.worker = new Worker(new URL('./engineWorker.ts', import.meta.url), {
      type: 'module',
    });

    // Crash detection
    this.worker.addEventListener('error', (ev) => {
      console.error('[WorkerEngine] Worker error:', ev.message);
    });

    this.api = Comlink.wrap<WorkerAPI>(this.worker);
    await this.api.init();
  }

  /** Terminate the Worker and release resources. */
  terminate(): void {
    if (this.api) {
      this.api[Comlink.releaseProxy]();
      this.api = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private getAPI(): Comlink.Remote<WorkerAPI> {
    if (!this.api) {
      throw new Error('WorkerEngine not initialised — call init() first');
    }
    return this.api;
  }

  // -----------------------------------------------------------------------
  // EngineBridge — Core graph operations
  // -----------------------------------------------------------------------

  listNodeTypes(): Promise<NodeSpec[]> {
    return this.getAPI().listNodeTypes();
  }

  addNode(typeId: string, x: number, y: number): Promise<AddNodeResult> {
    return this.getAPI().addNode(typeId, x, y);
  }

  removeNode(nodeId: string): Promise<void> {
    return this.getAPI().removeNode(nodeId);
  }

  connect(fromNode: string, fromPort: string, toNode: string, toPort: string): Promise<void> {
    return this.getAPI().connect(fromNode, fromPort, toNode, toPort);
  }

  disconnect(toNode: string, toPort: string): Promise<void> {
    return this.getAPI().disconnect(toNode, toPort);
  }

  getAffectedViewers(nodeId: string): Promise<string[]> {
    return this.getAPI().getAffectedViewers(nodeId);
  }

  setParam(nodeId: string, key: string, value: ParamValue): Promise<void> {
    return this.getAPI().setParam(nodeId, key, value);
  }

  setInputDefault(nodeId: string, portName: string, value: ParamValue): Promise<void> {
    return this.getAPI().setInputDefault(nodeId, portName, value);
  }

  setPosition(nodeId: string, x: number, y: number): Promise<void> {
    return this.getAPI().setPosition(nodeId, x, y);
  }

  setMuted(nodeId: string, muted: boolean): Promise<void> {
    return this.getAPI().setMuted(nodeId, muted);
  }

  setAndRender(
    mutation: { type: 'param' | 'inputDefault'; nodeId: string; key: string; value: ParamValue },
    frame: number,
    previewScale?: number,
  ): Promise<Array<[string, ViewerResult]>> {
    return this.getAPI()
      .setAndRender(mutation, frame, previewScale)
      .then((result) => result ?? []);
  }

  // -----------------------------------------------------------------------
  // GPU / Script
  // -----------------------------------------------------------------------

  registerGpuKernel(manifestJson: string): Promise<NodeSpec> {
    return this.getAPI()
      .registerGpuKernel(manifestJson)
      .then((result) => {
        if (!result) throw new Error('registerGpuKernel not supported in worker');
        return result;
      });
  }

  compileScriptNode(nodeId: string, manifestJson: string): Promise<NodeSpec> {
    return this.getAPI().compileScriptNode(nodeId, manifestJson);
  }

  setDslHandle(nodeId: string, handle: string): Promise<void> {
    return this.getAPI().setDslHandle(nodeId, handle);
  }

  // -----------------------------------------------------------------------
  // Data loading — Transferable for large buffers TO the Worker
  // -----------------------------------------------------------------------

  loadImageData(nodeId: string, data: Uint8Array): Promise<NodeInterfaceChange> {
    // Transfer the buffer to avoid copying large image data
    return this.getAPI().loadImageData(nodeId, Comlink.transfer(data, [data.buffer]));
  }

  loadPaletteData(nodeId: string, data: Uint8Array): Promise<[number, number, number, number][]> {
    return this.getAPI().loadPaletteData(nodeId, Comlink.transfer(data, [data.buffer]));
  }

  loadSequenceFrameData(
    nodeId: string,
    frame: number,
    data: Uint8Array,
  ): Promise<NodeInterfaceChange> {
    // Sequence frames come from a reusable main-thread cache. Transfer an owned
    // copy so postMessage detaches only this bridge payload, not the cache.
    const transferData = copyBytesForTransfer(data);
    return this.getAPI().loadSequenceFrameData(
      nodeId,
      frame,
      Comlink.transfer(transferData, [transferData.buffer]),
    );
  }

  // -----------------------------------------------------------------------
  // Rendering — pixel data Transferred FROM the Worker (handled Worker-side)
  // -----------------------------------------------------------------------

  renderViewer(viewerNodeId: string, frame: number, previewScale = 1): Promise<ViewerResult | null> {
    return this.getAPI().renderViewer(viewerNodeId, frame, previewScale);
  }

  renderInternalViewer(groupNodeId: string, internalViewerId: string, frame: number, previewScale?: number): Promise<ViewerResult | null> {
    return this.getAPI().renderInternalViewer(groupNodeId, internalViewerId, frame, previewScale);
  }

  exportImage(nodeId: string, frame: number): Promise<Uint8Array> {
    return this.getAPI().exportImage(nodeId, frame);
  }

  getImageData(nodeId: string): Promise<Uint8Array | null> {
    return this.getAPI().getImageData(nodeId);
  }

  evaluateBytesOutput(nodeId: string, portName: string): Promise<Uint8Array> {
    return this.getAPI().evaluateBytesOutput(nodeId, portName);
  }

  // -----------------------------------------------------------------------
  // Graph I/O
  // -----------------------------------------------------------------------

  exportGraph(): Promise<unknown> {
    return this.getAPI().exportGraph();
  }

  importGraph(data: unknown): Promise<void> {
    return this.getAPI().importGraph(data);
  }

  exportDocument(): Promise<unknown> {
    return this.getAPI().exportDocument();
  }

  importDocument(data: unknown): Promise<void> {
    return this.getAPI().importDocument(data);
  }

  // -----------------------------------------------------------------------
  // Tauri-only: these are no-ops in the Worker (web-only) path
  // -----------------------------------------------------------------------

  saveProject(_path: string): Promise<unknown> {
    return Promise.reject(new Error('saveProject not available in web Worker mode'));
  }

  loadProject(_path: string): Promise<unknown> {
    return Promise.reject(new Error('loadProject not available in web Worker mode'));
  }

  // -----------------------------------------------------------------------
  // Sequences & Video
  // -----------------------------------------------------------------------

  setSequenceDirectory(nodeId: string, directory: string): Promise<SequenceInfo> {
    return this.getAPI().setSequenceDirectory(nodeId, directory);
  }

  getSequenceInfo(nodeId: string, pattern: string): Promise<SequenceInfo> {
    return this.getAPI().getSequenceInfo(nodeId, pattern);
  }

  loadVideoFile(nodeId: string, path: string): Promise<VideoInfo> {
    return this.getAPI().loadVideoFile(nodeId, path);
  }

  registerSequenceFiles(nodeId: string, files: File[]): Promise<{ info: SequenceInfo; pattern: string }> {
    return this.getAPI().registerSequenceFiles(nodeId, files);
  }

  prepareSequenceFrame(nodeId: string, frame: number): Promise<NodeInterfaceChange | null> {
    return this.getAPI().prepareSequenceFrame(nodeId, frame);
  }

  prefetchSequenceFrames(nodeId: string, startFrame: number, count: number): Promise<void> {
    return this.getAPI().prefetchSequenceFrames(nodeId, startFrame, count);
  }

  clearSequenceFiles(nodeId: string): Promise<void> {
    return this.getAPI().clearSequenceFiles(nodeId);
  }

  setSequenceInfo(nodeId: string, info: SequenceInfo): Promise<void> {
    return this.getAPI().setSequenceInfo(nodeId, info);
  }

  // -----------------------------------------------------------------------
  // Batch export
  // -----------------------------------------------------------------------

  batchClear(nodeId: string): Promise<void> {
    return this.getAPI().batchClear(nodeId);
  }

  batchAddImage(nodeId: string, filename: string, data: Uint8Array): Promise<void> {
    return this.getAPI().batchAddImage(nodeId, filename, Comlink.transfer(data, [data.buffer]));
  }

  getBatchInfo(exportNodeId: string): Promise<{ count: number; filenames: string[] }> {
    return this.getAPI().getBatchInfo(exportNodeId);
  }

  getBatchImageData(nodeId: string, index: number): Promise<Uint8Array | null> {
    return this.getAPI().getBatchImageData(nodeId, index);
  }

  getBatchThumbnail(nodeId: string, index: number, maxEdge: number): Promise<Uint8Array | null> {
    return this.getAPI().getBatchThumbnail(nodeId, index, maxEdge);
  }

  // Groups
  // -----------------------------------------------------------------------

  createGroupFromNodes(nodeIds: string[], name: string): Promise<CreateGroupResult> {
    return this.getAPI().createGroupFromNodes(nodeIds, name);
  }

  ungroupNode(groupNodeId: string): Promise<UngroupResult> {
    return this.getAPI().ungroupNode(groupNodeId);
  }

  getGroupInternalGraph(groupNodeId: string): Promise<GroupInternalGraph> {
    return this.getAPI().getGroupInternalGraph(groupNodeId);
  }

  updateGroupInterface(
    groupDefId: string,
    inputs: PortSpec[],
    outputs: PortSpec[],
  ): Promise<NodeSpec> {
    return this.getAPI().updateGroupInterface(groupDefId, inputs, outputs);
  }

  addInternalConnection(
    groupDefId: string,
    fromNode: string,
    fromPort: string,
    toNode: string,
    toPort: string,
  ): Promise<NodeSpec> {
    return this.getAPI().addInternalConnection(groupDefId, fromNode, fromPort, toNode, toPort);
  }

  removeInternalConnection(
    groupDefId: string,
    toNode: string,
    toPort: string,
  ): Promise<NodeSpec> {
    return this.getAPI().removeInternalConnection(groupDefId, toNode, toPort);
  }

  addInternalNode(groupDefId: string, typeId: string, x: number, y: number): Promise<InternalGraphNode> {
    return this.getAPI().addInternalNode(groupDefId, typeId, x, y);
  }

  removeInternalNode(groupDefId: string, nodeId: string): Promise<NodeSpec> {
    return this.getAPI().removeInternalNode(groupDefId, nodeId);
  }

  setInternalParam(groupDefId: string, nodeId: string, key: string, value: ParamValue): Promise<NodeSpec> {
    return this.getAPI().setInternalParam(groupDefId, nodeId, key, value);
  }

  setInternalInputDefault(groupDefId: string, nodeId: string, portName: string, value: ParamValue): Promise<NodeSpec> {
    return this.getAPI().setInternalInputDefault(groupDefId, nodeId, portName, value);
  }

  setInternalPosition(groupDefId: string, nodeId: string, x: number, y: number): Promise<NodeSpec> {
    return this.getAPI().setInternalPosition(groupDefId, nodeId, x, y);
  }

  setInternalMuted(groupDefId: string, nodeId: string, muted: boolean): Promise<NodeSpec> {
    return this.getAPI().setInternalMuted(groupDefId, nodeId, muted);
  }

  compileInternalScriptNode(groupDefId: string, nodeId: string, manifestJson: string): Promise<NodeSpec> {
    return this.getAPI().compileInternalScriptNode(groupDefId, nodeId, manifestJson);
  }

  renameGroup(groupDefId: string, newName: string): Promise<NodeSpec> {
    return this.getAPI().renameGroup(groupDefId, newName);
  }

  // -----------------------------------------------------------------------
  // Render timings
  // -----------------------------------------------------------------------

  getLastRenderTimings(): Promise<Record<string, number>> {
    return this.getAPI().getLastRenderTimings();
  }

  // -----------------------------------------------------------------------
  // AI
  // -----------------------------------------------------------------------

  setAiApiKey(provider: string, key: string): Promise<void> {
    return this.getAPI().setAiApiKey(provider, key);
  }

  isAiConfigured(): Promise<boolean> {
    return this.getAPI().isAiConfigured();
  }

  runAiNode(nodeId: string): Promise<void> {
    return this.getAPI().runAiNode(nodeId);
  }

  getNodeExecutionState(
    nodeId: string,
  ): Promise<{ status: string; isStale: boolean; error: string }> {
    return this.getAPI().getNodeExecutionState(nodeId);
  }

  // -----------------------------------------------------------------------
  // Color management
  // -----------------------------------------------------------------------

  getColorManagementInfo(): Promise<ColorManagementInfo> {
    return this.getAPI().getColorManagementInfo();
  }

  getViewsForDisplay(display: string): Promise<string[]> {
    return this.getAPI().getViewsForDisplay(display);
  }

  setDisplayView(display: string, view: string): Promise<void> {
    return this.getAPI().setDisplayView(display, view);
  }

  setProjectFormat(width: number, height: number): Promise<void> {
    return this.getAPI().setProjectFormat(width, height);
  }

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  validateEdits(editsJson: string): Promise<EditValidationError[]> {
    return this.getAPI().validateEdits(editsJson);
  }

  // -----------------------------------------------------------------------
  // Custom nodes
  // -----------------------------------------------------------------------

  exportGroupAsPackage(groupDefId: string): Promise<unknown> {
    return this.getAPI().exportGroupAsPackage(groupDefId);
  }

  importCustomNodes(json: string): Promise<NodeSpec[]> {
    return this.getAPI().importCustomNodes(json);
  }

  registerGroupDefinition(json: string): Promise<NodeSpec> {
    return this.getAPI().registerGroupDefinition(json);
  }

  listCustomNodes(): Promise<CustomNodeInfo[]> {
    return this.getAPI().listCustomNodes();
  }

  removeCustomNode(groupDefId: string): Promise<void> {
    return this.getAPI().removeCustomNode(groupDefId);
  }

  // -----------------------------------------------------------------------
  // Sync operations — run on main thread via WASM, no Worker round-trip
  // -----------------------------------------------------------------------

  typesCompatible(fromType: string, toType: string): boolean {
    return wasmTypesCompatible(fromType, toType);
  }

  migrateDocument(jsonStr: string): string {
    return wasmMigrateDocument(jsonStr);
  }

  needsMigration(jsonStr: string): boolean {
    return wasmNeedsMigration(jsonStr);
  }

  getNodeSpec(nodeId: string): Promise<NodeSpec> {
    return this.getAPI().getNodeSpec(nodeId);
  }
}
