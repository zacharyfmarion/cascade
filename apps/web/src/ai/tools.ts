import { tool } from 'ai';
import { z } from 'zod';
import { useGraphStore } from '../store/graphStore';
import { createParamValue, isConnectableParam } from '../store/types';
import type { NodeSpec, ParamValue } from '../store/types';
import { buildGraphSnapshot } from './graphSnapshot';
import { autoLayoutGraph } from './autoLayout';
import { captureViewerThumbnail } from './viewerSnapshot';

/**
 * Resolve a raw LLM value into a tagged ParamValue based on the param's declared type.
 * The LLM sends bare values (number, boolean, array, string); we wrap them.
 */
const resolveParamValue = (nodeId: string, paramKey: string, rawValue: unknown): ParamValue => {
  const store = useGraphStore.getState();
  const node = store.nodes.get(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);
  const spec = store.nodeSpecs.find((s: NodeSpec) => s.id === node.typeId);
  if (!spec) throw new Error(`No spec for node type: ${node.typeId}`);
  const paramSpec = spec.params.find(p => p.key === paramKey);
  if (!paramSpec) throw new Error(`Unknown param "${paramKey}" on node type "${node.typeId}"`);
  return createParamValue(paramSpec.ty, rawValue);
};

const inspectGraphSchema = z.object({});
const getNodeSpecSchema = z.object({
  typeId: z.string().describe('The node type ID, e.g. "gaussian_blur"'),
});
const listNodeTypesSchema = z.object({});
const addNodeSchema = z.object({
  typeId: z.string().describe('Node type ID from list_node_types'),
});
const removeNodeSchema = z.object({
  nodeId: z.string(),
});
const connectSchema = z.object({
  fromNode: z.string().describe('Source node ID'),
  fromPort: z.string().describe('Source output port name (e.g. "image")'),
  toNode: z.string().describe('Target node ID'),
  toPort: z.string().describe('Target input port name (e.g. "image", "mask", "foreground")'),
});
const disconnectSchema = z.object({
  toNode: z.string().describe('Node whose input to disconnect'),
  toPort: z.string().describe('Input port name to disconnect'),
});
const setParamSchema = z.object({
  nodeId: z.string(),
  paramKey: z.string().describe('Parameter key from the node spec'),
  value: z.any().describe('Raw value: number for Float/Int, boolean for Bool, [r,g,b,a] for Color, string for String'),
});
const insertNodeSchema = z.object({
  typeId: z.string().describe('Type of node to insert'),
  fromNode: z.string().describe('Source node of the existing connection'),
  fromPort: z.string().describe('Source port of the existing connection'),
  toNode: z.string().describe('Target node of the existing connection'),
  toPort: z.string().describe('Target port of the existing connection'),
});
const duplicateNodeSchema = z.object({
  nodeId: z.string(),
});
const viewCurrentImageSchema = z.object({});

type InspectGraphArgs = z.infer<typeof inspectGraphSchema>;
type GetNodeSpecArgs = z.infer<typeof getNodeSpecSchema>;
type ListNodeTypesArgs = z.infer<typeof listNodeTypesSchema>;
type AddNodeArgs = z.infer<typeof addNodeSchema>;
type RemoveNodeArgs = z.infer<typeof removeNodeSchema>;
type ConnectArgs = z.infer<typeof connectSchema>;
type DisconnectArgs = z.infer<typeof disconnectSchema>;
type SetParamArgs = z.infer<typeof setParamSchema>;
type InsertNodeArgs = z.infer<typeof insertNodeSchema>;
type DuplicateNodeArgs = z.infer<typeof duplicateNodeSchema>;
type ViewCurrentImageArgs = z.infer<typeof viewCurrentImageSchema>;

