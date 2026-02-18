import type { NodeSpec, ParamValue, PortSpec, RenderResult, CreateGroupResult, UngroupResult, GroupInternalGraph } from '../store/types';

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

export interface AddNodeResult {
  id: string;
  typeId: string;
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
  loadSequenceFrameData?(nodeId: string, frame: number, data: Uint8Array): Promise<void> | void;
  setSequenceInfo?(nodeId: string, info: SequenceInfo): Promise<void> | void;
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
  getColorManagementInfo?(): Promise<ColorManagementInfo> | ColorManagementInfo;
  getViewsForDisplay?(display: string): Promise<string[]> | string[];
  setDisplayView?(display: string, view: string): Promise<void> | void;
  setProjectFormat?(width: number, height: number): Promise<void> | void;
}
