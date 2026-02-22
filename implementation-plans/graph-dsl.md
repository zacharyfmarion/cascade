# Graph DSL — Bidirectional Text Representation for the Node Graph

Design document for a DSL that enables the AI assistant to read and write the node graph as editable text instead of issuing imperative tool calls.

---

## 1. Motivation

The current AI assistant manipulates the graph via sequential tool calls (`add_node`, `connect`, `set_param`, etc.). This has fundamental problems:

1. **ID tracking** — The model must remember opaque IDs like `n_7kf2x` across tool call turns. One wrong ID and the whole operation breaks.
2. **Sequential dependencies** — Adding 3 nodes and connecting them requires 8+ tool calls, each depending on the result of the previous one.
3. **Poor topology comprehension** — The graph is shown as a flat JSON blob. The model can't easily reason about the DAG structure.
4. **Token inefficiency** — JSON representations of graph state are verbose and repeat structural boilerplate.

LLMs are fundamentally better at reading and editing text than at issuing imperative API calls with state tracking. A DSL gives the model a representation it can actually reason about and edit naturally.

---

## 2. Design Principles

1. **Bidirectional** — The DSL round-trips perfectly: `graph → DSL text → parse → diff → mutations → graph'`, and `serialize(graph') === DSL text'` (modulo formatting).
2. **Only non-default params** — The serializer omits params at their default values. The model only sees and sets what's different. This keeps the DSL compact and focused.
3. **Stable handles** — Each node gets a human-readable handle (`blur1`, `load1`) that persists across serialization cycles. The model reads and writes these handles, never opaque engine IDs.
4. **Declarative** — The DSL describes the desired state of the graph, not a sequence of mutations. We diff old vs. new to derive the minimal set of operations.
5. **Good error messages** — Parse and validation errors are specific and actionable. The model can self-correct from error feedback.
6. **Testable** — The parser, serializer, and differ are pure functions with well-defined inputs/outputs. Extensive unit tests can be written before any integration.

---

## 3. DSL Grammar

### 3.1 Overview

A DSL document consists of **node declarations** and **connection statements**, separated by blank lines for readability. Comments start with `#`.

```
# Load and process an image
load1 = LoadImage()
blur1 = GaussianBlur(sigma: 5.0)
grade1 = BrightnessContrast(brightness: 0.1, contrast: 1.2)
viewer = Viewer()

# Connections
blur1.image <- load1.image
grade1.image <- blur1.image
viewer.image <- grade1.image
```

### 3.2 Node Declarations

```
<handle> = <NodeType>(<param>: <value>, ...)
```

- **handle**: `[a-z][a-z0-9_]*` — lowercase identifier. The serializer auto-generates these from the node type (e.g., `gaussian_blur` → `blur1`, `blur2`, etc.). The model can use any valid handle when creating new nodes.
- **NodeType**: The node type ID exactly as registered in the engine (e.g., `GaussianBlur`, `LoadImage`, `Viewer`). Case-sensitive, uses PascalCase display name for readability. Mapped to the `spec.id` (snake_case) internally.
- **Params**: Comma-separated `key: value` pairs. Only non-default params are shown. If all params are default, the parens are empty: `Viewer()`.

### 3.3 Param Value Syntax

| Type | Syntax | Examples |
|------|--------|---------|
| Float | bare number | `sigma: 5.0`, `brightness: -0.3` |
| Int | bare integer | `width: 1920`, `iterations: 3` |
| Bool | `true` / `false` | `flip_x: true` |
| String | double-quoted | `path: "/img/photo.jpg"` |
| Color | `rgba(r, g, b, a)` | `color: rgba(1.0, 0.0, 0.0, 1.0)` |
| Dropdown | double-quoted string | `mode: "multiply"` |
| ColorRamp | `ramp(pos: rgba(...), ...)` | `stops: ramp(0.0: rgba(0,0,0,1), 1.0: rgba(1,1,1,1))` |
| CurvePoints | `curve((x,y), ...)` | `master_curve: curve((0,0), (0.5,0.5), (1,1))` |
| ColorPalette | `palette(rgba(...), ...)` | `colors: palette(rgba(1,0,0,1), rgba(0,1,0,1))` |

