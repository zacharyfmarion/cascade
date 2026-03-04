# Viewer Rendering System - Complete Documentation

This directory contains comprehensive analysis of how the Cascade viewer rendering system works end-to-end.

## Documents

### 1. **VIEWER_RENDERING_ANALYSIS.md** (Primary Reference)
The main technical document. Read this first for complete understanding.

**Covers:**
- Viewer component rendering flow (Viewer.tsx + ViewerNode.tsx)
- EngineBridge interface and dual implementations (WASM vs Tauri)
- What triggers re-renders (param changes, frame navigation, graph edits)
- How render results are stored and delivered to components
- Batching, debouncing, and generation tracking optimizations
- Error handling and display
- Render result downscaling via canvas bilinear filtering

**Key Sections:**
1. Viewer Component Rendering Flow
2. EngineBridge.renderViewer() Implementation
3. What Triggers Viewer Re-renders? (A-D)
4. Render Result Storage & Delivery
5. Render Optimization: Batching & Debouncing
6. Render Suspension (editTransaction)
7. Error Handling & Display
8. Render Result Downscaling
9. Summary Table

**Read This For:** Architecture overview, how pieces fit together

---

### 2. **VIEWER_RENDERING_FLOW_DIAGRAMS.md** (Visual Reference)
Sequence diagrams and architecture flowcharts for key scenarios.

**Contains:**
- **Sequence 1:** Param Change → Live Render (most common path)
- **Sequence 2:** Frame Navigation (playback/scrubbing)
- **Sequence 3:** Graph Edit (connect/disconnect nodes)
- **Sequence 4:** Desktop "setParamAndRender" Optimization
- **Sequence 5:** Stale Render Prevention (generation tracking)
- **Sequence 6:** Render Suspension (undo/group operations)
- Data Structure: ViewerResult Union Type
- Store State Snapshot (relevant fields)
- Architecture: Render Path Summary (visual diagram)

**Read This For:** Understanding execution flow, state mutations, timing

---

### 3. **VIEWER_RENDERING_PATTERNS.md** (Design Deep-Dive)
Design patterns, implementation details, and critical insights.

**Details:**
- 10 key design patterns with examples:
  1. Generation Counter for Stale Prevention
  2. Render Suspension via Counter
  3. Preview Scaling for Interactive Responsiveness
  4. Dual-Phase Param Interaction (Live + Commit)
  5. requestAnimationFrame Debounce for Live Renders
  6. FIFO Scheduler for WASM RefCell Serialization
  7. Zustand Selector for Efficient Re-renders
  8. Canvas Bilinear Downscaling
  9. Error Suppression for Missing Inputs
  10. Node Timing Extraction After Every Render

- Critical Insights (A-E)
- Performance Characteristics (WASM vs Tauri)
- Edge Cases & Gotchas
- Summary of Key Takeaways

**Read This For:** Why things are designed this way, how to modify/extend

---

## Quick Reference

### Subscription Pattern (How Components Get Render Results)

```tsx
// Viewer.tsx - Main viewer
const renderResults = useGraphStore(s => s.renderResults);  // Map<viewerId, ViewerResult>
const activeResult = useMemo(() => 
  renderResults.get(activeViewerId), [renderResults, activeViewerId]
);

// ViewerNode.tsx - Inline thumbnail
const result = useGraphStore(s => s.renderResults.get(props.id));
```

### Render Triggers

| Trigger | Code Path | Result |
|---------|-----------|--------|
| Param change | `setParamLive()` → `setParamAndRender()` | Live preview at 0.25x, then full quality after 5s idle |
| Frame change | `setCurrentFrame()` → `renderAllViewersAsync()` | All viewers render at current preview scale |
| Graph edit | `connect()`/`disconnect()` → `triggerAllViewers()` | All viewers re-render |
| Explicit call | `triggerRender(viewerId)` | Single viewer renders |

### EngineBridge Implementations

| Method | WASM | Tauri |
|--------|------|-------|
| `renderViewer(viewerId, frame)` | Serialized via EngineScheduler, returns Promise | IPC call, returns Promise |
| `setParamAndRender(nodeId, key, value, frame)` | Not implemented (web fallback: setParam + triggerRender) | IPC call, batch renders, returns Map |
| `setParam(nodeId, key, value)` | Scheduler.enqueue() | IPC call |
| Performance | 2 calls per param change | 1 call via setParamAndRender |

### State Management

```tsx
// Zustand store fields (renderResults map)
renderResults: Map<viewerId, ViewerResult>
  ├─ Type: 'image' | 'mask' | 'field' | 'float' | 'int' | 'bool' | 'color' | 'string' | 'none'
  ├─ For pixels: width, height, pixels (Uint8ClampedArray)
  ├─ For scalars: value (typed)
  └─ Metadata: previewScale (current downscale factor)

lastError: EngineError | null  // Latest error from any render
nodeErrors: Map<nodeId, EngineError>  // Per-node errors
nodeTimings: Map<nodeId, number>  // Last execution time per node
```

### Critical Optimizations

