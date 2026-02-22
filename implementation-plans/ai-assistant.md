# AI Assistant for Compositor

Design document for adding an AI-powered assistant that can drive the node editor via natural language.

---

## 1. Product Scope

### What the AI assistant does

The AI assistant sits in the frontend as a floating chat panel. Users type natural language instructions ("add a gaussian blur with sigma 5 and connect it to the viewer") and the assistant translates them into structured tool calls against the Zustand graph store — the same actions the UI uses. The assistant can build entire node pipelines, adjust parameters, inspect the graph, and see the current rendered output.

### What the AI assistant does NOT do

- **Load images from disk** — the agent cannot access the filesystem. It tells the user to drag an image onto a LoadImage node.
- **Run AI-powered nodes** — nodes like `ai_remove_background` call external APIs (Replicate) that cost money. The agent tells the user to click "Run."
- **See raw pixel data** — the agent receives a small JPEG thumbnail of the viewer output, not raw pixels.
- **Control node positions** — positions are handled by a deterministic auto-layout algorithm. The agent only thinks about what nodes exist and how they connect.

### Design principles

1. **Zero manual registration** — The agent's knowledge of available nodes is derived entirely from `nodeSpecs` at runtime. Add a node in Rust, register it in `register_standard_nodes()`, and the agent automatically knows about it. No frontend changes, no hardcoded node lists.
2. **Agent controls topology, not geometry** — The agent decides what nodes to create and how to connect them. A deterministic layout algorithm positions nodes based on the DAG structure.
3. **Single pass, not iterative** — The agent makes one set of changes per user message. It does not re-render and self-correct. The user asks for adjustments in follow-up messages.
4. **Same actions as the UI** — Every tool call maps to existing `graphStore` methods. No special backend APIs.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────┐
│  User Prompt                                │
│  "Add a blur and vignette to this image"    │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│  AI Agent (Claude claude-sonnet-4-6)        │
│                                             │
│  System Prompt:                             │
│   - Role & capabilities                    │
│   - Dynamic node reference (from nodeSpecs) │
│   - Connection rules & conventions          │
│                                             │
│  Tools:                                     │
│   - inspect_graph, get_node_spec, etc.      │
│   - add_node, connect, set_param, etc.      │
│                                             │
│  Vision:                                    │
│   - 512px JPEG thumbnail of viewer output   │
└─────────────┬───────────────────────────────┘
              │ tool calls
              ▼
┌─────────────────────────────────────────────┐
│  graphStore (Zustand)                       │
│  ↕ EngineBridge (WASM / Tauri IPC)          │
│  ↕ Rust Compositor Engine                   │
└─────────────────────────────────────────────┘
```

The agent lives entirely in the frontend. No Rust changes. No new backend APIs.

---

## 3. SDK & Dependencies

### Choice: Vercel AI SDK

| Option Evaluated | Browser? | Tool Calling? | Sub-agents? | Streaming? | Verdict |
|------------------|----------|---------------|-------------|------------|---------|
| **Vercel AI SDK** | Yes (custom transport) | First-class | Yes — `ToolLoopAgent` | Yes | **Winner** |
| Anthropic SDK (`@anthropic-ai/sdk`) | Yes (`dangerouslyAllowBrowser`) | Yes, `toolRunner` | No built-in | Yes | Good but limited |
| Mastra | No — requires Node.js server | Yes | Yes — agent networks | Yes | Can't use |
| LangChain.js | Partial — heavy, many Node deps | Yes | Yes | Yes | Too heavy for browser |
| Roll own | Yes | Manual | Manual | Manual | Rebuilds the wheel |

**Why Vercel AI SDK wins:**

- **`useChat` hook** — manages message state, streaming, abort, tool call lifecycle. ~300+ lines of React boilerplate avoided.
- **`onToolCall` + `addToolOutput`** — built-in client-side tool execution. The SDK handles the agentic re-submission loop via `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls`.
- **`ToolLoopAgent` + subagent pattern** — first-class concept where a subagent is wrapped as a tool. Enables future multi-agent orchestration (e.g., a planning subagent that reasons about pipeline structure before the main agent builds it).
- **Provider abstraction** — `@ai-sdk/anthropic` today, add `@ai-sdk/openai` or `@ai-sdk/google` later with one line change.
- **No server required** — the `ChatTransport` interface is pluggable. We write a custom transport that calls Anthropic's API directly (through Vite proxy in browser, direct HTTPS in Tauri).

### New packages

```
ai                    # Core: streamText, tool, ChatTransport types
@ai-sdk/react         # useChat hook
@ai-sdk/anthropic     # Anthropic provider adapter
zod                   # Tool input schemas (AI SDK uses zod for validation)
```

### Model

`claude-sonnet-4-6` — best value frontier model, excellent tool use, $3/$15 per MTok.

---

## 4. File Structure

```
apps/web/src/
  ai/
    transport.ts          # DirectAnthropicTransport (custom ChatTransport)
    tools.ts              # All tool definitions (zod schemas + execute functions)
    systemPrompt.ts       # Dynamic system prompt builder (from nodeSpecs)
    graphSnapshot.ts      # inspect_graph() serialization
    viewerSnapshot.ts     # 512px JPEG thumbnail capture
    autoLayout.ts         # Deterministic node positioning algorithm
    types.ts              # Shared AI types
  components/
    AiAssistant.tsx       # Floating chat panel (bottom of NodeCanvas)
    AiActionFeed.tsx      # Streaming action display
  store/
    settingsStore.ts      # (modify) Add anthropicApiKey, aiModel fields
    graphStore.ts         # (modify) Add beginAiAction/endAiAction for batched undo
  vite.config.ts          # (modify) Add /api/anthropic proxy
