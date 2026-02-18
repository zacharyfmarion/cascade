export type ValueType = 'Image' | 'Mask' | 'Float' | 'Int' | 'Bool' | 'Color' | 'Field';

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

export const createParamValue = (type: ValueType | string, value: any): ParamValue => {
  if (type === 'Float') return { Float: Number(value) };
  if (type === 'Int') return { Int: Math.round(Number(value)) };
  if (type === 'Bool') return { Bool: Boolean(value) };
  if (type === 'Color') return { Color: value };
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
}

export interface Connection {
  id: string;
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
}

// Render result from engine
export interface RenderResult {
  nodeId: string;
  width: number;
  height: number;
  pixels: Uint8ClampedArray; // RGBA8 sRGB
  previewScale?: number;
}

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
  nodes: { id: string; typeId: string; position: { x: number; y: number }; params: Record<string, ParamValue>; inputDefaults: Record<string, ParamValue> }[];
  connections: Connection[];
  inputs: PortSpec[];
  outputs: PortSpec[];
}

export interface EditingContext {
  id: string;
  label: string;
  groupNodeId?: string;
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
