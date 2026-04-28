import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
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
import { LoadImageBatchNode } from './nodes/LoadImageBatchNode';
import { LoadVideoNode } from './nodes/LoadVideoNode';
import { ViewerNode } from './nodes/ViewerNode';
import { ProcessingNode } from './nodes/ProcessingNode';
import { ExportImageNode } from './nodes/ExportImageNode';
import { ExportImageSequenceNode } from './nodes/ExportImageSequenceNode';
import { ExportImageBatchNode } from './nodes/ExportImageBatchNode';
import { ExportVideoNode } from './nodes/ExportVideoNode';
import { ColorRampNode } from './nodes/ColorRampNode';
import { GroupInputNode } from './nodes/GroupInputNode';
import { GroupOutputNode } from './nodes/GroupOutputNode';
import { GroupNodeComponent } from './nodes/GroupNodeComponent';
import { GpuScriptNodeComponent } from './nodes/GpuScriptNodeComponent';
import { ColorPaletteNode } from './nodes/ColorPaletteNode';
import { CurvesNode } from './nodes/CurvesNode';
import { FrameNode } from './nodes/FrameNode';
import { withNodeErrorBoundary } from './ErrorBoundary';

const SPECIAL_NODE_TYPES: NodeTypes = {
  load_image: withNodeErrorBoundary(ImageInputNode, 'load_image'),
  load_image_sequence: withNodeErrorBoundary(LoadImageSequenceNode, 'load_image_sequence'),
  load_video: withNodeErrorBoundary(LoadVideoNode, 'load_video'),
  load_image_batch: withNodeErrorBoundary(LoadImageBatchNode, 'load_image_batch'),
  viewer: withNodeErrorBoundary(ViewerNode, 'viewer'),
  export_image: withNodeErrorBoundary(ExportImageNode, 'export_image'),
  export_image_sequence: withNodeErrorBoundary(ExportImageSequenceNode, 'export_image_sequence'),
  export_video: withNodeErrorBoundary(ExportVideoNode, 'export_video'),
  export_image_batch: withNodeErrorBoundary(ExportImageBatchNode, 'export_image_batch'),
  color_ramp: withNodeErrorBoundary(ColorRampNode, 'color_ramp'),
  color_palette: withNodeErrorBoundary(ColorPaletteNode, 'color_palette'),
  curves: withNodeErrorBoundary(CurvesNode, 'curves'),
  group_input: withNodeErrorBoundary(GroupInputNode, 'group_input'),
  group_output: withNodeErrorBoundary(GroupOutputNode, 'group_output'),
  frame: withNodeErrorBoundary(FrameNode, 'frame'),
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
   return useGraphStore.getState().typesCompatible(from, to);
 }

 const DEFAULT_EDGE_COLOR = 'var(--text-muted)';

const getGpuScriptSpecFromNode = (node: NodeInstance): NodeSpec | undefined => {
  if (!node.typeId.startsWith('gpu_script::')) return undefined;
  const manifestValue = node.params.__script_manifest;
  const manifestJson = manifestValue && 'String' in manifestValue ? manifestValue.String : undefined;
  const manifest = parseGpuScriptManifestJson(manifestJson) ?? buildDefaultGpuScriptManifest(node.typeId);
  return buildGpuScriptNodeSpec({ ...manifest, id: node.typeId });
};

const getCanvasNodeSpec = (
  node: NodeInstance,
  nodeSpecs: NodeSpec[],
  nodeSpecsById: Map<string, NodeSpec>,
): NodeSpec | undefined =>
  nodeSpecsById.get(node.id)
  ?? nodeSpecs.find(s => s.id === node.typeId)
  ?? getGpuScriptSpecFromNode(node);

interface ClipboardEntry {
  typeId: string;
  params: Record<string, ParamValue>;
  offsetX: number;
  offsetY: number;
}

import { CanvasContextMenu } from './CanvasContextMenu';
import type { ContextMenuState } from './CanvasContextMenu';
import { autoLayoutGraph, registerNodeSizeProvider, unregisterNodeSizeProvider } from '../ai/autoLayout';
import { shortcutDispatcher } from '../shortcuts/dispatcher';
import type { NodeInstance, NodeSpec, ParamValue } from '../store/types';
import {
  buildDefaultGpuScriptManifest,
  buildGpuScriptNodeSpec,
  parseGpuScriptManifestJson,
} from '../ai/gpuScript';

