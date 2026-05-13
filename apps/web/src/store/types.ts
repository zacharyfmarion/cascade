import type { RuntimeSurface } from '../platform/runtime';
import type { DslSourceMap } from '../ai/dsl/types';

export type ValueType = 'Image' | 'Mask' | 'Float' | 'Int' | 'Bool' | 'Color' | 'Field' | 'String' | 'Any';

export interface ColorStop {
  position: number;
  color: [number, number, number, number];
}

export interface CurvePoint {
  x: number;
  y: number;
}

export type UiHint =
  | { type: 'Slider' }
  | { type: 'NumberInput' }
  | { type: 'Checkbox' }
  | { type: 'ColorPicker' }
  | { type: 'ColorRamp' }
  | { type: 'ColorPalette' }
  | { type: 'Dropdown'; data: string[] }
  | { type: 'FilePicker' }
  | { type: 'Hidden' }
  | { type: 'TextArea' }
  | { type: 'CurveEditor' };

export interface ParamSpec {
  key: string;
  label: string;
  ty: ValueType;
  default: ParamDefault;
  min?: number;
  max?: number;
  step?: number;
  ui_hint: UiHint;
  promotable: boolean;
}

export type ParamDefault =
  | { Float: number }
  | { Int: number }
  | { Bool: boolean }
  | { Color: [number, number, number, number] }
  | { ColorRamp: ColorStop[] }
  | { ColorPalette: [number, number, number, number][] }
  | { CurvePoints: CurvePoint[] }
  | { String: string };

export interface PortSpec {
  name: string;
  label: string;
  ty: ValueType;
  default?: ParamDefault;
  min?: number;
  max?: number;
  step?: number;
  ui_hint?: UiHint;
}

export interface NodeSpec {
  id: string;
  display_name: string;
  category: string;
  description: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  params: ParamSpec[];
  supported_surfaces?: RuntimeSurface[];
}

export type ParamValue =
  | { Float: number }
  | { Int: number }
  | { Bool: boolean }
  | { Color: [number, number, number, number] }
  | { ColorRamp: ColorStop[] }
  | { ColorPalette: [number, number, number, number][] }
  | { CurvePoints: CurvePoint[] }
  | { String: string };

// Helper to extract value from ParamValue (since it's an object like { Float: 1.0 })
export const extractParamValue = (pv: ParamValue): number | boolean | [number, number, number, number] | ColorStop[] | CurvePoint[] | [number, number, number, number][] | string => {
  if ('Float' in pv) return pv.Float;
  if ('Int' in pv) return pv.Int;
  if ('Bool' in pv) return pv.Bool;
  if ('Color' in pv) return pv.Color;
  if ('ColorRamp' in pv) return pv.ColorRamp;
  if ('ColorPalette' in pv) return pv.ColorPalette;
  if ('CurvePoints' in pv) return pv.CurvePoints;
  if ('String' in pv) return pv.String;
  return 0;
};

const CONNECTABLE_HINTS = ['Slider', 'NumberInput', 'Checkbox', 'ColorPicker', 'TextArea'];
const CONNECTABLE_TYPES: ValueType[] = ['Float', 'Int', 'Bool', 'Color', 'String'];

export const isConnectableParam = (p: ParamSpec): boolean =>
  p.promotable && CONNECTABLE_TYPES.includes(p.ty) && CONNECTABLE_HINTS.includes(p.ui_hint.type);

export const createParamValue = (type: ValueType | string, value: unknown): ParamValue => {
  if (type === 'Float') return { Float: Number(value) };
  if (type === 'Int') return { Int: Math.round(Number(value)) };
  if (type === 'Bool') return { Bool: Boolean(value) };
  if (type === 'Color') return { Color: value as [number, number, number, number] };
  return { String: String(value) };
};

// Graph state types
export interface NodeInstance {
  id: string;
  typeId: string;
  params: Record<string, ParamValue>;
  inputDefaults: Record<string, ParamValue>;
  position: { x: number; y: number };
  muted: boolean;
  dslHandle?: string;
}

export type DslShadowStatus = 'valid' | 'stale' | 'invalid';

export interface DslShadowHandleEntry {
  nodeId: string;
  handle: string;
}

export interface DslShadowCustomDefinitionName {
  runtimeId: string;
  name: string;
}

