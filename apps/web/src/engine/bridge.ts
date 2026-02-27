import type { NodeSpec, ParamValue, PortSpec, RenderResult, CreateGroupResult, UngroupResult, GroupInternalGraph, CustomNodeInfo } from '../store/types';

export interface ColorSpaceInfo {
  id: string;
  family: string;
}

export interface ColorManagementInfo {
  workingSpace: string;
  activeDisplay: string;
  activeView: string;
  displays: string[];
  colorSpaces: ColorSpaceInfo[];
}

export interface JobProgress {
  job_id: string;
  current_frame: number;
  total_frames: number;
  completed: boolean;
  error: string | null;
}

export interface SequenceInfo {
  frame_count: number;
  first_frame: number;
  last_frame: number;
}

export interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  frame_count: number;
  duration_secs: number;
}

export interface AddNodeResult {
  id: string;
  typeId: string;
}

/** A proposed graph edit operation for dry-run validation via Rust. */
export interface EditOp {
  type: 'addNode' | 'removeNode' | 'connect' | 'disconnect';
  op_id: number;
  type_id?: string;
  node_id?: string;
  from_node?: string;
  from_port?: string;
  to_node?: string;
  to_port?: string;
}

export interface EditErrorKind {
  type: 'TypeMismatch' | 'PortNotFound' | 'NodeNotFound' | 'UnknownNodeType' | 'CycleDetected';
  from_type?: string;
  to_type?: string;
  node_type?: string;
  port_name?: string;
  node_id?: string;
  type_id?: string;
}

export interface EditValidationError {
  op_id: number;
  kind: EditErrorKind;
  message: string;
}

export interface EngineBridge {
  listNodeTypes(): Promise<NodeSpec[]> | NodeSpec[];
  addNode(typeId: string, x: number, y: number): Promise<AddNodeResult> | AddNodeResult;
  removeNode(nodeId: string): Promise<void> | void;
  connect(fromNode: string, fromPort: string, toNode: string, toPort: string): Promise<void> | void;
  disconnect(toNode: string, toPort: string): Promise<void> | void;
  setParam(nodeId: string, key: string, value: ParamValue): Promise<void> | void;
  setInputDefault(nodeId: string, portName: string, value: ParamValue): Promise<void> | void;
  setPosition(nodeId: string, x: number, y: number): Promise<void> | void;
  setMuted(nodeId: string, muted: boolean): Promise<void> | void;
  setParamAndRender?(nodeId: string, key: string, value: ParamValue, frame: number): Promise<Map<string, RenderResult>>;
  registerGpuKernel?(manifestJson: string): Promise<NodeSpec> | NodeSpec;
  compileScriptNode?(nodeId: string, manifestJson: string): Promise<NodeSpec> | NodeSpec;
  loadImageData(nodeId: string, data: Uint8Array): Promise<void> | void;
  loadPaletteData?(nodeId: string, data: Uint8Array): Promise<[number, number, number, number][]> | [number, number, number, number][];
  renderViewer(viewerNodeId: string, frame: number): Promise<RenderResult | null> | RenderResult | null;
  exportGraph(): Promise<unknown> | unknown;
  importGraph(data: unknown): Promise<void> | void;
  exportDocument?(): Promise<unknown> | unknown;
  importDocument?(data: unknown): Promise<void> | void;
  saveProject?(path: string): Promise<void>;
  loadProject?(path: string): Promise<unknown>;
  getImageData?(nodeId: string): Promise<Uint8Array | null> | Uint8Array | null;
  exportImage(nodeId: string, frame: number): Promise<Uint8Array>;
  renderSequence?(nodeId: string): Promise<string>;
  renderVideo?(nodeId: string): Promise<string>;
  cancelJob?(): Promise<void>;
  getJobProgress?(): Promise<JobProgress | null>;
  setSequenceDirectory?(nodeId: string, directory: string): Promise<SequenceInfo>;
  getSequenceInfo?(nodeId: string, pattern: string): Promise<SequenceInfo>;
  loadVideoFile?(nodeId: string, path: string): Promise<VideoInfo>;
  loadSequenceFrameData?(nodeId: string, frame: number, data: Uint8Array): Promise<void> | void;
  setSequenceInfo?(nodeId: string, info: SequenceInfo): Promise<void> | void;
  batchClear?(nodeId: string): Promise<void> | void;
  batchAddImage?(nodeId: string, filename: string, data: Uint8Array): Promise<void> | void;
  getBatchInfo?(exportNodeId: string): Promise<{ count: number; filenames: string[] }> | { count: number; filenames: string[] };
  createGroupFromNodes?(nodeIds: string[], name: string): Promise<CreateGroupResult>;
  ungroupNode?(groupNodeId: string): Promise<UngroupResult>;
  getGroupInternalGraph?(groupNodeId: string): Promise<GroupInternalGraph>;
  updateGroupInterface?(groupDefId: string, inputs: PortSpec[], outputs: PortSpec[]): Promise<NodeSpec>;
  addInternalConnection?(groupDefId: string, fromNode: string, fromPort: string, toNode: string, toPort: string): Promise<NodeSpec>;
  removeInternalConnection?(groupDefId: string, toNode: string, toPort: string): Promise<NodeSpec>;
  renameGroup?(groupDefId: string, newName: string): Promise<NodeSpec>;
  getLastRenderTimings?(): Record<string, number>;
  setAiApiKey?(provider: string, key: string): Promise<void> | void;
  isAiConfigured?(): Promise<boolean> | boolean;
  runAiNode?(nodeId: string): Promise<void>;
  getNodeExecutionState?(nodeId: string): { status: string; isStale: boolean; error: string };
  getColorManagementInfo?(): Promise<ColorManagementInfo> | ColorManagementInfo;
  getViewsForDisplay?(display: string): Promise<string[]> | string[];
  setDisplayView?(display: string, view: string): Promise<void> | void;
  setProjectFormat?(width: number, height: number): Promise<void> | void;
  validateEdits?(editsJson: string): EditValidationError[] | Promise<EditValidationError[]>;
  exportGroupAsPackage?(groupDefId: string): Promise<unknown> | unknown;
  importCustomNodes?(json: string): Promise<NodeSpec[]> | NodeSpec[];
  listCustomNodes?(): Promise<CustomNodeInfo[]>;
  removeCustomNode?(groupDefId: string): Promise<void>;
  typesCompatible?(fromType: string, toType: string): boolean | Promise<boolean>;
}