```

---

## 5. Custom Transport (No Server)

The Vercel AI SDK's default `DefaultChatTransport` hits a server API route. We don't have a server. Instead, we implement a custom `ChatTransport` that calls Anthropic directly.

```typescript
// ai/transport.ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import type { ChatTransport } from 'ai';

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

class DirectAnthropicTransport implements ChatTransport {
  constructor(private apiKey: string, private model: string = 'claude-sonnet-4-6') {}

  async sendMessages({ messages, tools, system, abortSignal }) {
    const anthropic = createAnthropic({
      apiKey: this.apiKey,
      // Tauri: direct HTTPS. Browser: Vite proxy (same pattern as Replicate)
      baseURL: isTauri() ? 'https://api.anthropic.com' : '/api/anthropic',
    });

    const result = streamText({
      model: anthropic(this.model),
      messages,
      tools,
      system,
      abortSignal,
      maxSteps: 20,
    });

    return result.toUIMessageStream();
  }
}
```

### Vite proxy addition

```typescript
// vite.config.ts — add to existing proxy config alongside Replicate
'/api/anthropic': {
  target: 'https://api.anthropic.com',
  changeOrigin: true,
  rewrite: (p) => p.replace(/^\/api\/anthropic/, ''),
},
```

---

## 6. Dynamic Node Schema Generation

The system prompt's node reference is built at runtime from `nodeSpecs` — the same array the `NodeLibrary` component uses. No hardcoded node list. When a new node is registered in Rust, `listNodeTypes()` returns it, `nodeSpecs` updates in the store, and the next AI prompt automatically includes it.

```typescript
// ai/systemPrompt.ts