export interface DslShadowDocument {
  version: 1;
  text: string;
  graphHash: string;
  graphRevision: number;
  handles: DslShadowHandleEntry[];
  customDefinitionNames: DslShadowCustomDefinitionName[];
  status: DslShadowStatus;
  sourceMap?: DslSourceMap;
}

export interface Connection {
  id: string;
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
}

export interface SerializableInternalNode {
  id: string;
  type_id: string;
  params?: Record<string, ParamValue>;
  input_defaults?: Record<string, ParamValue>;
  position?: [number, number] | { x: number; y: number };
  muted?: boolean;
}

export interface SerializableInternalConnection {
  from_node: string;
  from_port: string;
  to_node: string;
  to_port: string;
}

export interface SerializablePromotion {
  group_param_key: string;
  internal_node_id: string;
  internal_param_key: string;
  spec: ParamSpec;
}

export interface SerializableGroupDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  internal_graph: {
    nodes: SerializableInternalNode[];
    connections: SerializableInternalConnection[];
  };
  promotions?: SerializablePromotion[];
  is_builtin?: boolean;
  explicit_inputs?: PortSpec[] | null;
  explicit_outputs?: PortSpec[] | null;
}

export type ViewerDomainFields = {
  displayWindowX?: number;
  displayWindowY?: number;
  dataWindowX?: number;
  dataWindowY?: number;
  dataWindowWidth?: number;
  dataWindowHeight?: number;
};

type PixelViewerResult<T extends 'image' | 'mask' | 'field'> = ViewerDomainFields & {
  type: T;
  nodeId: string;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  previewScale?: number;
  originalWidth?: number;
  originalHeight?: number;
  bufferWidth?: number;
  bufferHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
  frame?: number;
  generation?: number;
};

type CompareViewerResult = ViewerDomainFields & {
  type: 'compare';
  nodeId: string;
  width: number;
  height: number;
  beforePixels: Uint8ClampedArray;
  afterPixels: Uint8ClampedArray;
  previewScale?: number;
  originalWidth?: number;
  originalHeight?: number;
  bufferWidth?: number;
  bufferHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
  frame?: number;
  generation?: number;
};

// Render result from engine — discriminated union over all value types
export type ViewerResult =
  | PixelViewerResult<'image'>
  | PixelViewerResult<'mask'>
  | PixelViewerResult<'field'>
  | CompareViewerResult
  | { type: 'float'; nodeId: string; value: number; frame?: number; generation?: number }
  | { type: 'int'; nodeId: string; value: number; frame?: number; generation?: number }
  | { type: 'bool'; nodeId: string; value: boolean; frame?: number; generation?: number }
  | { type: 'color'; nodeId: string; value: [number, number, number, number]; frame?: number; generation?: number }
  | { type: 'string'; nodeId: string; value: string; frame?: number; generation?: number }
  | { type: 'none'; nodeId: string; frame?: number; generation?: number };

/** Type guard: does the result carry pixel data? */
export const isPixelResult = (r: ViewerResult): r is Extract<ViewerResult, { pixels: Uint8ClampedArray }> =>
  r.type === 'image' || r.type === 'mask' || r.type === 'field';

export const isCompareResult = (r: ViewerResult): r is Extract<ViewerResult, { type: 'compare' }> =>
  r.type === 'compare';

export const getViewerBufferWidth = (r: ViewerResult): number => (
  (isPixelResult(r) || isCompareResult(r)) ? r.bufferWidth ?? r.width : 0
);

export const getViewerBufferHeight = (r: ViewerResult): number => (
  (isPixelResult(r) || isCompareResult(r)) ? r.bufferHeight ?? r.height : 0
);

export const getViewerDisplayWidth = (r: ViewerResult): number => (
  (isPixelResult(r) || isCompareResult(r)) ? r.displayWidth ?? r.originalWidth ?? r.width : 0
);

export const getViewerDisplayHeight = (r: ViewerResult): number => (
  (isPixelResult(r) || isCompareResult(r)) ? r.displayHeight ?? r.originalHeight ?? r.height : 0
);

export const getViewerDisplayWindowX = (r: ViewerResult): number => (
  (isPixelResult(r) || isCompareResult(r)) ? r.displayWindowX ?? 0 : 0
);