const toolExecutors = {
  inspect_graph: async (_args: InspectGraphArgs) => {
    void _args;
    return buildGraphSnapshot();
  },

  get_node_spec: async ({ typeId }: GetNodeSpecArgs) => {
    const spec = useGraphStore.getState().nodeSpecs.find((s: NodeSpec) => s.id === typeId);
    if (!spec) return { error: `Unknown node type: ${typeId}` };
    return spec;
  },

  list_node_types: async (_args: ListNodeTypesArgs) => {
    void _args;
    return useGraphStore.getState().nodeSpecs.map((s: NodeSpec) => ({
      id: s.id,
      displayName: s.display_name,
      category: s.category,
      description: s.description,
    }));
  },

  add_node: async ({ typeId }: AddNodeArgs) => {
    const nodeId = await useGraphStore.getState().addNode(typeId, { x: 0, y: 0 });
    return { nodeId };
  },

  remove_node: async ({ nodeId }: RemoveNodeArgs) => {
    await useGraphStore.getState().removeNode(nodeId);
    autoLayoutGraph();
    return { success: true };
  },

  connect: async ({ fromNode, fromPort, toNode, toPort }: ConnectArgs) => {
    // Disconnect any existing connection to the target port first
    const existing = useGraphStore.getState().connections.find(
      c => c.toNode === toNode && c.toPort === toPort
    );
    if (existing) {
      await useGraphStore.getState().disconnect(existing.id);
    }
    await useGraphStore.getState().connect(fromNode, fromPort, toNode, toPort);
    autoLayoutGraph();
    return { success: true };
  },

  disconnect: async ({ toNode, toPort }: DisconnectArgs) => {
    const conn = useGraphStore.getState().connections.find(
      c => c.toNode === toNode && c.toPort === toPort
    );
    if (!conn) return { error: 'No connection found on that port' };
    await useGraphStore.getState().disconnect(conn.id);
    autoLayoutGraph();
    return { success: true };
  },

  set_param: async ({ nodeId, paramKey, value }: SetParamArgs) => {
    const paramValue = resolveParamValue(nodeId, paramKey, value);
    const store = useGraphStore.getState();
    const node = store.nodes.get(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    const spec = store.nodeSpecs.find((s: NodeSpec) => s.id === node.typeId);
    const paramSpec = spec?.params.find(p => p.key === paramKey);

    if (paramSpec && isConnectableParam(paramSpec)) {
      await store.setInputDefault(nodeId, paramKey, paramValue);
    } else {
      await store.setParam(nodeId, paramKey, paramValue);
    }
    return { success: true };
  },

  insert_node: async ({ typeId, fromNode, fromPort, toNode, toPort }: InsertNodeArgs) => {
    const store = useGraphStore.getState();

    // 1. Disconnect existing connection
    const conn = store.connections.find(
      c => c.fromNode === fromNode && c.fromPort === fromPort
        && c.toNode === toNode && c.toPort === toPort
    );
    if (conn) await store.disconnect(conn.id);

    // 2. Add new node
    const newNodeId = await store.addNode(typeId, { x: 0, y: 0 });

    // 3. Get the new node's spec to find port names
    const spec = store.nodeSpecs.find((s: NodeSpec) => s.id === typeId);
    const firstInput = spec?.inputs?.[0]?.name ?? 'image';
    const firstOutput = spec?.outputs?.[0]?.name ?? 'image';

    // 4. Wire: source → newNode → target
    await useGraphStore.getState().connect(fromNode, fromPort, newNodeId, firstInput);
    await useGraphStore.getState().connect(newNodeId, firstOutput, toNode, toPort);

    autoLayoutGraph();
    return { nodeId: newNodeId };
  },

  view_current_image: async (_args: ViewCurrentImageArgs) => {
    void _args;
    const dataUrl = captureViewerThumbnail();
    if (!dataUrl) return { error: 'No viewer image available' };
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    return { type: 'image' as const, data: base64 };
  },

  duplicate_node: async ({ nodeId }: DuplicateNodeArgs) => {
    const store = useGraphStore.getState();
    const node = store.nodes.get(nodeId);
    if (!node) return { error: 'Node not found' };

    const newNodeId = await store.addNode(node.typeId, { x: 0, y: 0 });
    for (const [key, value] of Object.entries(node.params)) {
      await useGraphStore.getState().setParam(newNodeId, key, value);
    }

    return { newNodeId };
  },
};

export const compositorTools = {
  inspect_graph: tool({
    description: 'Get the current graph state: all nodes with their non-default params, all connections, and viewer info. Call this first to understand what exists.',
    inputSchema: inspectGraphSchema,
    execute: toolExecutors.inspect_graph,
  }),

  get_node_spec: tool({
    description: 'Get the full specification of a node type: all params with types, ranges, and defaults, all inputs and outputs with types. ALWAYS call this before set_param to verify param keys and valid ranges.',
    inputSchema: getNodeSpecSchema,
    execute: toolExecutors.get_node_spec,
  }),

  list_node_types: tool({
    description: 'List all available node types with IDs, names, categories, and descriptions.',
    inputSchema: listNodeTypesSchema,
    execute: toolExecutors.list_node_types,
  }),

  add_node: tool({
    description: 'Add a new node to the graph. Returns the new node ID. Position is handled automatically by auto-layout.',
    inputSchema: addNodeSchema,
    execute: toolExecutors.add_node,
  }),

  remove_node: tool({
    description: 'Remove a node and all its connections from the graph.',
    inputSchema: removeNodeSchema,
    execute: toolExecutors.remove_node,
  }),

  connect: tool({
    description: 'Connect an output port to an input port. Replaces any existing connection on the target input. Node positions auto-update after connecting.',
    inputSchema: connectSchema,
    execute: toolExecutors.connect,
  }),

  disconnect: tool({
    description: 'Disconnect the input port of a node (removes whatever is connected to it).',
    inputSchema: disconnectSchema,
    execute: toolExecutors.disconnect,
  }),

  set_param: tool({
    description: 'Set a parameter value on a node. Call get_node_spec first to verify the param key and valid value range. Pass the raw value: number for Float/Int, boolean for Bool, [r,g,b,a] array for Color, string for String.',
    inputSchema: setParamSchema,
    execute: toolExecutors.set_param,
  }),

  insert_node: tool({
    description: 'Insert a new node into an existing connection. Disconnects the old connection, adds the new node, and wires source→newNode→target. Positions auto-update.',
    inputSchema: insertNodeSchema,
    execute: toolExecutors.insert_node,
  }),

  duplicate_node: tool({
    description: 'Duplicate a node with all its current parameter values. Returns the new node ID. The duplicate is not connected to anything.',
    inputSchema: duplicateNodeSchema,
    execute: toolExecutors.duplicate_node,
  }),

  view_current_image: tool({
    description: 'Capture a screenshot of the current viewer output. Use this to see the result of your changes. Returns the image directly.',
    inputSchema: viewCurrentImageSchema,
    execute: toolExecutors.view_current_image,
    toModelOutput({ output }) {
      if (typeof output === 'object' && output && 'type' in output && output.type === 'image') {
        return {
          type: 'content',
          value: [{ type: 'media', data: (output as { data: string }).data, mediaType: 'image/jpeg' }],
        };
      }
      return { type: 'json', value: output };
    },
  }),
};

export type CompositorToolName = keyof typeof toolExecutors;

export async function executeCompositorTool(
  toolName: CompositorToolName,
  args: Record<string, unknown>,
): Promise<unknown> {
  const executor = toolExecutors[toolName] as (toolArgs: Record<string, unknown>) => Promise<unknown>;
  return executor(args);
}