function buildNodeReference(nodeSpecs: NodeSpec[]): string {
  // Group by category
  const groups: Record<string, NodeSpec[]> = {};
  for (const spec of nodeSpecs) {
    (groups[spec.category] ??= []).push(spec);
  }

  let ref = '## Available Nodes\n\n';
  ref += 'Use get_node_spec(typeId) to look up exact param names and valid ranges before setting params.\n\n';

  for (const [category, specs] of Object.entries(groups).sort()) {
    ref += `### ${category}\n`;
    for (const spec of specs) {
      // One line per node: id, display name, description, param key names
      // Full param details (ranges, types) come from get_node_spec — not here
      const paramKeys = spec.params.map(p => p.key).join(', ');
      ref += `- \`${spec.id}\` — ${spec.display_name}: ${spec.description}`;
      if (paramKeys) ref += ` [params: ${paramKeys}]`;
      ref += '\n';
    }
    ref += '\n';
  }

  return ref;
}
```

### Full system prompt structure

```typescript
function buildSystemPrompt(nodeSpecs: NodeSpec[]): string {
  return `You are an expert compositor assistant for a node-based image editor.

## What You Can Do
- Inspect the current graph and rendered output
- Add, remove, connect, disconnect, and duplicate nodes
- Set node parameters
- Insert nodes into existing connections

## What You Cannot Do
- Load images from disk (tell the user to drag an image onto a LoadImage node)
- Run AI-powered nodes (tell the user to click "Run" — these call external APIs and cost money)
- Access the filesystem

## How To Work
1. Call inspect_graph first to understand the current state
2. Call get_node_spec(typeId) before setting params — never guess param names
3. You do NOT control node positions — they are auto-laid-out based on connections
4. Always ensure the output chain connects to a Viewer node so the user sees results

${buildNodeReference(nodeSpecs)}

## Connection Rules
- Connections are typed: Image→Image, Float→Float, etc.
- An input port accepts at most ONE connection. Connecting replaces the existing one.
- No cycles allowed.
- Most image-processing nodes: "image" input → "image" output
- Compositing nodes: "foreground" + "background" inputs, or "A" + "B" inputs
- Many nodes accept an optional "mask" input for selective application

## Color Space
Color-type params use LINEAR RGBA [0..1], NOT sRGB.
Common linear values:
- 50% gray ≈ [0.214, 0.214, 0.214, 1.0]
- White = [1.0, 1.0, 1.0, 1.0]
- Black = [0.0, 0.0, 0.0, 1.0]
- Pure red = [1.0, 0.0, 0.0, 1.0]
Slider params (brightness, contrast, sigma, etc.) are NOT color values — just use the documented range.

## Tips
- When asked to "adjust" something, prefer changing existing node params over adding new nodes
- For "make it more blue": use color_balance or hue_saturation, not a tint overlay
- For "blur the background": you'll need a mask (extract_channel, chroma_key, or ai_remove_background)
- When chaining effects, connect them in series: source → effect1 → effect2 → viewer`;
}
```

---

## 7. Tool Definitions

10 tools total, split into read-only and mutation.

### Read-Only Tools

#### `inspect_graph`
Returns the current graph state. The agent calls this itself when it needs context.

```typescript
const inspectGraph = tool({
  description: 'Get the current graph state: all nodes with their non-default params, all connections, and viewer info. Call this first to understand what exists.',
  inputSchema: z.object({}),
  execute: async () => {
    // Returns GraphSnapshot — see Section 8
  },
});
```

#### `get_node_spec`
Returns the full specification of a single node type. The agent MUST call this before `set_param` to get exact param keys and valid value ranges.

```typescript
const getNodeSpec = tool({
  description: 'Get the full specification of a node type: all params with types, ranges, and defaults, all inputs and outputs with types. ALWAYS call this before set_param to verify param keys and valid ranges.',
  inputSchema: z.object({
    typeId: z.string().describe('The node type ID, e.g. "gaussian_blur"'),
  }),
  execute: async ({ typeId }) => {
    const spec = graphStore.getState().nodeSpecs.find(s => s.id === typeId);
    if (!spec) return { error: `Unknown node type: ${typeId}` };
    return spec;
  },
});
```

#### `list_node_types`
Returns a summary of all available node types. Used to discover what's available.

```typescript
const listNodeTypes = tool({
  description: 'List all available node types with IDs, names, categories, and descriptions.',
  inputSchema: z.object({}),
  execute: async () => {
    return graphStore.getState().nodeSpecs.map(s => ({
      id: s.id,
      displayName: s.display_name,
      category: s.category,
      description: s.description,
    }));
  },
});
```

### Mutation Tools

#### `add_node`
Adds a new node. Position is NOT specified — auto-layout handles it.

```typescript
const addNode = tool({
  description: 'Add a new node to the graph. Returns the new node ID. Position is handled automatically.',
  inputSchema: z.object({
    typeId: z.string().describe('Node type ID from list_node_types'),
  }),
  execute: async ({ typeId }) => {
    const nodeId = await graphStore.getState().addNode(typeId, { x: 0, y: 0 });
    return { nodeId };
  },
});
```

#### `remove_node`
Removes a node and all its connections.

```typescript
const removeNode = tool({
  description: 'Remove a node and all its connections from the graph.',
  inputSchema: z.object({
    nodeId: z.string(),
  }),
  execute: async ({ nodeId }) => {
    await graphStore.getState().removeNode(nodeId);
    autoLayoutGraph();
    return { success: true };
  },
});
```

#### `connect`
Connects an output port to an input port. Replaces any existing connection on the target input.

```typescript
const connectNodes = tool({
  description: 'Connect an output port to an input port. Replaces any existing connection on the target input. Node positions auto-update after connecting.',
  inputSchema: z.object({
    fromNode: z.string().describe('Source node ID'),
    fromPort: z.string().describe('Source output port name (e.g. "image")'),
    toNode: z.string().describe('Target node ID'),
    toPort: z.string().describe('Target input port name (e.g. "image", "mask", "foreground")'),
  }),
  execute: async ({ fromNode, fromPort, toNode, toPort }) => {
    await graphStore.getState().connect(fromNode, fromPort, toNode, toPort);
    autoLayoutGraph();
    return { success: true };
  },
});
```

#### `disconnect`
Disconnects an input port. The tool executor looks up the `connectionId` from `(toNode, toPort)` internally — the agent never sees connectionIds.

```typescript
const disconnectPort = tool({
  description: 'Disconnect the input port of a node (removes whatever is connected to it).',
  inputSchema: z.object({
    toNode: z.string().describe('Node whose input to disconnect'),
    toPort: z.string().describe('Input port name to disconnect'),
  }),
  execute: async ({ toNode, toPort }) => {
    const conn = graphStore.getState().connections.find(
      c => c.toNode === toNode && c.toPort === toPort
    );
    if (!conn) return { error: 'No connection found on that port' };
    await graphStore.getState().disconnect(conn.id);
    autoLayoutGraph();
    return { success: true };
  },
});
```

#### `set_param`
Sets a parameter value on a node.

```typescript
const setParam = tool({
  description: 'Set a parameter value on a node. Call get_node_spec first to verify the param key and valid value range.',
  inputSchema: z.object({
    nodeId: z.string(),
    paramKey: z.string().describe('Parameter key from the node spec'),
    value: z.any().describe('Value to set. Format: number for Float/Int, boolean for Bool, [r,g,b,a] for Color, string for String'),
  }),
  execute: async ({ nodeId, paramKey, value }) => {
    // Convert raw value to ParamValue tagged union format
    await graphStore.getState().setParam(nodeId, paramKey, value);
    return { success: true };
  },
});
```

#### `insert_node`
Inserts a new node into an existing connection. Compound operation: disconnect → add → connect source→new → connect new→target.

```typescript
const insertNode = tool({
  description: 'Insert a new node into an existing connection. Disconnects the old connection, adds the new node, and wires source→newNode→target. Positions auto-update.',
  inputSchema: z.object({
    typeId: z.string().describe('Type of node to insert'),
    fromNode: z.string().describe('Source node of the existing connection'),
    fromPort: z.string().describe('Source port of the existing connection'),
    toNode: z.string().describe('Target node of the existing connection'),
    toPort: z.string().describe('Target port of the existing connection'),
  }),
  execute: async ({ typeId, fromNode, fromPort, toNode, toPort }) => {
    const store = graphStore.getState();

    // 1. Disconnect existing connection
    const conn = store.connections.find(
      c => c.fromNode === fromNode && c.fromPort === fromPort
        && c.toNode === toNode && c.toPort === toPort
    );
    if (conn) await store.disconnect(conn.id);

    // 2. Add new node (position doesn't matter — auto-layout will fix it)
    const newNodeId = await store.addNode(typeId, { x: 0, y: 0 });

    // 3. Get the new node's spec to find its first input and output port names
    const spec = store.nodeSpecs.find(s => s.id === typeId);
    const firstInput = spec?.inputs?.[0]?.name ?? 'image';
    const firstOutput = spec?.outputs?.[0]?.name ?? 'image';

    // 4. Wire: source → newNode → target
    await store.connect(fromNode, fromPort, newNodeId, firstInput);
    await store.connect(newNodeId, firstOutput, toNode, toPort);

    autoLayoutGraph();
    return { nodeId: newNodeId };
  },
});
```

#### `duplicate_node`
Duplicates a node with all its current parameter values. The duplicate is not connected to anything.

```typescript
const duplicateNode = tool({
  description: 'Duplicate a node with all its current parameter values. Returns the new node ID. The duplicate is not connected to anything.',
  inputSchema: z.object({
    nodeId: z.string(),
  }),
  execute: async ({ nodeId }) => {
    const store = graphStore.getState();
    const node = store.nodes.get(nodeId);
    if (!node) return { error: 'Node not found' };

    const newNodeId = await store.addNode(node.typeId, { x: 0, y: 0 });
    for (const [key, value] of Object.entries(node.params)) {
      await store.setParam(newNodeId, key, value);
    }

    return { newNodeId };
  },
});
```

---

## 8. Graph Snapshot Format

What `inspect_graph` returns. Optimized for LLM readability — only non-default params are included to minimize token count.

```typescript
// ai/graphSnapshot.ts