export const getViewerDisplayWindowY = (r: ViewerResult): number => (
  (isPixelResult(r) || isCompareResult(r)) ? r.displayWindowY ?? 0 : 0
);

export const getViewerDataWindowX = (r: ViewerResult): number => (
  (isPixelResult(r) || isCompareResult(r)) ? r.dataWindowX ?? getViewerDisplayWindowX(r) : 0
);

export const getViewerDataWindowY = (r: ViewerResult): number => (
  (isPixelResult(r) || isCompareResult(r)) ? r.dataWindowY ?? getViewerDisplayWindowY(r) : 0
);

export const getViewerDataWindowWidth = (r: ViewerResult): number => (
  (isPixelResult(r) || isCompareResult(r)) ? r.dataWindowWidth ?? getViewerBufferWidth(r) : 0
);

export const getViewerDataWindowHeight = (r: ViewerResult): number => (
  (isPixelResult(r) || isCompareResult(r)) ? r.dataWindowHeight ?? getViewerBufferHeight(r) : 0
);

export type ViewerDataWindowRect = { x: number; y: number; width: number; height: number };

export const getViewerLogicalDataWindowRect = (r: ViewerResult): ViewerDataWindowRect => {
  if (!isPixelResult(r) && !isCompareResult(r)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const previewScale = typeof r.previewScale === 'number' && Number.isFinite(r.previewScale) && r.previewScale > 0
    ? r.previewScale
    : 1;
  const displayWindowX = getViewerDisplayWindowX(r);
  const displayWindowY = getViewerDisplayWindowY(r);
  const dataWindowX = r.dataWindowX ?? displayWindowX * previewScale;
  const dataWindowY = r.dataWindowY ?? displayWindowY * previewScale;
  return {
    x: (dataWindowX - displayWindowX * previewScale) / previewScale,
    y: (dataWindowY - displayWindowY * previewScale) / previewScale,
    width: getViewerDataWindowWidth(r) / previewScale,
    height: getViewerDataWindowHeight(r) / previewScale,
  };
};

/** @deprecated Use ViewerResult instead */
export type RenderResult = Extract<ViewerResult, { type: 'image' }>;

export interface CreateGroupResult {
  groupDefinitionId: string;
  groupNodeId: string;
  removedNodeIds: string[];
  newSpec: NodeSpec;
}

export interface UngroupResult {
  restoredNodes: RestoredNode[];
  removedGroupNodeId: string;
}

export interface RestoredNode {
  id: string;
  typeId: string;
  position: { x: number; y: number };
  params: Record<string, ParamValue>;
  inputDefaults: Record<string, ParamValue>;
}

export interface GroupInternalGraph {
  groupDefId: string;
  name: string;
  nodes: InternalGraphNode[];
  connections: Connection[];
  inputs: PortSpec[];
  outputs: PortSpec[];
}

export interface InternalGraphNode {
  id: string;
  typeId: string;
  position: { x: number; y: number };
  params: Record<string, ParamValue>;
  inputDefaults: Record<string, ParamValue>;
  muted?: boolean;
}

export interface EditingContext {
  id: string;
  label: string;
  groupNodeId?: string | null;
  groupDefId?: string;
  savedNodes?: Map<string, NodeInstance>;
  savedConnections?: Connection[];
  savedNodeSpecs?: NodeSpec[];
}

export interface Frame {
  id: string;
  label: string;
  color: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
}

// ─── Edit Transaction types ──────────────────────────────────────

export type TransactionOrigin = 'ui' | 'dsl' | 'ai';

export interface TransactionOptions {
  origin: TransactionOrigin;
  awaitRender?: boolean;   // default: false
  suppressUndo?: boolean;  // default: false
}

export interface DiagnosticItem {
  message: string;
  severity: 'error' | 'warning' | 'info';
  line?: number;
  nodeId?: string;
  nodeType?: string;
  handle?: string;
  paramKey?: string;
}

export interface TransactionDiagnostics {
  parseErrors: DiagnosticItem[];
  validationErrors: DiagnosticItem[];
  mutationErrors: DiagnosticItem[];
  evalErrors: DiagnosticItem[];
}

export interface TransactionResult {
  success: boolean;
  diagnostics: TransactionDiagnostics;
  graphRevision: number;
}

// Custom node package types
export interface CustomNodeInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  node_count: number;
  file_path: string;
}
