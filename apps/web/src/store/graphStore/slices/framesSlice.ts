import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { Frame, NodeInstance } from '../../types';
import { DEFAULT_FRAME_COLOR } from '../kernel';

export interface FramesSliceState {
  frames: Map<string, Frame>;
  selectedFrameId: string | null;
}

export interface FramesSliceActions {
  addFrame: (position: { x: number; y: number }, size?: { width: number; height: number }, label?: string) => string;
  removeFrame: (id: string) => void;
  updateFrame: (id: string, updates: Partial<Omit<Frame, 'id'>>) => void;
  selectFrame: (id: string | null) => void;
  frameSelectedNodes: (nodeSizes?: Map<string, { width: number; height: number }>) => string | null;
}

export type FramesSlice = FramesSliceState & FramesSliceActions;

export const createFramesSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  FramesSlice
> = (set, get) => ({
  frames: new Map(),
  selectedFrameId: null,

  addFrame: (position, size, label) => {
    void get().pushUndo();
    const id = crypto.randomUUID();
    const frames = new Map(get().frames);
    const maxZ = frames.size > 0 ? Math.max(...Array.from(frames.values()).map(frame => frame.zIndex)) : 0;
    frames.set(id, {
      id,
      label: label ?? 'Frame',
      color: DEFAULT_FRAME_COLOR,
      position,
      size: size ?? { width: 400, height: 300 },
      zIndex: maxZ + 1,
    });
    set({ frames, dirty: true });
    return id;
  },

  removeFrame: (id) => {
    void get().pushUndo();
    const frames = new Map(get().frames);
    frames.delete(id);
    const selectedFrameId = get().selectedFrameId === id ? null : get().selectedFrameId;
    set({ frames, selectedFrameId, dirty: true });
  },

  updateFrame: (id, updates) => {
    const frames = new Map(get().frames);
    const existing = frames.get(id);
    if (!existing) return;
    frames.set(id, { ...existing, ...updates, id });
    set({ frames, dirty: true });
  },

  selectFrame: (id) => {
    set({ selectedFrameId: id, selectedNodeIds: id ? new Set() : get().selectedNodeIds });
  },

  frameSelectedNodes: (nodeSizes) => {
    const { selectedNodeIds, nodes } = get();
    if (selectedNodeIds.size === 0) return null;

    const selectedNodes = Array.from(selectedNodeIds)
      .map(nodeId => nodes.get(nodeId))
      .filter((node): node is NodeInstance => !!node);

    if (selectedNodes.length === 0) return null;

    const PADDING = 40;
    const HEADER_HEIGHT = 30;
    const DEFAULT_W = 200;
    const DEFAULT_H = 100;
    const minX = Math.min(...selectedNodes.map(node => node.position.x)) - PADDING;
    const minY = Math.min(...selectedNodes.map(node => node.position.y)) - PADDING - HEADER_HEIGHT;
    const maxX = Math.max(...selectedNodes.map(node => {
      const sz = nodeSizes?.get(node.id);
      return node.position.x + (sz?.width ?? DEFAULT_W);
    })) + PADDING;
    const maxY = Math.max(...selectedNodes.map(node => {
      const sz = nodeSizes?.get(node.id);
      return node.position.y + (sz?.height ?? DEFAULT_H);
    })) + PADDING;

    void get().pushUndo();
    const id = crypto.randomUUID();
    const frames = new Map(get().frames);
    const maxZ = frames.size > 0 ? Math.max(...Array.from(frames.values()).map(frame => frame.zIndex)) : 0;
    frames.set(id, {
      id,
      label: 'Frame',
      color: DEFAULT_FRAME_COLOR,
      position: { x: minX, y: minY },
      size: { width: maxX - minX, height: maxY - minY },
      zIndex: maxZ + 1,
    });
    set({ frames, dirty: true });
    return id;
  },
});