export const NodeCanvas: React.FC = () => {
  const nodesStore = useGraphStore(s => s.nodes);
  const framesStore = useGraphStore(s => s.frames);
  const connectionsStore = useGraphStore(s => s.connections);
  const nodeSpecs = useGraphStore(s => s.nodeSpecs);
  const nodeSpecsById = useGraphStore(s => s.nodeSpecsById);
  const { screenToFlowPosition, getNodes, getEdges, fitView } = useReactFlow();

  const nodeTypes = useMemo((): NodeTypes => {
    const types: NodeTypes = { ...SPECIAL_NODE_TYPES };
    for (const spec of nodeSpecs) {
      if (!(spec.id in types)) {
        if (spec.id.startsWith('group::')) {
          types[spec.id] = withNodeErrorBoundary(GroupNodeComponent, spec.id);
        } else if (spec.id.startsWith('gpu_script::')) {
          types[spec.id] = withNodeErrorBoundary(GpuScriptNodeComponent, spec.id);
        } else {
          types[spec.id] = withNodeErrorBoundary(ProcessingNode, spec.id);
        }
      }
    }
    for (const node of nodesStore.values()) {
      if (node.typeId in types) continue;
      if (node.typeId.startsWith('group::')) {
        types[node.typeId] = withNodeErrorBoundary(GroupNodeComponent, node.typeId);
      } else if (node.typeId.startsWith('gpu_script::')) {
        types[node.typeId] = withNodeErrorBoundary(GpuScriptNodeComponent, node.typeId);
      } else if (nodeSpecsById.has(node.id)) {
        types[node.typeId] = withNodeErrorBoundary(ProcessingNode, node.typeId);
      }
    }
    return types;
  }, [nodeSpecs, nodeSpecsById, nodesStore]);

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

  useEffect(() => {
    registerNodeSizeProvider(getMeasuredNodeSizes);
    return () => unregisterNodeSizeProvider();
  }, [getMeasuredNodeSizes]);

  // Fit viewport when navigating into/out of groups or loading a project
  const fitViewRequestId = useGraphStore(s => s.fitViewRequestId);
  const lastFitViewIdRef = useRef(fitViewRequestId);
  useEffect(() => {
    if (fitViewRequestId === lastFitViewIdRef.current) return;
    lastFitViewIdRef.current = fitViewRequestId;
    // Wait one frame for React Flow to measure the new nodes
    requestAnimationFrame(() => {
      fitView({ padding: 0.2, duration: 200 });
    });
  }, [fitViewRequestId, fitView]);

  const onCleanupNodes = useCallback(() => {
    autoLayoutGraph(getMeasuredNodeSizes());
  }, [getMeasuredNodeSizes]);

  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([]);
  const [flowEdges, setFlowEdges] = useState<FlowEdge[]>([]);
  const flowNodesRef = useRef<FlowNode[]>([]);
  // flowNodesRef keeps a stable reference for event handlers (e.g. onNodesChange)
  const dropTargetFrameId = useRef<string | null>(null);
  // Selection state tracked as regular state (not ref) so it can be
  // safely read during render in the useMemo derivation below.
  const [selectionState, setSelectionState] = useState<Map<string, boolean>>(new Map());

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
      useGraphStore.getState().pushToast('error', 'Failed to add node', e instanceof Error ? e.message : String(e));
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
      const spec = getCanvasNodeSpec(node, nodeSpecs, nodeSpecsById);
      if (!spec) return DEFAULT_EDGE_COLOR;
      const output = spec.outputs.find(o => o.name === fromPort);
      return output ? (PORT_COLORS[output.ty] ?? DEFAULT_EDGE_COLOR) : DEFAULT_EDGE_COLOR;
    },
    [nodesStore, nodeSpecs, nodeSpecsById]
  );

  // Derive flow nodes synchronously from store (no useEffect delay).
  // This prevents the useSyncExternalStore infinite-loop that occurred when
  // useEffect + setState created a perpetual one-render-behind lag during
  // rapid Zustand updates (e.g. 60fps param drags with GPU nodes).
  const derivedNodes = useMemo((): FlowNode[] => {
    const nextNodes: FlowNode[] = Array.from(nodesStore.values()).map(node => {
      const spec = getCanvasNodeSpec(node, nodeSpecs, nodeSpecsById);
      return {
        id: node.id,
        type: node.typeId,
        position: node.position,
        selected: selectionState.get(node.id) ?? false,
        data: {
          label: spec?.display_name || node.typeId,
          spec,
          params: node.params,
          inputDefaults: node.inputDefaults,
        },
      };
    });
    for (const frame of framesStore.values()) {
      const frameFlowId = `frame__${frame.id}`;
      const frameSelected = selectionState.get(frameFlowId) ?? false;
      nextNodes.push({
        id: frameFlowId,
        type: 'frame',
        position: frame.position,
        selected: frameSelected,
        zIndex: -1000 + frame.zIndex,
        style: { width: frame.size.width, height: frame.size.height },
        data: {
          label: frame.label,
          color: frame.color,
          frameId: frame.id,
          width: frame.size.width,
          height: frame.size.height,
          selected: frameSelected,
          dropTarget: false,
        },
        draggable: true,
        selectable: true,
        connectable: false,
      });
    }
    return nextNodes;
  }, [nodesStore, nodeSpecs, nodeSpecsById, framesStore, selectionState]);
  // Synchronous state reset: when store-derived nodes change, push to
  // React state immediately (during render, not after paint).  React
  // supports this pattern — it discards the stale render and restarts
  // with the updated state, avoiding the tearing loop.
  const [prevDerivedNodes, setPrevDerivedNodes] = useState(derivedNodes);
  if (prevDerivedNodes !== derivedNodes) {
    setPrevDerivedNodes(derivedNodes);
    setFlowNodes(derivedNodes);
  }

  // Same pattern for edges
  const derivedEdges = useMemo((): FlowEdge[] => {
    return connectionsStore.map(conn => ({
      id: conn.id,
      source: conn.fromNode,
      sourceHandle: conn.fromPort,
      target: conn.toNode,
      targetHandle: conn.toPort,
      type: 'default',
      reconnectable: true,
      selected: selectionState.get(conn.id) ?? false,
      style: {
        stroke: getEdgeColor(conn.fromNode, conn.fromPort),
        strokeWidth: 2,
      },
      selectable: true,
      focusable: true,
    }));
  }, [connectionsStore, getEdgeColor, selectionState]);
  const [prevDerivedEdges, setPrevDerivedEdges] = useState(derivedEdges);
  if (prevDerivedEdges !== derivedEdges) {
    setPrevDerivedEdges(derivedEdges);
    setFlowEdges(derivedEdges);
  }


  // Keep flowNodesRef in sync for event handlers that need a stable
  // reference without stale closures (e.g. onNodesChange).
  useEffect(() => { flowNodesRef.current = flowNodes; });
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

  // ── Position sync via drag handlers ──────────────────────────────────
  // Position changes are synced to the store ONLY from user-initiated drags
  // (onNodeDrag / onNodeDragStop), NOT from onNodesChange. This prevents
  // React Flow's internal node initialization from overwriting positions
  // set by programmatic layout (e.g. autoLayoutGraph after AI edits).

  const onNodeDrag = useCallback((_event: React.MouseEvent, _node: FlowNode, draggedNodes: FlowNode[]) => {
    for (const n of draggedNodes) {
      if (n.id.startsWith('frame__')) {
        // Frame dragging: move contained nodes along with the frame
        const frameId = n.id.slice(7);
        const frame = useGraphStore.getState().frames.get(frameId);
        if (frame) {
          const oldPos = frame.position;
          const newPos = n.position;
          const dx = newPos.x - oldPos.x;
            const dy = newPos.y - oldPos.y;
          if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
            const { nodes } = useGraphStore.getState();
            const flowNodeList = getNodes();
            for (const [nodeId, storeNode] of nodes) {
              const flowNode = flowNodeList.find(fn => fn.id === nodeId);
              const nw = flowNode?.measured?.width ?? 200;
              const nh = flowNode?.measured?.height ?? 100;
              const cx = storeNode.position.x + nw / 2;
              const cy = storeNode.position.y + nh / 2;
              if (
                cx >= oldPos.x &&
                cy >= oldPos.y &&
                cx <= oldPos.x + frame.size.width &&
                cy <= oldPos.y + frame.size.height
              ) {
                setPosition(nodeId, {
                  x: storeNode.position.x + dx,
                  y: storeNode.position.y + dy,
                });
              }
            }
          }
          useGraphStore.getState().updateFrame(frameId, { position: newPos });
        }
      } else {
        // Regular node: sync position to store
        setPosition(n.id, n.position);
        const nw = n.measured?.width ?? 200;
        const nh = n.measured?.height ?? 100;
        const cx = n.position.x + nw / 2;
        const cy = n.position.y + nh / 2;
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
          setFlowNodes(prev => prev.map(fn => {
            if (!fn.id.startsWith('frame__')) return fn;
            const fid = fn.id.slice(7);
            return { ...fn, data: { ...fn.data, dropTarget: fid === hitFrameId } };
          }));
        }
      }
    }
  }, [setPosition, getNodes]);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, _node: FlowNode, draggedNodes: FlowNode[]) => {
    for (const n of draggedNodes) {
      if (n.id.startsWith('frame__')) {
        useGraphStore.getState().updateFrame(n.id.slice(7), { position: n.position });
      } else {
        // Final position sync
        setPosition(n.id, n.position);

        // Refit frames that contain this node (expand or shrink to fit)
        const flowNodeList = getNodes();
        const nw = n.measured?.width ?? 200;
        const nh = n.measured?.height ?? 100;
        const droppedCx = n.position.x + nw / 2;
        const droppedCy = n.position.y + nh / 2;

        const SNAP_MARGIN = 50;
        const PADDING = 30;
        const HEADER = 28;
        const MIN_W = 200;
        const MIN_H = 150;
        const { frames, nodes } = useGraphStore.getState();

        let targetFrameId = dropTargetFrameId.current;
        if (!targetFrameId) {
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
            const containedBounds: { l: number; t: number; r: number; b: number }[] = [];

            for (const [nodeId, storeNode] of nodes) {
              const fn = flowNodeList.find(fln => fln.id === nodeId);
              const w = fn?.measured?.width ?? 200;
              const h = fn?.measured?.height ?? 100;
              const pos = nodeId === n.id ? n.position : storeNode.position;
              const pcx = pos.x + w / 2;
              const pcy = pos.y + h / 2;

              const margin = nodeId === n.id ? SNAP_MARGIN : 0;
              if (
                pcx >= frame.position.x - margin &&
                pcy >= frame.position.y - margin &&
                pcx <= frame.position.x + frame.size.width + margin &&
                pcy <= frame.position.y + frame.size.height + margin
              ) {
                containedBounds.push({ l: pos.x, t: pos.y, r: pos.x + w, b: pos.y + h });
              }
            }

            if (containedBounds.length > 0) {
              const minL = Math.min(...containedBounds.map(b => b.l));
              const minT = Math.min(...containedBounds.map(b => b.t));
              const maxR = Math.max(...containedBounds.map(b => b.r));
              const maxB = Math.max(...containedBounds.map(b => b.b));

              useGraphStore.getState().updateFrame(targetFrameId, {
                position: { x: minL - PADDING, y: minT - PADDING - HEADER },
                size: {
                  width: Math.max(MIN_W, (maxR - minL) + PADDING * 2),
                  height: Math.max(MIN_H, (maxB - minT) + PADDING * 2 + HEADER),
                },
              });
            }
          }
        }
      }
    }

    // Clear frame drop-target highlight
    setFlowNodes(prev => prev.map(fn => {
      if (!fn.id.startsWith('frame__')) return fn;
      return { ...fn, data: { ...fn.data, dropTarget: false } };
    }));
  }, [setPosition, getNodes]);
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const removals = changes.filter(c => c.type === 'remove');
    const nonRemovals = changes.filter(c => c.type !== 'remove');
    // Apply all non-removal changes to React Flow's internal state.
    // Position changes are NOT synced to the Zustand store here — that
    // happens exclusively in onNodeDrag/onNodeDragStop to avoid React
    // Flow's internal initialization from overwriting programmatic positions.
    const next = applyNodeChanges(nonRemovals, flowNodesRef.current);
    setFlowNodes(next);
    // Sync selection state so useMemo derivation preserves it
    let selectionChanged = false;
    for (const change of nonRemovals) {
      if (change.type === 'select') {
        selectionChanged = true;
        if (change.id.startsWith('frame__') && change.selected) {
          useGraphStore.getState().selectFrame(change.id.slice(7));
        }
      }
    }
    if (selectionChanged) {
      setSelectionState(prev => {
        const updated = new Map(prev);
        for (const change of nonRemovals) {
          if (change.type === 'select') {
            updated.set(change.id, change.selected);
          }
        }
        return updated;
      });
      const selectedIds = next.filter(n => n.selected && !n.id.startsWith('frame__')).map(n => n.id);
      setSelectedNodes(selectedIds);
    }
    if (removals.length > 0) {
      const deletedNodeIds = new Set<string>();
      setSelectionState(prev => {
        const updated = new Map(prev);
        removals.forEach(change => {
          if (change.type === 'remove') updated.delete(change.id);
        });
        return updated;
      });
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
  }, [setSelectedNodes, removeNode, refitFrames]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const removals = changes.filter(c => c.type === 'remove');
    const nonRemovals = changes.filter(c => c.type !== 'remove');

    // Sync edge selection state for useMemo preservation
    let edgeSelChanged = false;
    for (const change of nonRemovals) {
      if (change.type === 'select') edgeSelChanged = true;
    }
    if (edgeSelChanged || removals.length > 0) {
      setSelectionState(prev => {
        const updated = new Map(prev);
        for (const change of nonRemovals) {
          if (change.type === 'select') updated.set(change.id, change.selected);
        }
        for (const change of removals) {
          if (change.type === 'remove') updated.delete(change.id);
        }
        return updated;
      });
    }

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

  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    // Show 'copy' cursor for image file drops, 'move' for node library drags
    const hasFiles = event.dataTransfer.types.includes('Files');
    event.dataTransfer.dropEffect = hasFiles ? 'copy' : 'move';
    if (hasFiles) {
      // Clear any pending leave timer — we're still hovering
      if (dragLeaveTimer.current) {
        clearTimeout(dragLeaveTimer.current);
        dragLeaveTimer.current = null;
      }
      setIsDraggingFile(true);
    }
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    // Only hide overlay when actually leaving the canvas (not entering a child)
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    // Debounce to avoid flicker on child boundary crossings
    if (dragLeaveTimer.current) clearTimeout(dragLeaveTimer.current);
    dragLeaveTimer.current = setTimeout(() => {
      setIsDraggingFile(false);
      dragLeaveTimer.current = null;
    }, 50);
  }, []);

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setIsDraggingFile(false);
      // Handle image file drops — create a load_image node and load the file
      const files = event.dataTransfer.files;
      if (files.length > 0) {
        // Handle .compnode file drops — import custom nodes and place on canvas
        const compnodeFiles = Array.from(files).filter(f => f.name.endsWith('.compnode'));
        if (compnodeFiles.length > 0) {
          const importCustomNodes = useGraphStore.getState().importCustomNodes;
          let offsetIndex = 0;
          for (const file of compnodeFiles) {
            try {
              const text = await file.text();
              const importedIds = await importCustomNodes(text);
              // Auto-place each imported node type at the drop position
              for (const typeId of importedIds) {
                const position = screenToFlowPosition({
                  x: event.clientX + offsetIndex * 220,
                  y: event.clientY,
                });
                await addNode(typeId, position);
                offsetIndex++;
              }
            } catch (e) {
              console.error('[Drop] compnode import failed:', e);
              useGraphStore.getState().pushToast('error', 'Import failed', e instanceof Error ? e.message : String(e));
            }
          }
          return;
        }
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (imageFiles.length > 0) {
          const loadImageFile = useGraphStore.getState().loadImageFile;
          for (let i = 0; i < imageFiles.length; i++) {
            const position = screenToFlowPosition({
              x: event.clientX + i * 220,
              y: event.clientY,
            });
            try {
              const newId = await addNode('load_image', position, imageFiles[i]);
              loadImageFile(newId, imageFiles[i]);
            } catch (e) {
              console.error('[Drop] image addNode failed:', e);
              useGraphStore.getState().pushToast('error', 'Failed to add image node', e instanceof Error ? e.message : String(e));
            }
          }
          return;
        }
      }
      const typeId = event.dataTransfer.getData('application/reactflow');
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
                useGraphStore.getState().pushToast('error', 'Auto-insert failed', e instanceof Error ? e.message : String(e));
              }
            }
          }
        }
      }
      addNode(typeId, position).catch(e => {
        console.error('[Drop] addNode failed:', e);
        useGraphStore.getState().pushToast('error', 'Failed to add node', e instanceof Error ? e.message : String(e));
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
        await setParam(newId, key, val);
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
    const unregisters = [
      shortcutDispatcher.register('node.copy', () => copySelected(false)),
      shortcutDispatcher.register('node.cut', () => copySelected(true)),
      shortcutDispatcher.register('node.paste', () => { pasteClipboard(); }),
      shortcutDispatcher.register('node.frame', () => {
        const selectedIds = Array.from(useGraphStore.getState().selectedNodeIds);
        if (selectedIds.length >= 1) {
          frameSelectedNodes(getMeasuredNodeSizes());
        }
      }),
      shortcutDispatcher.register('node.group', () => {
        const selectedIds = Array.from(useGraphStore.getState().selectedNodeIds);
        if (selectedIds.length >= 1) {
          createGroup(selectedIds);
        }
      }),
      shortcutDispatcher.register('node.ungroup', () => {
        const selectedIds = Array.from(useGraphStore.getState().selectedNodeIds);
        if (selectedIds.length === 1) {
          const node = useGraphStore.getState().nodes.get(selectedIds[0]);
          if (node && node.typeId.startsWith('group::')) {
            ungroupNode(selectedIds[0]);
          }
        }
      }),
      shortcutDispatcher.register('node.mute', () => toggleMuteSelected()),
      shortcutDispatcher.register('node.tabGroup', () => {
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
      }),
    ];

    return () => unregisters.forEach(fn => fn());
  }, [copySelected, pasteClipboard, frameSelectedNodes, getMeasuredNodeSizes, createGroup, ungroupNode, enterGroup, exitGroup, isInsideGroup, toggleMuteSelected]);

  // Paste handler for clipboard images (e.g. screenshots via Cmd+V)
  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      const imageItems: DataTransferItem[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          imageItems.push(items[i]);
        }
      }
      if (imageItems.length === 0) return;

      // Don't intercept paste if user is typing in an input/textarea
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();

      const { addNode: storeAddNode, loadImageFile: storeLoadImageFile } = useGraphStore.getState();
      for (let i = 0; i < imageItems.length; i++) {
        const file = imageItems[i].getAsFile();
        if (!file) continue;
        // Place at center of current viewport
        const position = screenToFlowPosition({
          x: window.innerWidth / 2 + i * 220,
          y: window.innerHeight / 2,
        });
        try {
          const newId = await storeAddNode('load_image', position, file);
          storeLoadImageFile(newId, file);
        } catch (e) {
          console.error('[Paste] image addNode failed:', e);
          useGraphStore.getState().pushToast('error', 'Failed to add pasted image', e instanceof Error ? e.message : String(e));
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [screenToFlowPosition]);
  return (
    <section
      style={{ width: '100%', height: '100%', background: 'var(--bg-canvas)', position: 'relative' }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      aria-label="Node Graph Canvas"
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
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
        <Panel position="top-right">
          <button
            type="button"
            onClick={onCleanupNodes}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-default)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '0.75rem',
              padding: '4px 8px',
            }}
            title="Auto-arrange all nodes (left-to-right)"
          >
            Cleanup Nodes
          </button>
        </Panel>
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

      {isDraggingFile && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-overlay, rgba(0,0,0,0.4))',
            border: '3px dashed var(--accent-primary)',
            borderRadius: 8,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              color: 'var(--text-primary)',
              fontSize: '1.2rem',
              fontWeight: 600,
              padding: '12px 24px',
              background: 'var(--bg-secondary)',
              borderRadius: 8,
              border: '1px solid var(--border-default)',
            }}
          >
            Drop media or a custom node
          </div>
        </div>
      )}
    </section>
  );
};