interface GraphSnapshot {
  nodes: Array<{
    id: string;
    typeId: string;
    displayName: string;
    category: string;
    params: Record<string, ParamValue>;          // only non-default values
    inputDefaults: Record<string, ParamValue>;
    muted: boolean;
    connectedInputs: Record<string, {            // which inputs have connections
      fromNode: string;
      fromPort: string;
    }>;
  }>;
  connections: Array<{
    fromNode: string;
    fromPort: string;
    toNode: string;
    toPort: string;
  }>;
  viewerNodes: string[];
  renderDimensions?: { width: number; height: number };
}
```

**Key decision: no positions in the snapshot.** The agent doesn't control layout, so it doesn't need to see positions. This saves tokens and avoids the agent trying to micro-manage placement.

### Building the snapshot

```typescript
function buildGraphSnapshot(): GraphSnapshot {
  const { nodes, connections, nodeSpecs, renderResults } = graphStore.getState();

  const inputConnMap = new Map<string, { fromNode: string; fromPort: string }>();
  for (const conn of connections) {
    inputConnMap.set(`${conn.toNode}:${conn.toPort}`, {
      fromNode: conn.fromNode,
      fromPort: conn.fromPort,
    });
  }

  const snapshotNodes = [];
  const viewerNodes: string[] = [];

  for (const [id, node] of nodes) {
    const spec = nodeSpecs.find(s => s.id === node.typeId);

    // Only include non-default params
    const nonDefaultParams: Record<string, ParamValue> = {};
    if (spec) {
      for (const ps of spec.params) {
        const current = node.params[ps.key];
        if (current !== undefined && JSON.stringify(current) !== JSON.stringify(ps.default)) {
          nonDefaultParams[ps.key] = current;
        }
      }
    }

    // Build connected inputs map
    const connectedInputs: Record<string, { fromNode: string; fromPort: string }> = {};
    const allInputs = spec?.inputs ?? [];
    for (const input of allInputs) {
      const conn = inputConnMap.get(`${id}:${input.name}`);
      if (conn) connectedInputs[input.name] = conn;
    }

    snapshotNodes.push({
      id,
      typeId: node.typeId,
      displayName: spec?.display_name ?? node.typeId,
      category: spec?.category ?? 'Unknown',
      params: nonDefaultParams,
      inputDefaults: node.inputDefaults,
      muted: node.muted,
      connectedInputs,
    });

    if (node.typeId === 'viewer') viewerNodes.push(id);
  }

  // Render dimensions from first viewer
  let renderDimensions: { width: number; height: number } | undefined;
  for (const vid of viewerNodes) {
    const result = renderResults?.get(vid);
    if (result) {
      renderDimensions = { width: result.width, height: result.height };
      break;
    }
  }

  return {
    nodes: snapshotNodes,
    connections: connections.map(c => ({
      fromNode: c.fromNode,
      fromPort: c.fromPort,
      toNode: c.toNode,
      toPort: c.toPort,
    })),
    viewerNodes,
    renderDimensions,
  };
}
```

---

## 9. Vision Integration

Before each user message, if a viewer has rendered content, a 512px-wide JPEG thumbnail is captured and sent alongside the text as a multimodal message.

```typescript
// ai/viewerSnapshot.ts

