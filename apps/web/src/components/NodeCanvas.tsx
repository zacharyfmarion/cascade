import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  SelectionMode,
} from '@xyflow/react';
import type {
  Node as FlowNode,
  Edge as FlowEdge,
  Connection as FlowConnection,
  NodeChange,
  EdgeChange,
  NodeTypes,
  OnConnectStartParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { ImageInputNode } from './nodes/ImageInputNode';
import { LoadImageSequenceNode } from './nodes/LoadImageSequenceNode';
import { LoadVideoNode } from './nodes/LoadVideoNode';
import { ViewerNode } from './nodes/ViewerNode';
import { ProcessingNode } from './nodes/ProcessingNode';
import { ExportImageNode } from './nodes/ExportImageNode';
import { ExportImageSequenceNode } from './nodes/ExportImageSequenceNode';
import { ExportVideoNode } from './nodes/ExportVideoNode';
import { ColorRampNode } from './nodes/ColorRampNode';
import { GroupInputNode } from './nodes/GroupInputNode';
import { GroupOutputNode } from './nodes/GroupOutputNode';
import { GroupNodeComponent } from './nodes/GroupNodeComponent';
import { ColorPaletteNode } from './nodes/ColorPaletteNode';
import { CurvesNode } from './nodes/CurvesNode';
import { FrameNode } from './nodes/FrameNode';

const SPECIAL_NODE_TYPES: NodeTypes = {
  load_image: ImageInputNode,
  load_image_sequence: LoadImageSequenceNode,
  load_video: LoadVideoNode,
  viewer: ViewerNode,
  export_image: ExportImageNode,
  export_image_sequence: ExportImageSequenceNode,
  export_video: ExportVideoNode,
  color_ramp: ColorRampNode,
  color_palette: ColorPaletteNode,
  curves: CurvesNode,
  group_input: GroupInputNode,
  group_output: GroupOutputNode,
  frame: FrameNode,
};

const PORT_COLORS: Record<string, string> = {
   Image: 'var(--port-image)',
   Mask: 'var(--port-mask)',
   Float: 'var(--port-float)',
   Int: 'var(--port-int)',
   Bool: 'var(--port-bool)',
   Color: 'var(--port-color)',
   Field: 'var(--port-field)',
 };

 function typesCompatible(from: string, to: string): boolean {
   return from === to || (from === 'Field' && to === 'Image');
 }

 const DEFAULT_EDGE_COLOR = 'var(--text-muted)';

interface ClipboardEntry {
  typeId: string;
  params: Record<string, unknown>;
  offsetX: number;
  offsetY: number;
}

import { CanvasContextMenu } from './CanvasContextMenu';
import type { ContextMenuState } from './CanvasContextMenu';

export const NodeCanvas: React.FC = () => {
  const nodesStore = useGraphStore(s => s.nodes);
  const framesStore = useGraphStore(s => s.frames);
  const connectionsStore = useGraphStore(s => s.connections);
  const nodeSpecs = useGraphStore(s => s.nodeSpecs);
  const { screenToFlowPosition, getNodes, getEdges } = useReactFlow();

  const nodeTypes = useMemo((): NodeTypes => {
    const types: NodeTypes = { ...SPECIAL_NODE_TYPES };
    for (const spec of nodeSpecs) {
      if (!(spec.id in types)) {
        if (spec.id.startsWith('group::')) {
          types[spec.id] = GroupNodeComponent;
        } else {
          types[spec.id] = ProcessingNode;
        }
      }
    }
    return types;
  }, [nodeSpecs]);

  const addNode = useGraphStore(s => s.addNode);
  const storeConnect = useGraphStore(s => s.connect);
  const storeDisconnect = useGraphStore(s => s.disconnect);
  const setPosition = useGraphStore(s => s.setPosition);
  const selectNode = useGraphStore(s => s.selectNode);
  const removeNode = useGraphStore(s => s.removeNode);
  const setParam = useGraphStore(s => s.setParam);
  const frameSelectedNodes = useGraphStore(s => s.frameSelectedNodes);

  const getMeasuredNodeSizes = useCallback(() => {
    const sizes = new Map<string, { width: number; height: number }>();
    for (const node of getNodes()) {
      if (node.measured?.width && node.measured?.height) {
        sizes.set(node.id, { width: node.measured.width, height: node.measured.height });
      }
    }
    return sizes;
  }, [getNodes]);

  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([]);
  const [flowEdges, setFlowEdges] = useState<FlowEdge[]>([]);
  const flowNodesRef = useRef<FlowNode[]>([]);
  const flowEdgesRef = useRef<FlowEdge[]>([]);
  const dropTargetFrameId = useRef<string | null>(null);
  flowNodesRef.current = flowNodes;
  flowEdgesRef.current = flowEdges;
  const clipboardRef = useRef<ClipboardEntry[]>([]);
  const isCutRef = useRef(false);
  const edgeReconnectSuccessful = useRef(true);
  const connectionMadeRef = useRef(false);
  const menuJustOpenedRef = useRef(false);

  // Track Cmd+Shift+Click viewer linking state (Blender-style output cycling)
  const viewerLinkRef = useRef<{ nodeId: string; outputIndex: number } | null>(null);

  const snapToGrid = useSettingsStore(s => s.snapToGrid);
  const gridSize = useSettingsStore(s => s.gridSize);
  const showMinimap = useSettingsStore(s => s.showMinimap);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Track pending connection from drag-to-empty-space
  const connectingNodeId = useRef<string | null>(null);
  const connectingHandleId = useRef<string | null>(null);
  const connectingHandleType = useRef<'source' | 'target' | null>(null);
  const [pendingConnection, setPendingConnection] = useState<{
    nodeId: string;
    handleId: string;
    handleType: 'source' | 'target';
  } | null>(null);

  const onPaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault();
    setPendingConnection(null);
    setContextMenu({ type: 'pane', x: event.clientX, y: event.clientY });
  }, []);

  const onConnectStart = useCallback((_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
    connectingNodeId.current = params.nodeId ?? null;
    connectingHandleId.current = params.handleId ?? null;
    connectingHandleType.current = params.handleType ?? null;
    connectionMadeRef.current = false;
  }, []);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    if (connectionMadeRef.current) {
      connectionMadeRef.current = false;
      connectingNodeId.current = null;
      connectingHandleId.current = null;
      connectingHandleType.current = null;
      return;
    }

    if (!connectingNodeId.current || !connectingHandleId.current || !connectingHandleType.current) {
      return;
    }

    if ('clientX' in event && 'clientY' in event) {
      menuJustOpenedRef.current = true;
      setPendingConnection({
        nodeId: connectingNodeId.current,
        handleId: connectingHandleId.current,
        handleType: connectingHandleType.current,
      });
      setContextMenu({ type: 'pane', x: event.clientX, y: event.clientY });
    }

    connectingNodeId.current = null;
    connectingHandleId.current = null;
    connectingHandleType.current = null;
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setPendingConnection(null);
  }, []);

  const onAddNodeFromMenu = useCallback(async (typeId: string) => {
    if (!contextMenu) return;
    const position = screenToFlowPosition({
      x: contextMenu.x,
      y: contextMenu.y,
    });

    try {
      const newId = await addNode(typeId, position);

      if (pendingConnection) {
        const newSpec = nodeSpecs.find(s => s.id === typeId);
        if (newSpec) {
          const srcNode = pendingConnection.handleType === 'source' ? pendingConnection.nodeId : newId;
          const tgtNode = pendingConnection.handleType === 'source' ? newId : pendingConnection.nodeId;

           if (pendingConnection.handleType === 'source') {
             const srcStoreNode = nodesStore.get(pendingConnection.nodeId);
             const srcSpec = srcStoreNode ? nodeSpecs.find(s => s.id === srcStoreNode.typeId) : null;
             const srcOutput = srcSpec?.outputs.find(o => o.name === pendingConnection.handleId);
             const matchingInput = srcOutput
               ? newSpec.inputs.find(i => typesCompatible(srcOutput.ty, i.ty)) ?? newSpec.inputs[0]
               : newSpec.inputs[0];

            if (matchingInput) {
              await storeConnect(srcNode, pendingConnection.handleId, tgtNode, matchingInput.name);
            }
           } else {
             const tgtStoreNode = nodesStore.get(pendingConnection.nodeId);
             const tgtSpec = tgtStoreNode ? nodeSpecs.find(s => s.id === tgtStoreNode.typeId) : null;
             const tgtInput = tgtSpec?.inputs.find(i => i.name === pendingConnection.handleId);
             const matchingOutput = tgtInput
               ? newSpec.outputs.find(o => typesCompatible(o.ty, tgtInput.ty)) ?? newSpec.outputs[0]
               : newSpec.outputs[0];

            if (matchingOutput) {
              await storeConnect(srcNode, matchingOutput.name, tgtNode, pendingConnection.handleId);
            }
          }
        }
      }
    } catch (e) {
      console.error('[ContextMenu] addNode failed:', e);
    }

    setPendingConnection(null);
    closeContextMenu();
  }, [contextMenu, screenToFlowPosition, addNode, closeContextMenu, pendingConnection, nodeSpecs, nodesStore, storeConnect]);

  const onFrameSelectionFromMenu = useCallback((nodeIds: string[]) => {
    useGraphStore.getState().setSelectedNodes(nodeIds);
    frameSelectedNodes(getMeasuredNodeSizes());
  }, [frameSelectedNodes, getMeasuredNodeSizes]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };

    if (contextMenu) {
      document.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu, closeContextMenu]);

  const getEdgeColor = useCallback(
    (fromNode: string, fromPort: string): string => {
      const node = nodesStore.get(fromNode);
      if (!node) return DEFAULT_EDGE_COLOR;
      const spec = nodeSpecs.find(s => s.id === node.typeId);
      if (!spec) return DEFAULT_EDGE_COLOR;
      const output = spec.outputs.find(o => o.name === fromPort);
      return output ? (PORT_COLORS[output.ty] ?? DEFAULT_EDGE_COLOR) : DEFAULT_EDGE_COLOR;
    },
    [nodesStore, nodeSpecs]
  );

  useEffect(() => {
    const prev = flowNodesRef.current;
    const nextNodes: FlowNode[] = Array.from(nodesStore.values()).map(node => {
      const spec = nodeSpecs.find(s => s.id === node.typeId);
      const existing = prev.find(n => n.id === node.id);
      return {
        id: node.id,
        type: node.typeId,
        position: node.position,
        selected: existing?.selected ?? false,
        data: {
          label: spec?.display_name || node.typeId,
          spec,
          params: node.params,
          inputDefaults: node.inputDefaults,
        },
      };
    });
    for (const frame of framesStore.values()) {
      nextNodes.push({
        id: `frame__${frame.id}`,
        type: 'frame',
        position: frame.position,
        selected: false,
        zIndex: -1000 + frame.zIndex,
        style: { width: frame.size.width, height: frame.size.height },
        data: {
          label: frame.label,
          color: frame.color,
          frameId: frame.id,
          width: frame.size.width,
          height: frame.size.height,
          selected: false,
          dropTarget: dropTargetFrameId.current === frame.id,
        },
        draggable: true,
        selectable: true,
        connectable: false,
      });
    }
    flowNodesRef.current = nextNodes;
    setFlowNodes(nextNodes);
  }, [nodesStore, nodeSpecs, framesStore]);

  useEffect(() => {
    const prev = flowEdgesRef.current;
    const nextEdges: FlowEdge[] = connectionsStore.map(conn => {
      const existing = prev.find(e => e.id === conn.id);
      return {
        id: conn.id,
        source: conn.fromNode,
        sourceHandle: conn.fromPort,
        target: conn.toNode,
        targetHandle: conn.toPort,
        type: 'default',
        reconnectable: true,
        selected: existing?.selected ?? false,
        style: {
          stroke: getEdgeColor(conn.fromNode, conn.fromPort),
          strokeWidth: 2,
        },
        selectable: true,
        focusable: true,
      };
    });
    setFlowEdges(nextEdges);
  }, [connectionsStore, getEdgeColor]);

  const setSelectedNodes = useGraphStore(s => s.setSelectedNodes);

  const refitFrames = useCallback((excludeNodeIds?: Set<string>) => {
    const PADDING = 30;
    const HEADER = 28;
    const MIN_W = 200;
    const MIN_H = 150;
    const { frames, nodes } = useGraphStore.getState();
    const flowNodeList = getNodes();

    for (const frame of frames.values()) {
      const containedBounds: { l: number; t: number; r: number; b: number }[] = [];

      for (const [nodeId, node] of nodes) {
        if (excludeNodeIds?.has(nodeId)) continue;
        const fn = flowNodeList.find(n => n.id === nodeId);
        const w = fn?.measured?.width ?? 200;
        const h = fn?.measured?.height ?? 100;
        const cx = node.position.x + w / 2;
        const cy = node.position.y + h / 2;

        if (
          cx >= frame.position.x &&
          cy >= frame.position.y &&
          cx <= frame.position.x + frame.size.width &&
          cy <= frame.position.y + frame.size.height
        ) {
          containedBounds.push({ l: node.position.x, t: node.position.y, r: node.position.x + w, b: node.position.y + h });
        }
      }

      if (containedBounds.length > 0) {
        const minL = Math.min(...containedBounds.map(b => b.l));
        const minT = Math.min(...containedBounds.map(b => b.t));
        const maxR = Math.max(...containedBounds.map(b => b.r));
        const maxB = Math.max(...containedBounds.map(b => b.b));

        const newX = minL - PADDING;
        const newY = minT - PADDING - HEADER;
        const newW = Math.max(MIN_W, (maxR - minL) + PADDING * 2);
        const newH = Math.max(MIN_H, (maxB - minT) + PADDING * 2 + HEADER);

        const pos = frame.position;
        const sz = frame.size;
        if (
          Math.abs(newX - pos.x) > 1 ||
          Math.abs(newY - pos.y) > 1 ||
          Math.abs(newW - sz.width) > 1 ||
          Math.abs(newH - sz.height) > 1
        ) {
          useGraphStore.getState().updateFrame(frame.id, {
            position: { x: newX, y: newY },
            size: { width: newW, height: newH },
          });
        }
      }
    }
  }, [getNodes]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const removals = changes.filter(c => c.type === 'remove');
    const nonRemovals = changes.filter(c => c.type !== 'remove');

    let selectionChanged = false;
    nonRemovals.forEach(change => {
      if (change.type === 'position' && change.position) {
        if (change.id.startsWith('frame__')) {
          const frameId = change.id.slice(7);
          const frame = useGraphStore.getState().frames.get(frameId);
          if (frame && change.dragging) {
            const oldPos = frame.position;
            const newPos = change.position;
            const dx = newPos.x - oldPos.x;
            const dy = newPos.y - oldPos.y;

            if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
              const { nodes } = useGraphStore.getState();
              const flowNodeList = getNodes();
              for (const [nodeId, node] of nodes) {
                const flowNode = flowNodeList.find(n => n.id === nodeId);
                const nw = flowNode?.measured?.width ?? 200;
                const nh = flowNode?.measured?.height ?? 100;
                // Use node center for containment check
                const cx = node.position.x + nw / 2;
                const cy = node.position.y + nh / 2;
                if (
                  cx >= oldPos.x &&
                  cy >= oldPos.y &&
                  cx <= oldPos.x + frame.size.width &&
                  cy <= oldPos.y + frame.size.height
                ) {
                  setPosition(nodeId, {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                  });
                }
              }
            }
          }
          useGraphStore.getState().updateFrame(frameId, { position: change.position });
        } else {
          setPosition(change.id, change.position);

          // Detect drag over frames for auto-expand highlight
          if (change.dragging) {
            const flowNode = getNodes().find(n => n.id === change.id);
            const nw = flowNode?.measured?.width ?? 200;
            const nh = flowNode?.measured?.height ?? 100;
            const cx = change.position.x + nw / 2;
            const cy = change.position.y + nh / 2;
            const SNAP_MARGIN = 50;
            const { frames } = useGraphStore.getState();
            let hitFrameId: string | null = null;
            for (const frame of frames.values()) {
              const fx = frame.position.x - SNAP_MARGIN;
              const fy = frame.position.y - SNAP_MARGIN;
              const fw = frame.size.width + SNAP_MARGIN * 2;
              const fh = frame.size.height + SNAP_MARGIN * 2;
              if (cx >= fx && cy >= fy && cx <= fx + fw && cy <= fy + fh) {
                hitFrameId = frame.id;
                break;
              }
            }
            if (hitFrameId !== dropTargetFrameId.current) {
              dropTargetFrameId.current = hitFrameId;
              // Force re-render of frame nodes to update dropTarget flag
              setFlowNodes(prev => prev.map(n => {
                if (!n.id.startsWith('frame__')) return n;
                const fid = n.id.slice(7);
                return { ...n, data: { ...n.data, dropTarget: fid === hitFrameId } };
              }));
            }
          }

          // On drop: refit frames that contain this node (expand or shrink to fit)
          if (change.dragging === false) {
            const droppedPos = change.position;
            const flowNodeList = getNodes();
            const droppedFlowNode = flowNodeList.find(n => n.id === change.id);
            const droppedW = droppedFlowNode?.measured?.width ?? 200;
            const droppedH = droppedFlowNode?.measured?.height ?? 100;
            const droppedCx = droppedPos.x + droppedW / 2;
            const droppedCy = droppedPos.y + droppedH / 2;

            const SNAP_MARGIN = 50;
            const PADDING = 30;
            const HEADER = 28;
            const MIN_W = 200;
            const MIN_H = 150;
            const { frames, nodes } = useGraphStore.getState();

            // Find the frame this node was dropped into/near
            let targetFrameId = dropTargetFrameId.current;
            if (!targetFrameId) {
              // Also check if node center is inside any existing frame
              for (const frame of frames.values()) {
                if (
                  droppedCx >= frame.position.x &&
                  droppedCy >= frame.position.y &&
                  droppedCx <= frame.position.x + frame.size.width &&
                  droppedCy <= frame.position.y + frame.size.height
                ) {
                  targetFrameId = frame.id;
                  break;
                }
              }
            }
            dropTargetFrameId.current = null;

            if (targetFrameId) {
              const frame = frames.get(targetFrameId);
              if (frame) {
                // Collect all nodes whose center is inside the frame (including the dropped node)
                // Use the expanded snap zone for the dropped node, but strict bounds for existing nodes
                const containedBounds: { l: number; t: number; r: number; b: number }[] = [];

                for (const [nodeId, node] of nodes) {
                  const fn = flowNodeList.find(n => n.id === nodeId);
                  const w = fn?.measured?.width ?? 200;
                  const h = fn?.measured?.height ?? 100;
                  const pos = nodeId === change.id ? droppedPos : node.position;
                  const cx = pos.x + w / 2;
                  const cy = pos.y + h / 2;

                  // Check if node center is inside frame (with snap margin for the dropped node)
                  const margin = nodeId === change.id ? SNAP_MARGIN : 0;
                  if (
                    cx >= frame.position.x - margin &&
                    cy >= frame.position.y - margin &&
                    cx <= frame.position.x + frame.size.width + margin &&
                    cy <= frame.position.y + frame.size.height + margin
                  ) {
                    containedBounds.push({ l: pos.x, t: pos.y, r: pos.x + w, b: pos.y + h });
                  }
                }

                if (containedBounds.length > 0) {
                  const minL = Math.min(...containedBounds.map(b => b.l));
                  const minT = Math.min(...containedBounds.map(b => b.t));
                  const maxR = Math.max(...containedBounds.map(b => b.r));
                  const maxB = Math.max(...containedBounds.map(b => b.b));

                  const newX = minL - PADDING;
                  const newY = minT - PADDING - HEADER;
                  const newW = Math.max(MIN_W, (maxR - minL) + PADDING * 2);
                  const newH = Math.max(MIN_H, (maxB - minT) + PADDING * 2 + HEADER);

                  useGraphStore.getState().updateFrame(targetFrameId, {
                    position: { x: newX, y: newY },
                    size: { width: newW, height: newH },
                  });
                }
              }
            }

            // Clear highlight
            setFlowNodes(prev => prev.map(n => {
              if (!n.id.startsWith('frame__')) return n;
              return { ...n, data: { ...n.data, dropTarget: false } };
            }));
          }
        }
      }
      if (change.type === 'select') {
        selectionChanged = true;
        if (change.id.startsWith('frame__') && change.selected) {
          useGraphStore.getState().selectFrame(change.id.slice(7));
        }
      }
    });

    const next = applyNodeChanges(nonRemovals, flowNodesRef.current);
    setFlowNodes(next);

    if (selectionChanged) {
      const selectedIds = next.filter(n => n.selected && !n.id.startsWith('frame__')).map(n => n.id);
      setSelectedNodes(selectedIds);
    }

    if (removals.length > 0) {
      const deletedNodeIds = new Set<string>();
      removals.forEach(change => {
        if (change.type === 'remove') {
          if (change.id.startsWith('frame__')) {
            useGraphStore.getState().removeFrame(change.id.slice(7));
          } else {
            deletedNodeIds.add(change.id);
            removeNode(change.id);
          }
        }
      });
      if (deletedNodeIds.size > 0) {
        refitFrames(deletedNodeIds);
      }
    }
  }, [setPosition, setSelectedNodes, removeNode, refitFrames]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const removals = changes.filter(c => c.type === 'remove');
    const nonRemovals = changes.filter(c => c.type !== 'remove');

    setFlowEdges(prev => applyEdgeChanges(nonRemovals, prev));

    removals.forEach(change => {
      if (change.type === 'remove') storeDisconnect(change.id);
    });
  }, [storeDisconnect]);

  const onConnect = useCallback((params: FlowConnection) => {
    connectionMadeRef.current = true;
    if (params.source && params.target && params.sourceHandle && params.targetHandle) {
      const { connections } = useGraphStore.getState();
      const existing = connections.find(
        c => c.toNode === params.target && c.toPort === params.targetHandle
      );
      if (existing) {
        storeDisconnect(existing.id);
      }
      storeConnect(params.source, params.sourceHandle, params.target, params.targetHandle);
    }
  }, [storeConnect, storeDisconnect]);

  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const onReconnect = useCallback((oldEdge: FlowEdge, newConnection: FlowConnection) => {
    edgeReconnectSuccessful.current = true;
    const { connections } = useGraphStore.getState();
    const oldConn = connections.find(c => c.id === oldEdge.id);
    if (oldConn) {
      storeDisconnect(oldConn.id);
    }
    if (newConnection.source && newConnection.target && newConnection.sourceHandle && newConnection.targetHandle) {
      storeConnect(newConnection.source, newConnection.sourceHandle, newConnection.target, newConnection.targetHandle);
    }
  }, [storeDisconnect, storeConnect]);

  const onReconnectEnd = useCallback((_: unknown, edge: FlowEdge) => {
    if (!edgeReconnectSuccessful.current) {
      storeDisconnect(edge.id);
    }
    edgeReconnectSuccessful.current = true;
  }, [storeDisconnect]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const typeId = event.dataTransfer.getData('application/reactflow');
      console.log('[Drop] typeId:', typeId);
      if (!typeId) return;
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const edges = getEdges();
      const nodes = getNodes();
      const state = useGraphStore.getState();

      const HIT_SLOP = 50;
      let closestEdge: FlowEdge | null = null;
      let minDistance = HIT_SLOP;

      for (const edge of edges) {
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);
        if (!sourceNode || !targetNode) continue;

        const sW = sourceNode.measured?.width ?? 150;
        const sH = sourceNode.measured?.height ?? 50;
        const tH = targetNode.measured?.height ?? 50;

        const sx = sourceNode.position.x + sW;
        const sy = sourceNode.position.y + sH / 2;
        const tx = targetNode.position.x;
        const ty = targetNode.position.y + tH / 2;

        const A = position.x - sx;
        const B = position.y - sy;
        const C = tx - sx;
        const D = ty - sy;
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        if (lenSq !== 0) param = dot / lenSq;
        let nearX: number, nearY: number;
        if (param < 0) { nearX = sx; nearY = sy; }
        else if (param > 1) { nearX = tx; nearY = ty; }
        else { nearX = sx + param * C; nearY = sy + param * D; }
        const dx = position.x - nearX;
        const dy = position.y - nearY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < minDistance) {
          minDistance = dist;
          closestEdge = edge;
        }
      }

      if (closestEdge && closestEdge.sourceHandle && closestEdge.targetHandle) {
        const newNodeSpec = state.nodeSpecs.find(s => s.id === typeId);
        const srcStoreNode = state.nodes.get(closestEdge.source);
        const tgtStoreNode = state.nodes.get(closestEdge.target);
        const srcSpec = srcStoreNode ? state.nodeSpecs.find(s => s.id === srcStoreNode.typeId) : null;
        const tgtSpec = tgtStoreNode ? state.nodeSpecs.find(s => s.id === tgtStoreNode.typeId) : null;

        if (newNodeSpec && srcSpec && tgtSpec) {
          const srcOutPort = srcSpec.outputs.find(o => o.name === closestEdge!.sourceHandle);
          const tgtInPort = tgtSpec.inputs.find(i => i.name === closestEdge!.targetHandle);

           if (srcOutPort && tgtInPort) {
             const matchingInput = newNodeSpec.inputs.find(i => typesCompatible(srcOutPort.ty, i.ty));
             const matchingOutput = newNodeSpec.outputs.find(o => typesCompatible(o.ty, tgtInPort.ty));

            if (matchingInput && matchingOutput) {
              try {
                const newId = await addNode(typeId, position);
                await storeDisconnect(closestEdge.id);
                await storeConnect(closestEdge.source, closestEdge.sourceHandle, newId, matchingInput.name);
                await storeConnect(newId, matchingOutput.name, closestEdge.target, closestEdge.targetHandle);
                return;
              } catch (e) {
                console.error('[Drop] Auto-insert failed:', e);
              }
            }
          }
        }
      }

      addNode(typeId, position).catch(e => {
        console.error('[Drop] addNode failed:', e);
      });
    },
    [addNode, screenToFlowPosition, getNodes, getEdges, storeConnect, storeDisconnect]
  );

  const copySelected = useCallback((cut: boolean) => {
    const selected = flowNodes.filter(n => n.selected);
    if (selected.length === 0) return;

    const minX = Math.min(...selected.map(n => n.position.x));
    const minY = Math.min(...selected.map(n => n.position.y));

    clipboardRef.current = selected.map(n => {
      const storeNode = nodesStore.get(n.id);
      return {
        typeId: n.type ?? storeNode?.typeId ?? '',
        params: storeNode ? { ...storeNode.params } : {},
        offsetX: n.position.x - minX,
        offsetY: n.position.y - minY,
      };
    });
    isCutRef.current = cut;

    if (cut) {
      selected.forEach(n => removeNode(n.id));
    }
  }, [flowNodes, nodesStore, removeNode]);

  const pasteClipboard = useCallback(async () => {
    if (clipboardRef.current.length === 0) return;

    const baseX = 100;
    const baseY = 100;

    for (const entry of clipboardRef.current) {
      const pos = { x: baseX + entry.offsetX, y: baseY + entry.offsetY };
      const newId = await addNode(entry.typeId, pos);
      for (const [key, val] of Object.entries(entry.params)) {
        await setParam(newId, key, val as any);
      }
    }

    if (isCutRef.current) {
      clipboardRef.current = [];
      isCutRef.current = false;
    }
  }, [addNode, setParam]);

  const linkToViewer = useGraphStore(s => s.linkToViewer);
  const createGroup = useGraphStore(s => s.createGroup);
  const ungroupNode = useGraphStore(s => s.ungroupNode);
  const enterGroup = useGraphStore(s => s.enterGroup);
  const exitGroup = useGraphStore(s => s.exitGroup);
  const isInsideGroup = useGraphStore(s => s.isInsideGroup);
  const toggleMuteSelected = useGraphStore(s => s.toggleMuteSelected);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: FlowNode) => {
    const isMod = _event.metaKey || _event.ctrlKey;
    if (isMod && _event.shiftKey) {
      _event.stopPropagation();

      const storeNode = nodesStore.get(node.id);
      if (!storeNode) return;
      const spec = nodeSpecs.find(s => s.id === storeNode.typeId);
      if (!spec || spec.outputs.length === 0) return;

      // Determine output index: if same node clicked again, cycle; otherwise start at 0
      let outputIndex = 0;
      if (viewerLinkRef.current && viewerLinkRef.current.nodeId === node.id) {
        outputIndex = (viewerLinkRef.current.outputIndex + 1) % spec.outputs.length;
      }

      viewerLinkRef.current = { nodeId: node.id, outputIndex };
      linkToViewer(node.id, outputIndex);
    }
  }, [nodesStore, nodeSpecs, linkToViewer]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: FlowNode) => {
    event.preventDefault();
    const selectedIds = Array.from(useGraphStore.getState().selectedNodeIds);
    const nodeIds = selectedIds.includes(node.id) ? selectedIds : [node.id];
    setContextMenu({ type: 'selection', x: event.clientX, y: event.clientY, nodeIds });
  }, []);

  const onSelectionContextMenu = useCallback((event: React.MouseEvent, nodes: FlowNode[]) => {
    event.preventDefault();
    const nodeIds = nodes.map(n => n.id);
    setContextMenu({ type: 'selection', x: event.clientX, y: event.clientY, nodeIds });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'c') {
        e.preventDefault();
        copySelected(false);
      } else if (mod && e.key === 'x') {
        e.preventDefault();
        copySelected(true);
      } else if (mod && e.key === 'v') {
        e.preventDefault();
      pasteClipboard();
    } else if (e.key === 'f' && !mod && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      const selectedIds = Array.from(useGraphStore.getState().selectedNodeIds);
      if (selectedIds.length >= 1) {
        frameSelectedNodes(getMeasuredNodeSizes());
      }
    } else if (mod && e.key === 'g' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const selectedIds = Array.from(useGraphStore.getState().selectedNodeIds);
        if (selectedIds.length >= 1) {
          createGroup(selectedIds);
        }
      } else if (mod && e.altKey && e.key === 'g') {
        e.preventDefault();
        const selectedIds = Array.from(useGraphStore.getState().selectedNodeIds);
        if (selectedIds.length === 1) {
          const node = useGraphStore.getState().nodes.get(selectedIds[0]);
          if (node && node.typeId.startsWith('group::')) {
            ungroupNode(selectedIds[0]);
          }
        }
      } else if (e.key === 'm' || e.key === 'M') {
        if (!mod) {
          e.preventDefault();
          toggleMuteSelected();
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const selectedIds = Array.from(useGraphStore.getState().selectedNodeIds);
        if (selectedIds.length === 1) {
          const node = useGraphStore.getState().nodes.get(selectedIds[0]);
          if (node && node.typeId.startsWith('group::')) {
            enterGroup(selectedIds[0]);
            return;
          }
        }
        if (isInsideGroup()) {
          exitGroup();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [copySelected, pasteClipboard, frameSelectedNodes, getMeasuredNodeSizes, createGroup, ungroupNode, enterGroup, exitGroup, isInsideGroup, toggleMuteSelected]);

  return (
    <section
      style={{ width: '100%', height: '100%', background: 'var(--bg-canvas)' }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      aria-label="Node Graph Canvas"
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onReconnectStart={onReconnectStart}
        onReconnect={onReconnect}
        onReconnectEnd={onReconnectEnd}
        onPaneClick={() => {
          selectNode(null);
          if (menuJustOpenedRef.current) {
            menuJustOpenedRef.current = false;
          } else {
            closeContextMenu();
          }
        }}
        onNodeClick={onNodeClick}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionContextMenu={onSelectionContextMenu}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode="Shift"
        selectionOnDrag
        panOnDrag={[1]}
        panOnScroll
        selectionMode={SelectionMode.Partial}
        fitView
        minZoom={0.1}
        maxZoom={2}
        snapToGrid={snapToGrid}
        snapGrid={[gridSize, gridSize]}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--bg-canvasGrid)" gap={gridSize} size={1} />
        <Controls />
        {showMinimap && <MiniMap />}
      </ReactFlow>
      {contextMenu && (
        <CanvasContextMenu
          ref={menuRef}
          menu={contextMenu}
          nodeSpecs={nodeSpecs}
          onAddNode={onAddNodeFromMenu}
          onFrameSelection={onFrameSelectionFromMenu}
          onClose={closeContextMenu}
        />
      )}

    </section>
  );
};
