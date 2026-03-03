import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';

export interface SelectionSliceState {
  selectedNodeIds: Set<string>;
}

export interface SelectionSliceActions {
  selectNode: (id: string | null) => void;
  setSelectedNodes: (ids: string[]) => void;
  linkToViewer: (nodeId: string, outputIndex?: number) => Promise<void>;
}

export type SelectionSlice = SelectionSliceState & SelectionSliceActions;

export const createSelectionSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  SelectionSlice
> = (set, get) => ({
  selectedNodeIds: new Set(),

  selectNode: (id) => {
    set({ selectedNodeIds: id ? new Set([id]) : new Set() });
  },

  setSelectedNodes: (ids) => {
    set({ selectedNodeIds: new Set(ids), selectedFrameId: null });
  },

  linkToViewer: async (nodeId, outputIndex) => {
    const { nodes, nodeSpecs } = get();
    const clickedNode = nodes.get(nodeId);
    if (!clickedNode) return;

    const clickedSpec = nodeSpecs.find(s => s.id === clickedNode.typeId);
    if (!clickedSpec || clickedSpec.outputs.length === 0) return;

    // Determine which output to connect
    const idx = outputIndex ?? 0;
    const output = clickedSpec.outputs[idx % clickedSpec.outputs.length];

    // Find an existing viewer node
    let viewerNodeId: string | null = null;
    for (const [id, node] of nodes) {
      if (node.typeId === 'viewer') {
        viewerNodeId = id;
        break;
      }
    }

    // If no viewer exists, create one to the right of all existing nodes
    if (!viewerNodeId) {
      let maxX = -Infinity;
      let avgY = 0;
      let count = 0;
      for (const node of nodes.values()) {
        if (node.position.x > maxX) maxX = node.position.x;
        avgY += node.position.y;
        count++;
      }
      if (count > 0) avgY /= count;
      else avgY = 0;
      if (!isFinite(maxX)) maxX = 0;

      const viewerX = maxX + 400;
      const viewerY = avgY;

      viewerNodeId = await get().addNode('viewer', { x: viewerX, y: viewerY });
    }

    // Re-read connections from current state (addNode may have mutated)
    const currentConnections = get().connections;

    // Disconnect any existing connection going into the viewer's "value" input
    const existingConn = currentConnections.find(
      c => c.toNode === viewerNodeId && c.toPort === 'value'
    );
    if (existingConn) {
      await get().disconnect(existingConn.id);
    }

    // Connect the clicked node's output to the viewer's input
    await get().connect(nodeId, output.name, viewerNodeId, 'value');
  },
});