const MAX_THUMBNAIL_WIDTH = 512;
const JPEG_QUALITY = 0.7;

export function captureViewerThumbnail(): string | null {
  const canvas = document.querySelector('.viewer-canvas') as HTMLCanvasElement;
  if (!canvas || canvas.width === 0) return null;

  const scale = Math.min(1, MAX_THUMBNAIL_WIDTH / canvas.width);
  const thumb = document.createElement('canvas');
  thumb.width = Math.round(canvas.width * scale);
  thumb.height = Math.round(canvas.height * scale);

  const ctx = thumb.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL('image/jpeg', JPEG_QUALITY);
}
```

Usage in the chat hook:

```typescript
// When sending a message, prepend viewer thumbnail if available
const thumbnail = captureViewerThumbnail();
sendMessage({
  role: 'user',
  parts: [
    ...(thumbnail ? [{ type: 'image', image: thumbnail }] : []),
    { type: 'text', text: userMessage },
  ],
});
```

---

## 10. Auto-Layout Algorithm

Nodes are positioned deterministically using a topological sort of the DAG. The agent never specifies positions. This algorithm runs after every AI-initiated mutation (add, connect, disconnect, insert, remove).

### Algorithm

1. **Topological sort** — arrange nodes in layers (columns) by depth from source nodes using BFS (Kahn's algorithm)
2. **Horizontal**: Each layer is one column, spaced `COLUMN_SPACING` apart
3. **Vertical**: Nodes within a column are centered vertically, spaced `ROW_SPACING` apart
4. **Unconnected nodes**: Placed in their own column at the far right

### Constants

```
COLUMN_SPACING = 300px   # horizontal distance between columns
ROW_SPACING    = 150px   # vertical distance between nodes in same column
START_X        = 100px   # left margin
START_Y        = 100px   # vertical center reference
```

### Implementation

```typescript
// ai/autoLayout.ts

