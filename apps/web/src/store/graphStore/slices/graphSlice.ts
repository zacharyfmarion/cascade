import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { Connection, EditingContext, NodeInstance, NodeSpec, ParamValue, PortSpec } from '../../types';
import type { NodeInterfaceChange } from '../../../engine/bridge';
import { parseEngineError } from '../../../engine/engineError';
import type { EngineError } from '../../../engine/engineError';
import { sequenceFrameManager } from '../../../engine/sequenceFrameManager';
import { ADD_INPUT_PORT, ADD_OUTPUT_PORT, extractGraphData, getEngine, kernel, withGroupIOSpecs, pushParamDeltaSync, pushMuteDeltaSync } from '../kernel';
import { pendingImageFiles } from '../../../components/nodes/pendingImageFiles';

export interface GraphSliceState {
  nodes: Map<string, NodeInstance>;
  connections: Connection[];
  nodeSpecs: NodeSpec[];
  nodeSpecsById: Map<string, NodeSpec>;
  engineReady: boolean;
  lastError: EngineError | null;
  editingStack: EditingContext[];
  fitViewRequestId: number;
  previewScale: number;
}

export interface GraphSliceActions {
  addNode: (typeId: string, position: { x: number; y: number }) => Promise<string>;
  removeNode: (id: string) => Promise<void>;
  connect: (fromNode: string, fromPort: string, toNode: string, toPort: string) => Promise<void>;
  disconnect: (connectionId: string) => Promise<void>;
  setParam: (nodeId: string, key: string, value: ParamValue) => void;
  setInputDefault: (nodeId: string, portName: string, value: ParamValue) => Promise<void>;
  setPosition: (nodeId: string, position: { x: number; y: number }) => void;
  toggleMuteSelected: () => Promise<void>;

  isInsideGroup: () => boolean;
  enterGroup: (groupNodeId: string) => Promise<void>;
  exitGroup: () => void;
  navigateToBreadcrumb: (index: number) => Promise<void>;
  createGroup: (nodeIds: string[], name?: string) => Promise<void>;
  ungroupNode: (groupNodeId: string) => Promise<void>;
  renameGroup: (groupNodeId: string, newName: string) => Promise<void>;
  importCustomNodes: (json: string) => Promise<void>;
  applyNodeInterfaceChange: (nodeId: string, change: NodeInterfaceChange) => void;
  exportGroupAsPackage: (groupDefId: string) => Promise<void>;
  updateGroupInterface: (inputs: PortSpec[] | null, outputs: PortSpec[] | null) => Promise<void>;
}

export type GraphSlice = GraphSliceState & GraphSliceActions;

