export type {
  NodeSpec,
  ParamValue,
  ParamSpec,
  PortSpec,
  NodeInstance,
  Connection,
  RenderResult,
  ValueType,
  ParamDefault,
  ColorStop,
  CurvePoint,
} from '../store/types';

export interface GraphSnapshot {
  nodes: GraphSnapshotNode[];
  connections: GraphSnapshotConnection[];
  viewerNodes: string[];
  renderDimensions?: { width: number; height: number };
}

export interface GraphSnapshotNode {
  id: string;
  typeId: string;
  displayName: string;
  category: string;
  params: Record<string, unknown>;
  inputDefaults: Record<string, unknown>;
  muted: boolean;
  connectedInputs: Record<string, { fromNode: string; fromPort: string }>;
}

export interface GraphSnapshotConnection {
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
}
