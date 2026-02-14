# Background Render Refactor Plan

## Problem
`render_sequence` holds `Mutex<AppState>` for the entire render (all frames), blocking all IPC commands and freezing the UI.

## Solution
Snapshot the graph state at render start, run the render against the snapshot on a background thread. Main engine stays fully interactive.

## Architecture

```
Main Engine (interactive)          Background Render
├── graph: Graph (owned)           ├── graph: Graph (cloned at start)
├── evaluator: Evaluator (owned)   ├── evaluator: Evaluator (fresh)
├── nodes: HashMap<Arc<dyn Node>>  ─── nodes: HashMap<Arc<dyn Node>> (cloned Arcs)
├── registry: Arc<NodeRegistry>  ────── registry: Arc<NodeRegistry> (shared ref)
└── gpu_context: Option<Arc<...>>  ─── (shared if needed)
```

## Implementation Plan

### Layer 1: Core Types (`compositor-core`)

**`crates/compositor-core/src/graph.rs`**
- Derive `Clone` on `Graph`, `NodeInstance`, `Connection`

**`crates/compositor-core/src/eval.rs`**
- Change `evaluate()` signature: `node_instances: &HashMap<NodeId, Arc<dyn Node>>`

**`crates/compositor-core/src/node.rs`**
- `NodeRegistry.factories`: `Arc<dyn Fn() -> Arc<dyn Node> + Send + Sync>`
- `NodeRegistry.create()` returns `Option<Arc<dyn Node>>`

### Layer 2: Node Implementations (`compositor-nodes-std`)

**`crates/compositor-nodes-std/src/lib.rs`**
- All factory closures return `Arc<dyn Node>` instead of `Box<dyn Node>`

### Layer 3: Runtime Engine (`compositor-runtime`)

**`crates/compositor-runtime/src/lib.rs`**

Engine struct:
```rust
pub struct Engine {
    graph: Graph,
    registry: Arc<NodeRegistry>,
    nodes: HashMap<NodeId, Arc<dyn Node>>,
    evaluator: Evaluator,
    gpu_context: Option<Arc<GpuContext>>,
    // ... rest unchanged
}
```

`start_render_sequence` refactored to:
1. Read params, validate output_dir exists
2. Clone graph, nodes map (Arc bumps), Arc::clone registry
3. Create fresh Evaluator
4. Create RenderJob with atomics
5. Return job_id immediately
6. `tokio::task::spawn_blocking` with cloned state for frame loop
7. Wrap frame loop in `catch_unwind` for panic safety
8. Use `Ordering::Release` when setting `completed`, `Ordering::Acquire` when reading

### Layer 4: GPU Nodes (`compositor-gpu`)
- `register_gpu_nodes` — factories return `Arc<dyn Node>`

### Layer 5: Group Nodes (`compositor-nodes-std/src/group.rs`)
- `GroupNodeState.internal_nodes`: `HashMap<NodeId, Arc<dyn Node>>`
- Internal evaluator calls updated

### Layer 6: Tauri Commands (`apps/tauri/src-tauri/src/lib.rs`)
- `render_sequence` returns job_id immediately (spawn happens inside engine)

### Layer 7: Frontend Store (`apps/web/src/store/graphStore.ts`)
- `renderSequence` action:
  1. Call `eng.renderSequence(nodeId)` → get job_id
  2. Set `isRendering = true`
  3. Poll `eng.getJobProgress()` every ~250ms
  4. Update `renderProgress` each poll
  5. On completed/error → clear interval, set `isRendering = false`

### Layer 8: Frontend UI
- `ExportImageSequenceNode.tsx`: disable controls when `isRendering`
- `LoadImageSequenceNode.tsx`: disable directory picker when `isRendering`
- Show toast if user tries to load image during render

### Layer 9: WASM Engine (`compositor-wasm`)
- Same `Box<dyn Node>` → `Arc<dyn Node>` for compilation

## Error Handling
- Frame evaluation failure → stored in `job.error`, loop breaks, frontend reads via polling
- Thread panic → `catch_unwind` converts to error, sets `job.error` + `job.completed`
- Cancel → `job.cancelled` atomic checked each frame
- Upfront validation of output_dir before spawning
- Ordering: write error before setting completed (Release/Acquire)

## Performance
- Snapshot cost: negligible (Arc bumps + small Graph clone)
- Per-frame: identical to current approach
- Polling: ~4 IPC calls/sec, trivially fast
- Memory: shared Arc<dyn Node>, fresh evaluator cache dropped on completion

## Execution Order
1. Core types (Graph Clone, eval signature, NodeRegistry Arc)
2. Node registrations (Box → Arc) — mechanical
3. GroupNode internals
4. Runtime Engine struct + methods
5. GPU nodes — mechanical
6. WASM engine — mechanical
7. `start_render_sequence` background spawning
8. Tauri commands
9. Frontend polling + UI blocking