### 3.4 Connection Statements

```
<target_handle>.<input_port> <- <source_handle>.<output_port>
```

- Direction is **right-to-left** (data flows from source to target), matching visual convention of "target receives from source."
- Each input port can have at most one connection. If the DSL specifies a second connection to the same input, the parser reports an error.

### 3.5 Muted Nodes

Muted nodes are prefixed with `@muted`:

```
@muted blur1 = GaussianBlur(sigma: 5.0)
```

### 3.6 Comments

```
# This is a comment
blur1 = GaussianBlur(sigma: 5.0)  # Inline comments also supported
```

### 3.7 Full Grammar (EBNF-ish)

```ebnf
document       = { line } ;
line           = blank | comment | node_decl | connection ;
blank          = /^\s*$/ ;
comment        = /^\s*#.*$/ ;
node_decl      = [ "@muted" ] handle "=" node_type "(" [ param_list ] ")" [ comment ] ;
connection     = port_ref "<-" port_ref [ comment ] ;
handle         = /[a-z][a-z0-9_]*/ ;
node_type      = /[A-Za-z][A-Za-z0-9_]*/ ;
param_list     = param { "," param } ;
param          = param_key ":" param_value ;
param_key      = /[a-z][a-z0-9_]*/ ;
param_value    = number | bool | string | color | ramp | curve | palette ;
number         = /[-+]?[0-9]*\.?[0-9]+/ ;
bool           = "true" | "false" ;
string         = '"' /[^"]*/ '"' ;
color          = "rgba(" number "," number "," number "," number ")" ;
ramp           = "ramp(" ramp_stop { "," ramp_stop } ")" ;
ramp_stop      = number ":" color ;
curve          = "curve(" curve_point { "," curve_point } ")" ;
curve_point    = "(" number "," number ")" ;
palette        = "palette(" color { "," color } ")" ;
port_ref       = handle "." port_name ;
port_name      = /[a-z][a-z0-9_]*/ ;
```

---

## 4. Serializer (Graph → DSL)

### 4.1 Handle Generation

Each node needs a stable, human-readable handle. The serializer:

1. Checks if the node already has a stored handle (from a previous DSL round-trip). If so, uses it.
2. Otherwise, generates one from the node type:
   - `gaussian_blur` → `blur1` (use a short alias if defined, otherwise abbreviate)
   - If `blur1` exists, increment: `blur2`, `blur3`, etc.
   - `load_image` → `load1`, `viewer` → `viewer1` (or just `viewer` if there's only one)
3. Stores the handle→nodeId mapping in graph metadata for stability across round-trips.

**Handle alias table** (built-in, extensible):

| Node Type ID | Handle Prefix |
|---|---|
| `load_image` | `load` |
| `load_image_sequence` | `seq` |
| `viewer` | `viewer` |
| `export_image` | `export` |
| `export_image_sequence` | `export_seq` |
| `gaussian_blur` | `blur` |
| `brightness_contrast` | `grade` |
| `hue_saturation` | `huesat` |
| `color_balance` | `balance` |
| `alpha_over` | `over` |
| `blend` | `blend` |
| `solid_color` | `solid` |
| `channel_shuffle` | `shuffle` |
| `extract_channel` | `extract` |
| (default) | first word of type ID |

### 4.2 NodeType Display

The serializer maps `spec.id` (snake_case) to PascalCase for readability:
- `gaussian_blur` → `GaussianBlur`
- `brightness_contrast` → `BrightnessContrast`
- `load_image` → `LoadImage`

The parser reverses this mapping when looking up node types.

### 4.3 Param Serialization

- Only non-default params are serialized (comparing current value to `spec.params[].default`).
- For promotable params (connectable), serialize the `inputDefault` value if it differs from spec default.
- Floats are formatted to reasonable precision (strip trailing zeros, max 4 decimal places).
- Colors use `rgba(r, g, b, a)` with values in [0, 1].

### 4.4 Connection Serialization

- Connections are grouped after all node declarations, separated by a blank line.
- Sorted topologically or by target handle for deterministic output.

### 4.5 Ordering

Nodes are serialized in topological order (sources first, sinks last). This makes the data flow readable top-to-bottom.

### 4.6 Example Output

Given a graph with: LoadImage → GaussianBlur(sigma=5) → BrightnessContrast(brightness=0.1) → Viewer

```
load1 = LoadImage()
blur1 = GaussianBlur(sigma: 5.0)
grade1 = BrightnessContrast(brightness: 0.1)
viewer = Viewer()

blur1.image <- load1.image
grade1.image <- blur1.image
viewer.image <- grade1.image
```

---

## 5. Parser (DSL → AST)

### 5.1 AST Types

```typescript
interface DslAst {
  nodes: Map<string, DslNode>;        // handle → node
  connections: DslConnection[];
}

interface DslNode {
  handle: string;
  nodeType: string;                    // PascalCase as written
  nodeTypeId: string;                  // snake_case resolved from registry
  params: Map<string, DslParamValue>;
  muted: boolean;
  line: number;                        // source line for error reporting
}

type DslParamValue =
  | { type: 'float'; value: number }
  | { type: 'int'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'string'; value: string }
  | { type: 'color'; value: [number, number, number, number] }
  | { type: 'ramp'; value: { position: number; color: [number, number, number, number] }[] }
  | { type: 'curve'; value: { x: number; y: number }[] }
  | { type: 'palette'; value: [number, number, number, number][] };

interface DslConnection {
  fromHandle: string;
  fromPort: string;
  toHandle: string;
  toPort: string;
  line: number;
}
```

### 5.2 Parsing Strategy

The parser is **line-oriented** — each non-blank, non-comment line is either a node declaration or a connection statement. No multi-line constructs (except params with complex values like `ramp(...)` which can span multiple lines if wrapped — but we'll start with single-line only and add multi-line later if needed).

**Steps:**
1. Split input into lines, trim whitespace, strip comments.
2. For each non-empty line, attempt to match as:
   - Node declaration: regex `^(@muted\s+)?([a-z]\w*)\s*=\s*([A-Z]\w*)\((.*)\)$`
   - Connection: regex `^([a-z]\w*)\.(\w+)\s*<-\s*([a-z]\w*)\.(\w+)$`
3. Parse param values from the param string using a small recursive-descent parser (needed for nested `rgba()`, `ramp()`, `curve()` syntax).
4. Resolve `NodeType` (PascalCase) → `spec.id` (snake_case) using the node registry.
5. Return the AST or a list of parse errors with line numbers.

### 5.3 Type Inference for Params

The parser uses the node spec to determine expected types:
1. Look up the node type in the registry.
2. For each param key, find the matching `ParamSpec`.
3. Parse the value according to `ParamSpec.ty`:
   - If spec says `Float` and value looks like a number → `{ type: 'float', value }`.
   - If spec says `Int` and value looks like a number → `{ type: 'int', value: Math.round(value) }`.
   - If value doesn't match expected type → error with suggestion.
4. If param key doesn't exist in spec → error listing valid param keys.

---

## 6. Differ (Old AST vs. New AST → Mutations)

### 6.1 Design

The differ compares two ASTs — the **current graph** (serialized to AST) and the **desired graph** (parsed from LLM output) — and produces a minimal ordered list of graph mutations.

### 6.2 Diffing Algorithm

```
Input:  oldAst (from current graph), newAst (from LLM output)
Output: ops[] (ordered list of mutations)

1. Build maps: oldNodes = Map<handle, DslNode>, newNodes = Map<handle, DslNode>
   Build sets: oldConns = Set<string>, newConns = Set<string>
   (connection key = "fromHandle.fromPort->toHandle.toPort")

2. Removed nodes:    handles in oldNodes but not in newNodes
3. Added nodes:      handles in newNodes but not in oldNodes
4. Preserved nodes:  handles in both — check for param changes
5. Removed connections: keys in oldConns but not in newConns
6. Added connections:   keys in newConns but not in oldConns

Apply in order:
  a. Disconnect removed connections
  b. Remove removed nodes (also disconnects their remaining connections)
  c. Add new nodes (with params)
  d. Update params on preserved nodes (only changed params)
  e. Connect added connections
  f. Update muted state on preserved nodes
```

### 6.3 Handle Stability

The handle is the **identity key** for diffing. This is why stable handles matter:

- If the LLM keeps `blur1` in its output, we know it's the same node — just check if params changed.
- If the LLM removes `blur1` and adds `sharpen1`, we know to delete the blur and add a sharpen.
- If the LLM renames `blur1` to `blur_main`, we treat it as remove + add (the node type and params may match, but the handle changed). This is acceptable because handle renames are rare.

### 6.4 Mutation Types

```typescript
type GraphMutation =
  | { type: 'addNode'; handle: string; typeId: string; params: Map<string, DslParamValue>; muted: boolean }
  | { type: 'removeNode'; handle: string }
  | { type: 'setParam'; handle: string; paramKey: string; value: DslParamValue }
  | { type: 'connect'; fromHandle: string; fromPort: string; toHandle: string; toPort: string }
  | { type: 'disconnect'; toHandle: string; toPort: string }
  | { type: 'setMuted'; handle: string; muted: boolean };
```

### 6.5 Applying Mutations

The mutation executor translates handles to engine node IDs using the stored handle→id map:

```typescript
async function applyMutations(mutations: GraphMutation[], handleMap: Map<string, string>): Promise<ApplyResult> {
  const store = useGraphStore.getState();
  for (const mut of mutations) {
    switch (mut.type) {
      case 'addNode': {
        const nodeId = await store.addNode(mut.typeId, { x: 0, y: 0 });
        handleMap.set(mut.handle, nodeId);
        // set params...
        break;
      }
      case 'removeNode': {
        const nodeId = handleMap.get(mut.handle);
        await store.removeNode(nodeId);
        handleMap.delete(mut.handle);
        break;
      }
      // ... etc
    }
  }
  autoLayoutGraph();
  return { success: true, updatedDsl: serialize(graph) };
}
```

---

## 7. Validation

After parsing and before diffing, validate the desired AST:

### 7.1 Validation Checks

| Check | Error Message |
|-------|---------------|
| Unknown node type | `Line 3: Unknown node type "GausianBlur". Did you mean "GaussianBlur"?` |
| Unknown param key | `Line 3: Unknown param "sigam" on GaussianBlur. Valid params: sigma, border_mode` |
| Wrong param type | `Line 3: Param "sigma" expects a number, got "high"` |
| Param out of range | `Line 3: Param "sigma" must be between 0.0 and 100.0, got 500.0` |
| Duplicate handle | `Line 5: Handle "blur1" already declared on line 2` |
| Unknown handle in connection | `Line 8: Unknown node "blurr1". Did you mean "blur1"?` |
| Unknown port | `Line 8: Node "blur1" (GaussianBlur) has no input port "img". Valid inputs: image, mask` |
| Duplicate input connection | `Line 9: Input "blur1.image" already connected on line 8` |
| Type mismatch on connection | `Line 8: Cannot connect Float output to Image input` |
| Cycle detected | `Line 10: Connection creates a cycle: blur1 → grade1 → blur1` |

### 7.2 Fuzzy Matching

For unknown node types and param keys, use Levenshtein distance to suggest corrections. This helps the model self-correct in the next turn.

### 7.3 Validation Result

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  line: number;
  message: string;
  suggestion?: string;   // "Did you mean ...?"
}

interface ValidationWarning {
  line: number;
  message: string;       // e.g., "Node blur1 has no connections"
}
```

---

## 8. Integration with AI Assistant

### 8.1 Tool Interface

Replace the current 11 imperative tools with 5 tools modeled after Claude Code's file editing pattern:

| Tool | Args | Description |
|------|------|-------------|
| `read_graph` | none | Returns the current graph serialized as DSL text. |
| `edit_graph` | `old_text: string, new_text: string` | Find `old_text` in the current DSL and replace with `new_text`. The resulting full DSL is parsed, validated, diffed against the current graph, and applied atomically. Returns the updated DSL or validation errors. |
| `write_graph` | `dsl: string` | Replace the entire graph with new DSL. For building from scratch or major restructuring. Same parse → validate → diff → apply pipeline as `edit_graph`. |
| `view_current_image` | none | Capture viewer thumbnail (unchanged from current implementation). |
| `get_node_types` | none | List all available node types with their params (keys, types, ranges, defaults), inputs, and outputs. Replaces `list_node_types` + `get_node_spec`. |

### 8.2 Tool Details

#### `read_graph`

Returns the full graph as DSL text. For typical graphs (5-50 nodes), this is 10-60 lines — always fits comfortably in context. No pagination needed.

```
// Tool result:
{
  "graph": "load1 = LoadImage()\nblur1 = GaussianBlur(sigma: 5.0)\nviewer = Viewer()\n\nblur1.image <- load1.image\nviewer.image <- blur1.image"
}
```

#### `edit_graph`

String replacement on the current DSL, inspired by Claude Code's Edit tool. The model specifies what to find and what to replace it with.

**Pipeline:** current DSL → string replace `old_text` with `new_text` → parse full result → validate → diff against current graph → apply mutations atomically → re-serialize → return updated DSL.

If `old_text` is not found in the current DSL, return an error with the current DSL so the model can see what's actually there.

**Example — change a param:**
```
edit_graph(
  old_text: "blur1 = GaussianBlur(sigma: 5.0)",
  new_text: "blur1 = GaussianBlur(sigma: 15.0)"
)
```

**Example — insert a node between two existing nodes:**
```
edit_graph(
  old_text: "viewer.image <- blur1.image",
  new_text: "sharpen1 = Sharpen(amount: 0.5)\nsharpen1.image <- blur1.image\nviewer.image <- sharpen1.image"
)
```

**Example — remove a node (delete its declaration and rewire connections):**
```
edit_graph(
  old_text: "blur1 = GaussianBlur(sigma: 5.0)\n\nblur1.image <- load1.image\nviewer.image <- blur1.image",
  new_text: "viewer.image <- load1.image"
)
```

**Error — old_text not found:**
```json
{
  "success": false,
  "error": "old_text not found in current graph",
  "current_graph": "load1 = LoadImage()\n..."
}
```

**Error — parse/validation failure after replacement:**
```json
{
  "success": false,
  "errors": [
    { "line": 3, "message": "Unknown param \"sigam\" on GaussianBlur. Valid params: sigma, border_mode" }
  ]
}
```

#### `write_graph`

Replaces the entire graph. Used when building from scratch or making sweeping changes where edit_graph would be awkward.

**Pipeline:** parse input DSL → validate → diff against current graph (which may be empty) → apply mutations → re-serialize → return.

```
write_graph(dsl: `
  load1 = LoadImage()
  blur1 = GaussianBlur(sigma: 5.0)
  grade1 = BrightnessContrast(brightness: 0.1)
  viewer = Viewer()

  blur1.image <- load1.image
  grade1.image <- blur1.image
  viewer.image <- grade1.image
`)
```

### 8.3 System Prompt Changes

The system prompt will include:

1. **DSL syntax reference** — Concise grammar description with examples of node declarations, connections, and param types.
2. **Current graph** — The serialized DSL of the current graph state, included in every message context.
3. **Available node types** — Formatted to match DSL conventions (PascalCase names, param keys with types and ranges).
4. **Tool usage instructions:**
   - Use `read_graph` to see the current graph state.
   - Use `edit_graph(old_text, new_text)` for targeted changes — preferred for most edits.
   - Use `write_graph(dsl)` to build a graph from scratch or for major restructuring.
   - Use `view_current_image` to see the rendered result.
   - Use `get_node_types` to look up available nodes, param names, and valid ranges.

### 8.4 Workflow Examples

**Before (tool calls) — 6 calls, multiple round trips:**
1. `inspect_graph` → JSON blob
2. `get_node_spec("gaussian_blur")` → spec
3. `add_node("gaussian_blur")` → ID
4. `connect(...)` → success
5. `set_param(...)` → success
6. `set_param(...)` → success

**After (DSL edit) — 1 call:**
```
edit_graph(
  old_text: "viewer.image <- load1.image",
  new_text: "blur1 = GaussianBlur(sigma: 5.0)\nblur1.image <- load1.image\nviewer.image <- blur1.image"
)
```

**Incremental edit — 1 call:**

User: "Make the blur stronger"
```
edit_graph(
  old_text: "blur1 = GaussianBlur(sigma: 5.0)",
  new_text: "blur1 = GaussianBlur(sigma: 15.0)"
)
```

**Build from scratch — 1 call:**

User: "Create a pipeline that loads an image, blurs it, adjusts brightness, and shows the result"
```
write_graph(dsl: `
  load1 = LoadImage()
  blur1 = GaussianBlur(sigma: 3.0)
  grade1 = BrightnessContrast(brightness: 0.1, contrast: 1.2)
  viewer = Viewer()

  blur1.image <- load1.image
  grade1.image <- blur1.image
  viewer.image <- grade1.image
`)
```

### 8.5 Error Recovery

If `edit_graph` or `write_graph` returns errors:
```json
{
  "success": false,
  "errors": [
    { "line": 3, "message": "Unknown param \"sigam\" on GaussianBlur. Valid params: sigma, border_mode" }
  ]
}
```

The model sees the error, fixes the typo, and calls `edit_graph` again. This is a natural loop — it's just fixing code based on compiler errors, which is what LLMs do best.

---

## 9. Handle Storage

### 9.1 Where Handles Live

Handles are stored as metadata on the graph, not on individual nodes. This keeps the Rust engine clean.

```typescript
// In graphStore or a separate DSL store
interface HandleMap {
  nodeIdToHandle: Map<string, string>;   // engine ID → handle
  handleToNodeId: Map<string, string>;   // handle → engine ID
}
```

### 9.2 Handle Lifecycle

- **Created** when a node is first serialized to DSL (auto-generated) or when the LLM adds a node via DSL (LLM-chosen handle).
- **Preserved** across DSL round-trips — the serializer always uses the existing handle.
- **Deleted** when a node is removed from the graph.
- **Never reused** — if `blur1` is deleted and a new blur is added, it becomes `blur2`.

### 9.3 Manual Node Creation

When the user adds a node via the UI (not the AI), it won't have a handle yet. The serializer assigns one on first serialization. This means handles are always available when the AI interacts with the graph, regardless of how nodes were created.

---

## 10. Why TypeScript, Not Rust/WASM

The entire DSL engine (parser, serializer, differ, validator, executor) is implemented in TypeScript. Here's why:

### The DSL layer sits between two JS systems

```
LLM (via AI SDK, JS) → DSL Engine → graphStore (Zustand, JS)
```

Both the input (LLM text from AI SDK) and the output (graphStore mutation calls) are JavaScript. Putting the DSL engine in Rust/WASM would mean:

1. **Serializing nodeSpecs across the WASM boundary** — The validator needs `nodeSpecs` to check param names, types, and ranges. These are already deserialized and available in the Zustand store. Passing them to WASM means re-serializing to JSON, crossing the boundary, deserializing in Rust, then serializing the result back.
2. **Calling graphStore from Rust** — The executor needs to call `store.addNode()`, `store.setParam()`, `store.connect()`, etc. These are JS/Zustand methods. You can't call them from Rust — you'd have to return a mutation list from WASM and apply it in JS anyway, which is exactly what the TS executor does.
3. **No shared types needed** — The DSL's AST types (`DslNode`, `DslParamValue`) are intentionally separate from both the Rust engine types and the TS store types. The executor maps between them. There's no type-sharing benefit.

### What Rust has that we'd reimplement

The only non-trivial logic the Rust engine has that we'd reuse is **cycle detection**. But cycle detection on a DAG is ~20 lines of DFS — trivial to implement in TS and easy to unit test.

### Performance is irrelevant

Parsing and diffing 50 lines of text takes microseconds in any language. The bottleneck is the LLM response time (seconds), not DSL processing.

### Testability

Pure TypeScript functions are tested with Vitest, which is already set up in the frontend project. No WASM build step, no cross-compilation, instant test feedback.

---

## 11. Test Plan

The parser, serializer, and differ are pure functions — ideal for extensive unit testing.

### 11.1 Parser Tests

**Basic parsing:**
- Empty document → empty AST
- Single node, no params: `viewer = Viewer()` → `{ handle: "viewer", nodeType: "Viewer", params: {} }`
- Single node with float param: `blur1 = GaussianBlur(sigma: 5.0)`
- Single node with int param: `resize1 = Resize(width: 1920)`
- Single node with bool param: `flip1 = Flip(flip_x: true)`
- Single node with string param: `load1 = LoadImage(path: "/img/photo.jpg")`
- Single node with color param: `solid1 = SolidColor(color: rgba(1.0, 0.0, 0.0, 1.0))`
- Single node with multiple params: `grade1 = BrightnessContrast(brightness: 0.1, contrast: 1.5)`
- Muted node: `@muted blur1 = GaussianBlur(sigma: 5.0)`
- Connection: `blur1.image <- load1.image`
- Comments: `# this is a comment`
- Inline comments: `blur1 = GaussianBlur(sigma: 5.0) # soften`
- Multiple nodes and connections (full graph)

**Complex param types:**
- ColorRamp: `stops: ramp(0.0: rgba(0,0,0,1), 1.0: rgba(1,1,1,1))`
- CurvePoints: `master_curve: curve((0,0), (0.25,0.3), (0.75,0.7), (1,1))`
- ColorPalette: `colors: palette(rgba(1,0,0,1), rgba(0,1,0,1), rgba(0,0,1,1))`

**Error cases:**
- Invalid handle (starts with uppercase): `Blur1 = GaussianBlur()` → error
- Missing parens: `blur1 = GaussianBlur` → error
- Unknown node type: `blur1 = GausianBlur()` → error with suggestion
- Duplicate handle: two lines with same handle → error
- Malformed param value: `sigma: abc` → error
- Unclosed string: `path: "/img/photo.jpg` → error
- Unparseable line → error with line number

### 11.2 Serializer Tests

- Empty graph → empty string
- Single viewer node → `viewer = Viewer()`
- Node with non-default param → includes param
- Node with default param → omits param
- Node with promotable param at non-default → serializes from inputDefaults
- Muted node → `@muted` prefix
- Connections sorted deterministically
- Nodes in topological order
- Multiple nodes of same type → unique handles (`blur1`, `blur2`)
- Handle stability: serialize → parse → re-serialize → same output

### 11.3 Differ Tests

**No changes:**
- Same AST in and out → empty mutations list

**Adding nodes:**
- Add one node → `[{ type: 'addNode', handle: 'blur1', typeId: 'gaussian_blur', ... }]`
- Add node with connections → addNode + connect mutations

**Removing nodes:**
- Remove one node → `[{ type: 'removeNode', handle: 'blur1' }]`
- Remove node with connections → disconnect + removeNode

**Changing params:**
- Change one param → `[{ type: 'setParam', handle: 'blur1', paramKey: 'sigma', value: 10.0 }]`
- Add a param (was default, now non-default) → setParam
- Remove a param (back to default) → setParam with default value

**Changing connections:**
- Rewire: A→B to A→C → disconnect B + connect C
- Add connection → connect
- Remove connection → disconnect

**Complex scenarios:**
- Insert node between two existing nodes (add node, rewire connections)
- Replace one node with different type (remove old, add new, rewire)
- Reorder nodes in DSL (should produce NO mutations — order is cosmetic)
- Change handle of existing node (treated as remove + add — by design)

**Mute changes:**
- Mute a node → `[{ type: 'setMuted', handle: 'blur1', muted: true }]`
- Unmute a node → `[{ type: 'setMuted', handle: 'blur1', muted: false }]`

### 11.4 Validation Tests

- Unknown node type → error with "did you mean?" suggestion
- Unknown param key → error listing valid keys
- Param value out of range → error with valid range
- Connection to unknown port → error listing valid ports
- Connection type mismatch → error
- Cycle detection → error describing the cycle
- Duplicate input connection → error
- Unconnected node (no inputs or outputs) → warning (not error)
- Node with no viewer downstream → warning

### 11.5 Round-Trip Tests

- Serialize a graph → parse it → diff against original → 0 mutations
- Serialize → parse → re-serialize → identical output
- Multiple round-trips → stable (no drift)
- Graph with every param type → round-trips correctly
- Graph with muted nodes → round-trips correctly

### 11.6 Edit Tool Tests

- `edit_graph` with valid old_text and new_text → applies correctly
- `edit_graph` where old_text not found → returns error with current DSL
- `edit_graph` where old_text appears multiple times → error (ambiguous)
- `edit_graph` that produces invalid DSL → returns parse errors
- `edit_graph` that would create a cycle → returns validation error
- `write_graph` on empty graph → creates all nodes and connections
- `write_graph` on existing graph → diffs and applies minimal mutations
- `write_graph` with empty string → removes all nodes

### 11.7 Integration Tests

- LLM-like edit: change one param via `edit_graph` → verify graph state
- LLM-like insert: add node between two existing ones via `edit_graph` → verify graph state
- LLM-like build: create full pipeline via `write_graph` → verify graph state
- LLM-like input with typo → validate error message quality
- Large graph (20+ nodes) → serializes, parses, diffs correctly
- Empty graph → model creates full pipeline from scratch
- Model removes all nodes → graph is empty

---

## 12. Implementation Plan

### Phase 1: Core DSL Engine (pure functions, fully tested)

1. **`dsl/types.ts`** — AST type definitions, mutation types
2. **`dsl/serializer.ts`** — Graph → DSL text (+ handle generation/storage)
3. **`dsl/parser.ts`** — DSL text → AST (line-oriented parser with recursive descent for nested values)
4. **`dsl/differ.ts`** — Old AST vs. New AST → mutations list
5. **`dsl/validator.ts`** — AST → validation errors/warnings (type checking, port checking, cycle detection)
6. **`dsl/executor.ts`** — Mutations → graphStore calls (handle→ID resolution, promotable param handling)
7. **`dsl/handleMap.ts`** — HandleMap class with auto-generation, prefix aliases, persistence
8. **`dsl/__tests__/`** — Comprehensive unit tests for all of the above

### Phase 2: AI Integration

9. **New `tools.ts`** — Replace 11 tools with `read_graph`, `edit_graph`, `write_graph`, `view_current_image`, `get_node_types`
10. **New `systemPrompt.ts`** — DSL syntax reference, current graph in DSL format, tool usage instructions
11. **Update `transport.ts`** — Adjust for new tool set
12. **Remove `graphSnapshot.ts`** — Replaced by DSL serializer

### Phase 3: Polish

13. Handle storage persistence in graphStore (survives page reload)
14. Multi-line param support (if needed for complex ColorRamp/CurvePoints)
15. DSL syntax highlighting in the chat UI (optional, low priority)

---

## 13. Open Questions

1. **PascalCase vs snake_case for node types in DSL?** Current design uses PascalCase (`GaussianBlur`) for readability, mapped to snake_case (`gaussian_blur`) internally. Alternative: use snake_case everywhere to eliminate the mapping layer. PascalCase is more readable; snake_case is simpler. **Recommendation: PascalCase** — the mapping is trivial and readability matters for the LLM.

2. **Group nodes?** Groups have internal subgraphs. For now, treat them as opaque nodes with their exposed params/ports. The DSL doesn't represent the internal graph of a group. This can be extended later with a `group { ... }` syntax if needed.

3. **Code view in the editor UI?** The DSL serializer/parser would enable a "code view" toggle where users see and edit the DSL directly. Out of scope for now but architecturally free once the DSL engine exists.

4. **What if `old_text` appears multiple times in `edit_graph`?** Return an error asking the model to provide more context (more surrounding lines) to make the match unambiguous. Same approach as Claude Code's Edit tool.