export function autoLayoutGraph() {
  const { nodes, connections, setPosition } = graphStore.getState();

  // Build adjacency
  const inDegree = new Map<string, number>();
  const downstream = new Map<string, string[]>();

  for (const [id] of nodes) {
    inDegree.set(id, 0);
    downstream.set(id, []);
  }

  for (const conn of connections) {
    inDegree.set(conn.toNode, (inDegree.get(conn.toNode) ?? 0) + 1);
    downstream.get(conn.fromNode)?.push(conn.toNode);
  }

  // Kahn's algorithm — topological sort into layers
  const layers: string[][] = [];
  const nodeLayer = new Map<string, number>();
  const queue: string[] = [];

  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const layer = nodeLayer.get(current) ?? 0;

    while (layers.length <= layer) layers.push([]);
    layers[layer].push(current);
    nodeLayer.set(current, layer);

    for (const next of downstream.get(current) ?? []) {
      const nextLayer = Math.max(nodeLayer.get(next) ?? 0, layer + 1);
      nodeLayer.set(next, nextLayer);
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  // Unconnected nodes get their own layer at the end
  const unplaced: string[] = [];
  for (const [id] of nodes) {
    if (!nodeLayer.has(id)) unplaced.push(id);
  }
  if (unplaced.length) layers.push(unplaced);

  // Assign positions
  const COLUMN_SPACING = 300;
  const ROW_SPACING = 150;
  const START_X = 100;
  const START_Y = 100;

  for (let col = 0; col < layers.length; col++) {
    const layer = layers[col];
    const x = START_X + col * COLUMN_SPACING;
    const totalHeight = (layer.length - 1) * ROW_SPACING;
    const topY = START_Y - totalHeight / 2;

    for (let row = 0; row < layer.length; row++) {
      const y = topY + row * ROW_SPACING;
      setPosition(layer[row], { x, y });
    }
  }
}
```

**Important**: This only runs when the AI makes changes. User-initiated drags do NOT trigger auto-layout. The auto-layout should also only reposition nodes that the AI created or that need to move due to new connections — but for v1, repositioning everything is acceptable since the AI is building/modifying the graph as a whole.

---

## 11. Batched Undo

All mutations between `beginAiAction()` and `endAiAction()` collapse into a single undo step. Without this, a 5-node pipeline = 13+ individual undos.

### Store changes

```typescript
// Add to graphStore state:
aiActionInProgress: false,
aiActionSnapshot: null as UndoSnapshot | null,

// New actions:
beginAiAction: () => set(s => ({
  aiActionInProgress: true,
  aiActionSnapshot: captureUndoSnapshot(s),
})),

endAiAction: () => set(s => {
  if (s.aiActionSnapshot) {
    return {
      aiActionInProgress: false,
      undoStack: [...s.undoStack, s.aiActionSnapshot],
      redoStack: [],
      aiActionSnapshot: null,
      dirty: true,
    };
  }
  return { aiActionInProgress: false, aiActionSnapshot: null };
}),

// Modify existing pushUndo:
pushUndo: () => {
  if (get().aiActionInProgress) return;  // skip individual snapshots during AI action
  // ... existing logic
},
```

### Usage in AI execution flow

```typescript
// In the tool execution wrapper:
graphStore.getState().beginAiAction();

try {
  // ... all tool calls execute here ...
} finally {
  graphStore.getState().endAiAction();
}
```

---

## 12. UI Design

### Floating chat panel

The `AiAssistant` component renders inside `NodeCanvasPanel` (in `PanelComponents.tsx`), absolute-positioned at the bottom center.

```
┌─ NodeCanvas ─────────────────────────────────────────┐
│                                                       │
│  [LoadImage] ──→ [Blur σ=5] ──→ [Viewer]             │
│                                                       │
│                                                       │
│  ┌─ AI Assistant ──────────────────────────────┐      │
│  │ User: Add a vignette to the output           │      │
│  │                                              │      │
│  │ ✓ Inspected graph (3 nodes, 2 connections)  │      │
│  │ ✓ Looked up vignette node spec              │      │
│  │ ✓ Inserted Vignette between Blur → Viewer   │      │
│  │ ✓ Set strength = 0.6                         │      │
│  │                                              │      │
│  │ Done. Added a vignette with medium strength   │      │
│  │ between your blur and the viewer.             │      │
│  │                                              │      │
│  │ ┌──────────────────────────────────┐  [Send] │      │
│  │ │ Type a message... (⌘L)          │         │      │
│  │ └──────────────────────────────────┘         │      │
│  └──────────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────┘
```

### Specs

| Property | Value |
|----------|-------|
| Position | `absolute; bottom: 16px; left: 50%; transform: translateX(-50%)` |
| Width | ~560px |
| Max height | ~400px, scrollable |
| Z-index | Above React Flow canvas, below modals |
| Toggle | `Cmd+L` (macOS) / `Ctrl+L` (Windows/Linux) |
| Collapsed state | Small pill button: "✦ AI" |
| Send | Enter (Shift+Enter for newline) |

### Action feed

Each tool call renders as a compact status line in real-time as the agent streams:

- `⏳ Inspecting graph...` → `✓ Inspected graph (3 nodes, 2 connections)`
- `⏳ Looking up gaussian_blur spec...` → `✓ Looked up Gaussian Blur spec`
- `⏳ Adding Gaussian Blur...` → `✓ Added Gaussian Blur (node-abc)`
- `⏳ Setting sigma = 5.0...` → `✓ Set sigma = 5.0`
- `⏳ Connecting LoadImage → Gaussian Blur...` → `✓ Connected LoadImage → Gaussian Blur`

### Component structure

```
AiAssistant
├── AiChatHistory (scrollable)
│   ├── UserMessage (text + optional image indicator)
│   └── AssistantMessage
│       ├── TextContent (markdown-rendered)
│       └── AiActionFeed
│           ├── ActionItem (✓ / ⏳ / ✗ + description)
│           └── ...
├── AiPromptInput (textarea + send button)
└── AiStatusBar ("Ready" / "Thinking..." / "Error: ...")
```

---

## 13. Settings UI

The existing `'ai'` tab in `SettingsModal.tsx` gets a second subsection. Same tab key, updated description.

### Current structure
```
Tab: AI
Description: "Configure AI provider API keys for AI-powered nodes."
Content: Replicate API Token input + Save button
```

### New structure
```
Tab: AI
Description: "Configure API keys for AI-powered nodes and the AI assistant."
Content:
  ┌─ AI Nodes ────────────────────────────────────────┐
  │ Replicate API Token: [r8_...]                     │
  │ [Save API Key]                                     │
  └───────────────────────────────────────────────────┘

  ┌─ AI Assistant ────────────────────────────────────┐
  │ Anthropic API Key: [sk-ant-...]                   │
  │ Model: [claude-sonnet-4-6 ▾]                      │
  │ [Save]                                             │
  └───────────────────────────────────────────────────┘
```

### Settings store additions

```typescript
// In settingsStore.ts:
anthropicApiKey: string;       // persisted to localStorage
aiAssistantModel: string;      // default: 'claude-sonnet-4-6'
setAnthropicApiKey: (key: string) => void;
setAiAssistantModel: (model: string) => void;
```

Model dropdown options (extensible):
- `claude-sonnet-4-6` (default)
- `claude-opus-4-6`

---

## 14. React Integration

### useChat hook setup

```typescript
// In AiAssistant.tsx

const apiKey = useSettingsStore(s => s.anthropicApiKey);
const model = useSettingsStore(s => s.aiAssistantModel);
const nodeSpecs = useGraphStore(s => s.nodeSpecs);

const transport = useMemo(
  () => new DirectAnthropicTransport(apiKey, model),
  [apiKey, model]
);

const systemPrompt = useMemo(
  () => buildSystemPrompt(nodeSpecs),
  [nodeSpecs]
);

const { messages, sendMessage, addToolOutput, status, stop } = useChat({
  transport,
  system: systemPrompt,
  maxSteps: 20,

  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,

  onToolCall: async ({ toolCall }) => {
    const result = await executeCompositorTool(toolCall);
    addToolOutput({
      tool: toolCall.toolName,
      toolCallId: toolCall.toolCallId,
      output: JSON.stringify(result),
    });
  },
});
```

### Tool execution wrapper

```typescript
async function executeCompositorTool(toolCall: ToolCall): Promise<unknown> {
  const { toolName, args } = toolCall;

  // First tool call in a batch starts the undo group
  if (!graphStore.getState().aiActionInProgress) {
    graphStore.getState().beginAiAction();
  }

  try {
    switch (toolName) {
      case 'inspect_graph': return buildGraphSnapshot();
      case 'get_node_spec': return tools.getNodeSpec(args);
      case 'list_node_types': return tools.listNodeTypes(args);
      case 'add_node': return tools.addNode(args);
      case 'remove_node': return tools.removeNode(args);
      case 'connect': return tools.connect(args);
      case 'disconnect': return tools.disconnect(args);
      case 'set_param': return tools.setParam(args);
      case 'insert_node': return tools.insertNode(args);
      case 'duplicate_node': return tools.duplicateNode(args);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { error: String(err) };
  }
}
```

### Error handling

Tool errors are returned as structured `{ error: "..." }` objects in the tool result. The LLM sees the error and can retry with different arguments or explain the issue to the user.

Common errors:
- `"Cannot connect: type mismatch (Image → Float)"` — agent picks a different port
- `"Node not found: abc-123"` — agent re-inspects the graph
- `"Cycle detected"` — agent restructures the connection plan
- `"Unknown node type: foo"` — agent calls `list_node_types` to find the right ID

---

## 15. Race Conditions

The user can edit the graph while the AI is streaming tool calls. If the user deletes a node the AI is about to connect to, the `connect` call fails.

### Strategy for v1

Let it fail. The error is returned in the tool result, and the agent can re-inspect and recover. No graph locking needed.

### Future (v2)

Show an "AI is working..." indicator and optionally disable graph editing during AI execution. User can click "Stop" to cancel.

---

## 16. Configuration Summary

| Config | Value |
|--------|-------|
| Max steps per request | 20 |
| Model | `claude-sonnet-4-6` |
| Viewer thumbnail | 512px wide, JPEG 70% quality |
| Keyboard shortcut | `Cmd+L` / `Ctrl+L` |
| Auto-layout column spacing | 300px |
| Auto-layout row spacing | 150px |
| Undo batching | Yes, from day 1 |
| Node schema generation | Dynamic from `nodeSpecs` |
| CORS strategy | Vite proxy `/api/anthropic` (browser), direct (Tauri) |

---

## 17. Future Extensions

These are NOT in scope for v1 but the architecture supports them:

### Sub-agents (via `ToolLoopAgent`)
A planning subagent that reasons about pipeline structure before the main agent builds it. Uses read-only tools (`get_node_spec`, `list_node_types`) to plan, then returns a structured plan to the main agent.

```typescript
const plannerSubagent = new ToolLoopAgent({
  model: anthropic('claude-sonnet-4-6'),
  instructions: 'You plan compositing pipelines. Return a step-by-step plan.',
  tools: { get_node_spec, list_node_types },
});

const planTool = tool({
  description: 'Plan a complex compositing pipeline before building it',
  inputSchema: z.object({ task: z.string() }),
  execute: async ({ task }) => (await plannerSubagent.generate({ prompt: task })).text,
});
```

### Iterative self-correction
After making changes, re-render and send the new viewer thumbnail back to the agent for evaluation. "That's still too dark, increasing brightness." Requires a render→inspect→adjust loop.

### Command palette (`Cmd+K`)
Separate from the chat. A quick-action palette for common operations (add node by name, connect to viewer, etc.) — not AI-powered, just fuzzy-search over actions.

### Templates
"Set up a green screen composite" as a predefined graph that the agent can instantiate in one step.

### Multi-provider support
Add `@ai-sdk/openai` and `@ai-sdk/google` provider packages. Model dropdown in settings expands to include GPT-4o, Gemini, etc.