export const createGraphSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  GraphSlice
> = (set, get) => {
  const tagUiOrigin = () => {
    if (kernel.renderSuspendCount > 0) return;
    kernel.graphRevision++;
    set({ lastTransactionOrigin: 'ui', graphRevision: kernel.graphRevision });
  };

  return {
    nodes: new Map(),
    connections: [],
    nodeSpecs: [],
    nodeSpecsById: new Map(),
    engineReady: false,
    lastError: null,
    previewScale: 1,
    fitViewRequestId: 0,
    editingStack: [{ id: 'root', label: 'Root', groupNodeId: null }],

    addNode: async (typeId, position, initialFile?: File) => {
      await get().pushUndo();
      tagUiOrigin();

      const result = await getEngine().addNode(typeId, position.x, position.y);
      const actualTypeId = result.typeId;

      let spec = get().nodeSpecs.find(s => s.id === actualTypeId);
      const params: Record<string, ParamValue> = {};

      if (!spec && actualTypeId.startsWith('gpu_script::')) {
        spec = {
          id: actualTypeId,
          display_name: 'GPU Script',
          category: 'GPU',
          description: 'Custom GPU shader node. Write GLSL and compile to run.',
          inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
          outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
          params: [],
        };
        set({ nodeSpecs: [...get().nodeSpecs, spec] });
      }

      if (spec) {
        spec.params.forEach(p => {
          params[p.key] = p.default;
        });
      }

      const inputDefaults: Record<string, ParamValue> = {};
      if (spec) {
        for (const input of spec.inputs) {
          if (input.default) {
            inputDefaults[input.name] = input.default as ParamValue;
          }
        }
      }

      const newNodes = new Map(get().nodes);
      newNodes.set(result.id, {
        id: result.id,
        typeId: actualTypeId,
        params,
        inputDefaults,
        position,
        muted: false,
      });

      if (initialFile) {
        pendingImageFiles.set(result.id, initialFile);
      }
      set({ nodes: newNodes });
      if (actualTypeId === 'load_image_sequence') {
        get().recomputeSequenceState();
      }
      return result.id;
    },

    removeNode: async (id) => {
      await get().pushUndo();
      tagUiOrigin();
      const removedNode = get().nodes.get(id);
      await getEngine().removeNode(id);
      const newNodes = new Map(get().nodes);
      newNodes.delete(id);

      const affectedNodeIds = new Set<string>();
      for (const conn of get().connections) {
        if (conn.fromNode === id) {
          affectedNodeIds.add(conn.toNode);
        } else if (conn.toNode === id) {
          affectedNodeIds.add(conn.fromNode);
        }
      }

      const newConnections = get().connections.filter(
        c => c.fromNode !== id && c.toNode !== id
      );

      const newInfoMap = new Map(get().sequenceInfoMap);
      newInfoMap.delete(id);

      set({
        nodes: newNodes,
        connections: newConnections,
        selectedNodeIds: (() => {
          const prev = get().selectedNodeIds;
          if (prev.has(id)) {
            const next = new Set(prev);
            next.delete(id);
            return next;
          }
          return prev;
        })(),
        sequenceInfoMap: newInfoMap,
      });

      if (removedNode?.typeId === 'viewer') {
        const newResults = new Map(get().renderResults);
        newResults.delete(id);
        set({ renderResults: newResults });
      }

      // Clean up renderGenerations entry to prevent memory leak
      kernel.renderGenerations.delete(id);

      if (removedNode?.typeId === 'load_image_sequence') {
        sequenceFrameManager.clear(id);
        get().recomputeSequenceState();
      }

      get().triggerAffectedViewers(Array.from(affectedNodeIds));
    },

    connect: async (fromNode, fromPort, toNode, toPort) => {
      await get().pushUndo();
      tagUiOrigin();
      const exists = get().connections.some(
        c => c.fromNode === fromNode && c.fromPort === fromPort &&
             c.toNode === toNode && c.toPort === toPort
      );
      if (exists) return;

      const eng = getEngine();
      const editingStack = get().editingStack;
      if (editingStack.length > 1) {
        const ctx = editingStack[editingStack.length - 1];
        if (!eng.addInternalConnection || !eng.getGroupInternalGraph) {
          set({ lastError: parseEngineError(new Error('Group editing not supported by this engine')) });
          return;
        }

        const isAddFrom = fromPort === ADD_OUTPUT_PORT;
        const isAddTo = toPort === ADD_INPUT_PORT;

        if (isAddFrom || isAddTo) {
          const internalGraph = await eng.getGroupInternalGraph(ctx.groupNodeId!);
          let resolvedFromPort = fromPort;
          let resolvedToPort = toPort;

          if (isAddFrom) {
            const existing = internalGraph.inputs;
            let name = toPort;
            if (existing.some(p => p.name === name)) {
              let idx = 2;
              while (existing.some(p => p.name === `${toPort}_${idx}`)) { idx++; }
              name = `${toPort}_${idx}`;
            }
            resolvedFromPort = name;
          }

          if (isAddTo) {
            const existing = internalGraph.outputs;
            let name = fromPort;
            if (existing.some(p => p.name === name)) {
              let idx = 2;
              while (existing.some(p => p.name === `${fromPort}_${idx}`)) { idx++; }
              name = `${fromPort}_${idx}`;
            }
            resolvedToPort = name;
          }

          await eng.addInternalConnection(ctx.groupDefId!, fromNode, resolvedFromPort, toNode, resolvedToPort);

          const updatedGraph = await eng.getGroupInternalGraph(ctx.groupNodeId!);
          const specs = await Promise.resolve(eng.listNodeTypes());
          const id = crypto.randomUUID();
          const newConnection: Connection = { id, fromNode, fromPort: resolvedFromPort, toNode, toPort: resolvedToPort };
          set(state => ({
            connections: [...state.connections, newConnection],
            nodeSpecs: withGroupIOSpecs(specs, updatedGraph),
          }));
          get().triggerAffectedViewers([fromNode, toNode]);
          return;
        }
        await eng.addInternalConnection(ctx.groupDefId!, fromNode, fromPort, toNode, toPort);
      } else {
        await eng.connect(fromNode, fromPort, toNode, toPort);
      }
      const id = crypto.randomUUID();
      const newConnection: Connection = { id, fromNode, fromPort, toNode, toPort };
      set(state => ({
        connections: [...state.connections, newConnection]
      }));

      if (editingStack.length > 1) {
        const ctx = editingStack[editingStack.length - 1];
        if (!eng.getGroupInternalGraph) {
          set({ lastError: parseEngineError(new Error('Group editing not supported by this engine')) });
          return;
        }
        const internalGraph = await eng.getGroupInternalGraph(ctx.groupNodeId!);
        const specs = await Promise.resolve(eng.listNodeTypes());
        set({ nodeSpecs: withGroupIOSpecs(specs, internalGraph) });
      }
      get().triggerAffectedViewers([fromNode, toNode]);
    },

    disconnect: async (connectionId) => {
      await get().pushUndo();
      tagUiOrigin();
      const conn = get().connections.find(c => c.id === connectionId);
      if (conn) {
        const eng = getEngine();
        const editingStack = get().editingStack;
        if (editingStack.length > 1) {
          const ctx = editingStack[editingStack.length - 1];
          if (!eng.removeInternalConnection || !eng.getGroupInternalGraph) {
            set({ lastError: parseEngineError(new Error('Group editing not supported by this engine')) });
            return;
          }
          await eng.removeInternalConnection(ctx.groupDefId!, conn.toNode, conn.toPort);
        } else {
          await eng.disconnect(conn.toNode, conn.toPort);
        }
        set(state => ({
          connections: state.connections.filter(c => c.id !== connectionId)
        }));

        if (editingStack.length > 1) {
          const ctx = editingStack[editingStack.length - 1];
          if (!eng.getGroupInternalGraph) {
            set({ lastError: parseEngineError(new Error('Group editing not supported by this engine')) });
            return;
          }
          const internalGraph = await eng.getGroupInternalGraph(ctx.groupNodeId!);
          const specs = await Promise.resolve(eng.listNodeTypes());
          set({ nodeSpecs: withGroupIOSpecs(specs, internalGraph) });
        }
        get().triggerAffectedViewers([conn.fromNode, conn.toNode]);
      }
    },

    setParam: (nodeId, key, value) => {
      // Synchronous delta undo — no Worker calls, no blocking.
      // Captures oldValue from current Zustand state before mutating.
      pushParamDeltaSync('param', nodeId, key, get, set);
      tagUiOrigin();
      getEngine().setParam(nodeId, key, value);
      const newNodes = new Map(get().nodes);
      const node = newNodes.get(nodeId);
      if (node) {
        node.params = { ...node.params, [key]: value };
        newNodes.set(nodeId, { ...node });
        set({ nodes: newNodes });
      }
      // Fill in newValue on the delta we just pushed so redo works.
      const lastUndo = kernel.undoStack[kernel.undoStack.length - 1];
      if (lastUndo && 'kind' in lastUndo && lastUndo.kind === 'param-delta') {
        lastUndo.newValue = value;
      }
      get().triggerAffectedViewers([nodeId]);
    },

    setInputDefault: async (nodeId, portName, value) => {
      // Synchronous delta undo — same pattern as setParam.
      pushParamDeltaSync('inputDefault', nodeId, portName, get, set);
      tagUiOrigin();
      await getEngine().setInputDefault(nodeId, portName, value);
      const newNodes = new Map(get().nodes);
      const node = newNodes.get(nodeId);
      if (node) {
        node.inputDefaults = { ...node.inputDefaults, [portName]: value };
        newNodes.set(nodeId, { ...node });
        set({ nodes: newNodes });
      }
      // Fill in newValue on the delta.
      const lastUndo = kernel.undoStack[kernel.undoStack.length - 1];
      if (lastUndo && 'kind' in lastUndo && lastUndo.kind === 'param-delta') {
        lastUndo.newValue = value;
      }
      get().triggerAffectedViewers([nodeId]);
    },

    setPosition: (nodeId, position) => {
      const newNodes = new Map(get().nodes);
      const node = newNodes.get(nodeId);
      if (node) {
        node.position = position;
        newNodes.set(nodeId, { ...node });
        set({ nodes: newNodes });
        getEngine().setPosition(nodeId, position.x, position.y);
      }
    },

    toggleMuteSelected: async () => {
      tagUiOrigin();
      const UNMUTABLE_TYPES = new Set([
        'load_image', 'load_image_sequence', 'load_video',
        'viewer', 'export_image', 'export_image_sequence', 'export_video',
        'group_input', 'group_output',
      ]);

      const nodes = get().nodes;
      const selectedIds = Array.from(get().selectedNodeIds).filter(id => {
        const node = nodes.get(id);
        return node && !UNMUTABLE_TYPES.has(node.typeId);
      });
      if (selectedIds.length === 0) return;

      const anyUnmuted = selectedIds.some(id => !nodes.get(id)?.muted);
      const newMuted = anyUnmuted;

      // Synchronous mute-delta undo — capture before mutating.
      const entries = selectedIds.map(id => ({
        nodeId: id,
        oldMuted: nodes.get(id)?.muted ?? false,
        newMuted,
      }));
      pushMuteDeltaSync(entries, get, set);

      const eng = getEngine();

      for (const id of selectedIds) {
        await Promise.resolve(eng.setMuted(id, newMuted));
      }

      const newNodes = new Map(nodes);
      for (const id of selectedIds) {
        const node = newNodes.get(id);
        if (node) {
          newNodes.set(id, { ...node, muted: newMuted });
        }
      }
      set({ nodes: newNodes });

      get().triggerAffectedViewers([...selectedIds]);
    },

    isInsideGroup: () => {
      return get().editingStack.length > 1;
    },

    enterGroup: async (groupNodeId) => {
      const eng = getEngine();
      if (!eng.getGroupInternalGraph) {
        set({ lastError: parseEngineError(new Error('Group editing not supported by this engine')) });
        return;
      }

      const node = get().nodes.get(groupNodeId);
      if (!node) return;

      const internalGraph = await eng.getGroupInternalGraph(groupNodeId);
      const newNodes = new Map<string, NodeInstance>();
      const newConnections: Connection[] = [];

      for (const n of internalGraph.nodes) {
        const spec = get().nodeSpecs.find(s => s.id === n.typeId);
        const params: Record<string, ParamValue> = {};
        if (spec) {
          spec.params.forEach(p => {
            params[p.key] = n.params[p.key] ?? p.default;
          });
        } else {
          Object.assign(params, n.params);
        }
        newNodes.set(n.id, {
          id: n.id,
          typeId: n.typeId,
          params,
          inputDefaults: n.inputDefaults ?? {},
          position: n.position,
          muted: false,
        });
      }

      for (const c of internalGraph.connections) {
        newConnections.push({
          id: crypto.randomUUID(),
          fromNode: c.fromNode,
          fromPort: c.fromPort,
          toNode: c.toNode,
          toPort: c.toPort,
        });
      }

      const context: EditingContext = {
        id: internalGraph.groupDefId,
        label: internalGraph.name,
        groupNodeId,
        groupDefId: internalGraph.groupDefId,
        savedNodes: new Map(get().nodes),
        savedConnections: [...get().connections],
        savedNodeSpecs: [...get().nodeSpecs],
      };

      set({
        editingStack: [...get().editingStack, context],
        nodes: newNodes,
        connections: newConnections,
        nodeSpecs: withGroupIOSpecs(get().nodeSpecs, internalGraph),
        selectedNodeIds: new Set(),
        renderResults: new Map(),
        fitViewRequestId: get().fitViewRequestId + 1,
      });
    },

    exitGroup: () => {
      const stack = get().editingStack;
      if (stack.length <= 1) return;
      get().navigateToBreadcrumb(stack.length - 2);
    },

    navigateToBreadcrumb: async (index) => {
      const stack = get().editingStack;
      if (index < 0 || index >= stack.length) return;
      if (index === stack.length - 1) return;

      const newStack = stack.slice(0, index + 1);
      const eng = getEngine();

      if (index === 0) {
        const childContext = stack[index + 1];
        if (childContext?.savedNodes) {
          const specs = await Promise.resolve(eng.listNodeTypes());
          set({
            editingStack: newStack,
            nodes: childContext.savedNodes,
            connections: childContext.savedConnections ?? [],
            nodeSpecs: specs,
            selectedNodeIds: new Set(),
            renderResults: new Map(),
            fitViewRequestId: get().fitViewRequestId + 1,
          });
          get().triggerAllViewers();
          return;
        }

        const graphData = await Promise.resolve(eng.exportGraph());
        const data = extractGraphData(graphData);
        const specs = await Promise.resolve(eng.listNodeTypes());
        const newNodes = new Map<string, NodeInstance>();
        const newConnections: Connection[] = [];

        if (data.nodes) {
          for (const node of data.nodes) {
            const spec = specs.find((s: NodeSpec) => s.id === node.type_id);
            const params: Record<string, ParamValue> = {};
            if (spec) {
              spec.params.forEach((p: { key: string; default: ParamValue }) => {
                params[p.key] = node.params?.[p.key] ?? p.default;
              });
            }
            newNodes.set(node.id, {
              id: node.id,
              typeId: node.type_id,
              params,
              inputDefaults: node.input_defaults ?? {},
              position: { x: node.position[0], y: node.position[1] },
              muted: node.muted ?? false,
            });
          }
        }

        if (data.connections) {
          for (const conn of data.connections) {
            newConnections.push({
              id: crypto.randomUUID(),
              fromNode: conn.from_node,
              fromPort: conn.from_port,
              toNode: conn.to_node,
              toPort: conn.to_port,
            });
          }
        }

        set({
          editingStack: newStack,
          nodes: newNodes,
          connections: newConnections,
          nodeSpecs: specs,
          selectedNodeIds: new Set(),
          renderResults: new Map(),
          fitViewRequestId: get().fitViewRequestId + 1,
        });
        get().triggerAllViewers();
      } else {
        const childContext = stack[index + 1];
        if (childContext?.savedNodes) {
          const specs = await Promise.resolve(eng.listNodeTypes());
          set({
            editingStack: newStack,
            nodes: childContext.savedNodes,
            connections: childContext.savedConnections ?? [],
            nodeSpecs: specs,
            selectedNodeIds: new Set(),
            renderResults: new Map(),
          });
          get().triggerAllViewers();
          return;
        }

        const targetContext = newStack[newStack.length - 1];
        if (targetContext.groupNodeId && eng.getGroupInternalGraph) {
          const internalGraph = await eng.getGroupInternalGraph(targetContext.groupNodeId);
          const newNodes = new Map<string, NodeInstance>();
          const newConnections: Connection[] = [];

          for (const n of internalGraph.nodes) {
            newNodes.set(n.id, {
              id: n.id,
              typeId: n.typeId,
              params: n.params,
              inputDefaults: n.inputDefaults ?? {},
              position: n.position,
              muted: false,
            });
          }

          for (const c of internalGraph.connections) {
            newConnections.push({
              id: crypto.randomUUID(),
              fromNode: c.fromNode,
              fromPort: c.fromPort,
              toNode: c.toNode,
              toPort: c.toPort,
            });
          }

          set({
            editingStack: newStack,
            nodes: newNodes,
            connections: newConnections,
            nodeSpecs: withGroupIOSpecs(get().nodeSpecs, internalGraph),
            selectedNodeIds: new Set(),
            renderResults: new Map(),
            fitViewRequestId: get().fitViewRequestId + 1,
          });
          get().triggerAllViewers();
        }
      }
    },

    createGroup: async (nodeIds, name) => {
      const eng = getEngine();
      if (!eng.createGroupFromNodes) {
        set({ lastError: parseEngineError(new Error('Group creation not supported by this engine')) });
        return;
      }

      await get().pushUndo();
      const result = await eng.createGroupFromNodes(nodeIds, name ?? 'Node Group');

      const newNodes = new Map(get().nodes);
      for (const removedId of result.removedNodeIds) {
        newNodes.delete(removedId);
      }

      const spec = result.newSpec;
      const params: Record<string, ParamValue> = {};
      if (spec) {
        spec.params.forEach(p => {
          params[p.key] = p.default;
        });
      }

      const positions = nodeIds
        .map(id => get().nodes.get(id)?.position)
        .filter((p): p is { x: number; y: number } => p != null);
      const centroidX = positions.reduce((sum, p) => sum + p.x, 0) / (positions.length || 1);
      const centroidY = positions.reduce((sum, p) => sum + p.y, 0) / (positions.length || 1);

      newNodes.set(result.groupNodeId, {
        id: result.groupNodeId,
        typeId: result.groupDefinitionId,
        params,
        inputDefaults: {},
        position: { x: centroidX, y: centroidY },
        muted: false,
      });

      const newConnections = get().connections.filter(
        c => !result.removedNodeIds.includes(c.fromNode) && !result.removedNodeIds.includes(c.toNode)
      );

      const specs = await Promise.resolve(eng.listNodeTypes());

      set({
        nodes: newNodes,
        connections: newConnections,
        nodeSpecs: specs,
        selectedNodeIds: new Set([result.groupNodeId]),
      });

      const graphData = await Promise.resolve(eng.exportGraph());
      const data = extractGraphData(graphData);
      if (data.connections) {
        const updatedConnections: Connection[] = [];
        for (const conn of data.connections) {
          updatedConnections.push({
            id: crypto.randomUUID(),
            fromNode: conn.from_node,
            fromPort: conn.from_port,
            toNode: conn.to_node,
            toPort: conn.to_port,
          });
        }
        set({ connections: updatedConnections });
      }

      get().triggerAllViewers();
    },

    ungroupNode: async (groupNodeId) => {
      const eng = getEngine();
      if (!eng.ungroupNode) {
        set({ lastError: parseEngineError(new Error('Ungrouping not supported by this engine')) });
        return;
      }

      await get().pushUndo();
      const result = await eng.ungroupNode(groupNodeId);

      const newNodes = new Map(get().nodes);
      newNodes.delete(result.removedGroupNodeId);

      for (const restored of result.restoredNodes) {
        newNodes.set(restored.id, {
          id: restored.id,
          typeId: restored.typeId,
          params: restored.params,
          inputDefaults: restored.inputDefaults,
          position: restored.position,
          muted: false,
        });
      }

      const graphData = await Promise.resolve(eng.exportGraph());
      const data = extractGraphData(graphData);
      const newConnections: Connection[] = [];
      if (data.connections) {
        for (const conn of data.connections) {
          newConnections.push({
            id: crypto.randomUUID(),
            fromNode: conn.from_node,
            fromPort: conn.from_port,
            toNode: conn.to_node,
            toPort: conn.to_port,
          });
        }
      }

      const specs = await Promise.resolve(eng.listNodeTypes());
      set({
        nodes: newNodes,
        connections: newConnections,
        nodeSpecs: specs,
        selectedNodeIds: new Set(result.restoredNodes.map(n => n.id)),
      });

      get().triggerAllViewers();
    },

    renameGroup: async (groupNodeId, newName) => {
      const node = get().nodes.get(groupNodeId);
      if (!node || !node.typeId.startsWith('group::')) return;

      const eng = getEngine();
      if (!eng.renameGroup) {
        set({ lastError: parseEngineError(new Error('Group rename not supported by this engine')) });
        return;
      }

      await get().pushUndo();
      await eng.renameGroup(node.typeId, newName);

      const specs = await Promise.resolve(eng.listNodeTypes());
      set({ nodeSpecs: specs });
    },

    importCustomNodes: async (json) => {
      const eng = getEngine();
      if (!eng.importCustomNodes) {
        set({ lastError: parseEngineError(new Error('Custom node import not supported by this engine')) });
        return;
      }
      try {
        const newSpecs = await Promise.resolve(eng.importCustomNodes(json));
        const specs = await Promise.resolve(eng.listNodeTypes());
        set({ nodeSpecs: specs });
        console.log(`[CustomNodes] Imported ${newSpecs.length} custom node(s)`);
      } catch (e) {
        set({ lastError: parseEngineError(e) });
      }
    },

    exportGroupAsPackage: async (groupDefId) => {
      const eng = getEngine();
      if (!eng.exportGroupAsPackage) {
        set({ lastError: parseEngineError(new Error('Custom node export not supported by this engine')) });
        return;
      }
      try {
        const pkg = await Promise.resolve(eng.exportGroupAsPackage(groupDefId));
        const json = JSON.stringify(pkg, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const name = groupDefId.replace(/^group::/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
        a.href = url;
        a.download = `${name}.compnode`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        set({ lastError: parseEngineError(e) });
      }
    },

    updateGroupInterface: async (inputs, outputs) => {
      const stack = get().editingStack;
      if (stack.length <= 1) return;
      const currentContext = stack[stack.length - 1];
      if (!currentContext.groupDefId || !currentContext.groupNodeId) return;

      const eng = getEngine();
      if (!eng.updateGroupInterface || !eng.getGroupInternalGraph) {
        set({ lastError: parseEngineError(new Error('Group interface update not supported by this engine')) });
        return;
      }

      const currentGraph = await eng.getGroupInternalGraph(currentContext.groupNodeId);
      const resolvedInputs = inputs ?? currentGraph.inputs;
      const resolvedOutputs = outputs ?? currentGraph.outputs;

      await get().pushUndo();
      const updatedSpec = await eng.updateGroupInterface(currentContext.groupDefId, resolvedInputs, resolvedOutputs);

      const specs = await Promise.resolve(eng.listNodeTypes());
      const internalGraph = await eng.getGroupInternalGraph(currentContext.groupNodeId);
      const newNodes = new Map<string, NodeInstance>();
      const newConnections: Connection[] = [];

      for (const n of internalGraph.nodes) {
        const nSpec = specs.find(s => s.id === n.typeId) ?? updatedSpec;
        const params: Record<string, ParamValue> = {};
        if (nSpec) {
          nSpec.params.forEach(p => {
            params[p.key] = n.params[p.key] ?? p.default;
          });
        } else {
          Object.assign(params, n.params);
        }
        newNodes.set(n.id, {
          id: n.id,
          typeId: n.typeId,
          params,
          inputDefaults: n.inputDefaults ?? {},
          position: n.position,
          muted: false,
        });
      }

      for (const c of internalGraph.connections) {
        newConnections.push({
          id: crypto.randomUUID(),
          fromNode: c.fromNode,
          fromPort: c.fromPort,
          toNode: c.toNode,
          toPort: c.toPort,
        });
      }

      set({
        nodes: newNodes,
        connections: newConnections,
        nodeSpecs: withGroupIOSpecs(specs, internalGraph),
      });
    },

    applyNodeInterfaceChange: (nodeId, change) => {
      // Update per-instance spec
      const newSpecsById = new Map(get().nodeSpecsById);
      newSpecsById.set(nodeId, change.newSpec);
      
      // Remove connections that were pruned by the engine
      let newConnections = get().connections;
      if (change.prunedConnections.length > 0) {
        const pruneSet = new Set(
          change.prunedConnections.map(pc => `${pc.fromNode}:${pc.fromPort}->${pc.toNode}:${pc.toPort}`)
        );
        newConnections = newConnections.filter(c =>
          !pruneSet.has(`${c.fromNode}:${c.fromPort}->${c.toNode}:${c.toPort}`)
        );
        
        // Toast for each pruned connection
        for (const pc of change.prunedConnections) {
          get().pushToast('info', 'Connection removed', `Port "${pc.fromPort}" no longer exists`);
        }
      }
      
      set({
        nodeSpecsById: newSpecsById,
        connections: newConnections,
      });
    },

  };
};