1. **Generation Tracking:** Prevent stale renders from overwriting newer ones
2. **Render Suspension:** Batch edits into single render via counter
3. **Preview Scaling:** 0.25x resolution during interaction for speed
4. **requestAnimationFrame:** Debounce live renders to one per frame
5. **FIFO Scheduler:** Serialize WASM engine calls to prevent RefCell panic
6. **Canvas Downsampling:** Bilinear filtering for smooth preview
7. **Error Suppression:** Hide expected errors (MISSING_INPUT)

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                      USER INTERACTION                        │
│  Slider drag, node connection, frame scrub, explicit render  │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│                    ZUSTAND STORE                             │
│  (setParamLive, triggerRender, setCurrentFrame, etc.)        │
│  ├─ Generation counter (stale prevention)                    │
│ ├─ Render suspension counter (batch edits)                   │
│  └─ Render lock queue (serialize engine calls)               │
└──────────────────────────────────────────────────────────────┘
                  ↙                  ↘
         ┌────────────────┐   ┌──────────────────┐
         │  WASM Engine   │   │  Tauri Engine    │
         │  (Scheduler)   │   │   (IPC)          │
         └────────────────┘   └──────────────────┘
                  ↓                    ↓
         ┌─────────────────────────────────────┐
         │  Render at preview scale (0.25)     │
         │  Get node timings                   │
         └─────────────────────────────────────┘
                           ↓
         ┌─────────────────────────────────────┐
         │  downscaleRenderResult()            │
         │  (Canvas bilinear downsample)       │
         └─────────────────────────────────────┘
                           ↓
         ┌─────────────────────────────────────┐
         │  Update Zustand renderResults       │
         │  Clear errors, update timings       │
         └─────────────────────────────────────┘
                           ↓
         ┌─────────────────────────────────────┐
         │  Zustand broadcasts change          │
         │  All subscribers notified            │
         └─────────────────────────────────────┘
                           ↓
         ┌─────────────────────────────────────┐
         │  Viewer component re-renders        │
         │  (useEffect on activeResult)        │
         └─────────────────────────────────────┘
                           ↓
         ┌─────────────────────────────────────┐
         │  Canvas.putImageData() or           │
         │  ScalarViewer (text/color/etc.)     │
         └─────────────────────────────────────┘
                           ↓
         ┌─────────────────────────────────────┐
         │  Browser renders to screen          │
         └─────────────────────────────────────┘
```

---

## File Locations

```
apps/web/src/
├── components/
│   ├── Viewer.tsx                 (Main viewer component)
│   ├── ViewerToolbar.tsx          (Zoom/fit controls)
│   └── nodes/
│       └── ViewerNode.tsx         (Inline viewer node)
│
├── store/
│   ├── graphStore.ts             (Zustand store, main logic)
│   └── types.ts                  (ViewerResult type definitions)
│
└── engine/
    ├── bridge.ts                 (EngineBridge interface)
    ├── wasmEngine.ts             (WASM implementation)
    ├── tauriEngine.ts            (Tauri IPC implementation)
    ├── engineError.ts            (Error parsing & handling)
    └── sequenceFrameManager.ts   (Sequence frame caching)
```

---

## Common Questions

### Q: How do I add a new output type to viewers?
**A:** 
1. Add case to `ViewerResult` union in `apps/web/src/store/types.ts`
2. Update `isPixelResult()` if needed (for pixel detection)
3. Add rendering logic in `Viewer.tsx` ScalarViewer component
4. Update WASM bridge (`wasmEngine.ts`) to parse new type
5. Update Tauri bridge if needed

### Q: Why do I see jagged previews when dragging sliders?
**A:**
Preview scaling uses canvas bilinear filtering, but very low scales (0.1x) can still look blocky. This is expected. Full-resolution render appears after 5 seconds idle.

### Q: Why don't multiple viewers update independently?
**A:**
The `renderResults` Map update broadcasts to all subscribers. Zustand doesn't know which specific viewer changed, so all subscribers re-render. Use fine-grained selectors for efficiency:
```tsx
const result = useGraphStore(s => s.renderResults.get(viewerId));  // Better
```

### Q: How do I debug a stale render?
**A:**
Check the generation counter:
```tsx
console.log(renderGenerations.get(viewerId));  // Should increment each trigger
```
If `triggerRender()` is called but generation doesn't increment, check if `renderSuspendCount > 0` (render is suspended).

### Q: Why are renders serialized via renderLock?
**A:**
Two reasons:
1. **WASM:** RefCell panic if nested mutable borrows (FIFO scheduler prevents it)
2. **General:** Predictable execution order, easier to reason about state mutations

Parallel renders would be faster but harder to debug and maintain.

### Q: How do I force a full-quality render immediately?
**A:**
```tsx
set({ previewScale: 1 });
get().triggerAllViewers();
```

### Q: Can I cancel a pending render?
**A:**
Not directly. Renders are queued in `renderLock` promise chain. The generation counter prevents stale results from being displayed, but rendering still happens.

---

## Performance Tips

1. **Interactive Sliders:** Use `setParamLive()` not `setParam()` for debounced preview
2. **Batch Edits:** Wrap in `editTransaction()` to suspend renders
3. **Multiple Viewers:** Use selector per viewer, not entire `renderResults` map
4. **Export/Batch:** Always render at `previewScale: 1`, never export preview
5. **Desktop App:** Uses `setParamAndRender` (1 IPC) not separate calls (2+ IPC)

---

## References

- **Main Graph Engine:** `crates/cascade-core/src/lib.rs`
- **Render Evaluation:** `crates/cascade-core/src/evaluator.rs`
- **Viewer Node Spec:** `crates/cascade-nodes-std/src/output.rs` → Viewer node definition
- **WASM Bridge:** `crates/cascade-wasm/src/lib.rs`
- **Tauri Backend:** `apps/tauri/src-tauri/src/engine.rs`

---

## Document Legend

- 📘 **VIEWER_RENDERING_ANALYSIS.md** - Structural overview (read first)
- 📊 **VIEWER_RENDERING_FLOW_DIAGRAMS.md** - Visual sequences and flows
- 🎯 **VIEWER_RENDERING_PATTERNS.md** - Design patterns and rationale
- 📄 **This file** - Quick reference and navigation

