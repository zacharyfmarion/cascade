# Viewer Rendering: Design Patterns & Insights

## Key Design Patterns

### 1. **Generation Counter for Stale Prevention**

**Problem:** Async operations can complete out-of-order. If user changes param 5 times in 100ms, render(param1) might complete *after* render(param5), overwriting the latest result.

**Solution:**
```tsx
const renderGenerations = new Map<string, number>();

const nextRenderGeneration = (viewerNodeId: string): number => {
  const next = (renderGenerations.get(viewerNodeId) ?? 0) + 1;
  renderGenerations.set(viewerNodeId, next);
  return next;
};

triggerRender: (viewerNodeId) => {
  const generation = nextRenderGeneration(viewerNodeId);  // Increment counter
  renderLock = renderLock.then(async () => {
    const result = await getEngine().renderViewer(...);
    // Only update if this is still the latest generation
    if (renderGenerations.get(viewerNodeId) === generation) {
      set({ renderResults });
    }
  });
}
```

**Why It Works:**
- Every `triggerRender()` call bumps the generation counter
- Older renders check their generation before updating state
- Prevents race conditions where slow render overwrites fast one
- Rendering still happens (no waste), but only latest result is used

**Used In:**
- `triggerRender()` for interactive param changes
- `setParamLive()` with `liveRenderGeneration` counter for desktop

---

### 2. **Render Suspension via Counter**

**Problem:** Undo/redo and group operations change multiple nodes. If each triggers `triggerAllViewers()`, we render N times. Wasteful.

**Solution:**
```tsx
let renderSuspendCount = 0;
let renderNeededWhileSuspended = false;

const triggerAllViewers = () => {
  if (renderSuspendCount > 0) {
    renderNeededWhileSuspended = true;
    return;  // Queue for later
  }
  // ... trigger immediately
};

editTransaction: async (options, mutate) => {
  renderSuspendCount++;  // Begin suspension
  try {
    await mutate();  // Apply all edits
  } finally {
    renderSuspendCount--;  // End suspension
    if (renderNeededWhileSuspended) {
      renderNeededWhileSuspended = false;
      triggerAllViewers();  // Render once after all edits
    }
  }
}
```

**Why It Works:**
- Restores snapshot → 10 node updates → each `triggerAllViewers()` is a no-op
- After all updates, single `triggerAllViewers()` queues renders
- N edits = 1 render, not N renders

**Trade-offs:**
- Need to call `editTransaction` to get batching benefit
- Manual `triggerAllViewers()` outside transaction still works (not suspended)

---

### 3. **Preview Scaling for Interactive Responsiveness**

**Problem:** High-res renders are slow. User dragging slider should see *something* immediately, not wait 500ms.

**Solution:**
```tsx
const liveScale = 0.25;  // 4x smaller = 16x fewer pixels

setParamLive: async (nodeId, key, value) => {
  // ... update local state
  
  set({ previewScale: 0.25 });  // FAST: small pixels
  
  // Render at 0.25x
  const scaled = await downscaleRenderResult(result, 0.25);
  
  // Store with metadata
  set({ renderResults: new Map().set(viewerId, {
    ...scaled,
    previewScale: 0.25  // UI knows it's scaled
  })});
}

// In Viewer component:
canvas.style.width = `${logicalWidth}px`;  // Scale up for display
canvas.style.imageRendering = previewScale < 1 ? 'pixelated' : 'auto';
```

**Timeline:**
- T=0ms: User moves slider
- T=5ms: `setParamLive` called, preview scaled to 0.25x, render starts
- T=50ms: Preview render completes, display updates (fast feedback)
- T=100ms+: Idle timer ticks, no more interaction
- T=5100ms: 5s idle timeout fires
  - Set `previewScale = 1`
  - Trigger full-resolution render
  - After complete: Display full quality

**Why It Works:**
- Downscaling is **client-side**: no server round-trip (Canvas API)
- Renders happen at 0.25x, much faster
- No visual pop: `downscaleRenderResult()` uses canvas bilinear filtering
- After interaction ends, full quality renders automatically

---

### 4. **Dual-Phase Param Interaction (Live + Commit)**

**Problem:** Slider interactions are immediate, but we want undo history to record final value, not intermediate values.

**Solution:**
```tsx
let preCommitSnapshot = null;

setParamLive: (nodeId, key, value) => {
  // Capture snapshot ONCE on first live change
  if (!preCommitSnapshot) {
    preCommitSnapshot = {
      nodes: new Map(get().nodes),
      engineState: await getEngine().exportGraph(),  // Async collection
      imageData: await collectImageData(),           // Async collection
      // ... capture other state
    };
  }
  
  // Update local state (immediate feedback)
  node.params[key] = value;
  set({ nodes });
  
  // Render live preview
  triggerRender(...);
}

setParamCommit: (nodeId, key, value) => {
  if (preCommitSnapshot) {
    // Push snapshot to undoStack (user can undo to pre-slider state)
    undoStack.push(preCommitSnapshot);
    redoStack.clear();
    preCommitSnapshot = null;
  }
  
  // Reset preview scale to full quality
  // Trigger full render
}
```

**Undo Behavior:**
- Drag slider `value: 0 → 0.5 → 1.0`
- Press Ctrl+Z (once)
- Returns to state **before slider interaction started** (value=0)
- Not 3 separate undo steps for each intermediate value

**Why It Matters:**
- Users expect slider interactions to be atomic in undo
- Without `setParamCommit`, each live render would push undo snapshot (bad UX)

---

### 5. **requestAnimationFrame Debounce for Live Renders**

**Problem:** User rapidly moves slider. Each `onChange` fires → `setParamLive` called 60 times/sec. Can't render 60 times/sec.

**Solution:**
```tsx
let liveRenderRaf: number | null = null;
let pendingLiveRender: (() => void) | null = null;

setParamLive: (nodeId, key, value) => {
  // Update local state immediately
  set({ nodes });
  
  // Schedule render, don't execute yet
  pendingLiveRender = () => {
    eng.setParamAndRender(nodeId, key, value, frame);
  };
  
  // Coalesce into next frame
  if (liveRenderRaf === null) {
    liveRenderRaf = requestAnimationFrame(() => {
      liveRenderRaf = null;
      pendingLiveRender?.();  // Execute once per frame max
      pendingLiveRender = null;
    });
  }
}
```

**Timeline:**
- T=0ms: Slider onChange (1st)
- T=2ms: Slider onChange (2nd) — `pendingLiveRender` overwritten
- T=4ms: Slider onChange (3rd) — `pendingLiveRender` overwritten
- T=16ms: rAF fires
  - Execute `pendingLiveRender` (3rd value)
  - Clear liveRenderRaf
- T=16.5ms: Slider onChange (4th) — new rAF scheduled
- T=32ms: rAF fires, render 4th value

**Benefit:**
- 60 onChange events → ~4 actual renders (15x reduction)
- Aligns with browser refresh rate (60Hz, 16.7ms frame)

---

### 6. **FIFO Scheduler for WASM RefCell Serialization**

**Problem:** wasm-bindgen wraps exported Rust structs in `RefCell`. Calling async methods that hold a mutable borrow across `.await` points will panic if another method is called during the await.

```tsx
// This would panic:
Promise.all([
  wasmEngine.render_viewer('v1'),   // Borrow starts...
  wasmEngine.render_viewer('v2'),   // ...can't get new borrow!
])  // Panic: "recursive use of an object detected"
```

**Solution:**
```tsx
class EngineScheduler {
  private chain: Promise<void> = Promise.resolve();
  
  enqueue<T>(op: () => T | Promise<T>): Promise<T> {
    const result = this.chain.then(op);
    // Swallow rejections on chain so one failure doesn't block others
    this.chain = result.then(
      () => undefined,  // Success
      () => undefined   // Failure (still mark complete)
    );
    return result;  // Return original promise
  }
}
```

**Usage:**
```tsx
renderViewer(viewerNodeId, frame): Promise<ViewerResult | null> {
  return this.scheduler.enqueue(async () => {
    const raw = await this.getEngine().render_viewer(viewerNodeId, BigInt(frame));
    // ... process and return
  });
}
```

**Execution Order:**
- `render_viewer('v1')` enqueued
- `render_viewer('v2')` enqueued
- Chain waits: `Promise.resolve().then(() => render('v1')).then(() => render('v2'))`
- v1 renders to completion, borrow released
- v2 starts, gets clean borrow
- Both succeed, no panic

**Applies To:** All WASM engine methods (`setParam`, `render_viewer`, `exportGraph`, etc.)

---

### 7. **Zustand Selector for Efficient Re-renders**

**Problem:** Store has 30+ fields. If we subscribe to entire store, component re-renders on *any* change (FPS updated, dirty flag set, etc.).

**Solution:**
```tsx
// ❌ Bad: Subscribes to entire store
const state = useGraphStore();
const result = state.renderResults.get(viewerId);
// Re-renders on every store change

// ✅ Good: Selector for specific field
const renderResults = useGraphStore(s => s.renderResults);
const result = renderResults.get(viewerId);
// Re-renders only if renderResults object reference changes

// ✅ Best: Selector for specific viewer's result
const result = useGraphStore(s => s.renderResults.get(viewerId));
// Re-renders only if *that* viewer's result changes
```

**Zustand Comparison Logic:**
- Runs selector on every store update
- Compares result with previous result via `Object.is()`
- If same reference: no re-render
- If different reference: re-render

**For `renderResults` Map:**
- `Map` is mutated in-place: `newResults.set(viewerId, result)`
- `new Map(oldResults)` creates new object reference
- Subscribers detecting Map change → force re-render
- If multiple viewers, all see Map update even if only one viewer's result changed

**Trade-off:**
- More granular selectors = fewer unnecessary re-renders
- But component must know structure to write selector

---

### 8. **Canvas Bilinear Downscaling**

**Problem:** Rendering at 0.25x gives blocky preview. Pixel-perfect preview is hard to interpret.

**Solution:**
```tsx
const downscaleRenderResult = async (result: ViewerResult, scale: number) => {
  const targetWidth = Math.round(result.width * scale);
  const targetHeight = Math.round(result.height * scale);
  
  // Source canvas: copy original pixels
  const sourceCanvas = new OffscreenCanvas(result.width, result.height);
  const sourceCtx = sourceCanvas.getContext('2d');
  sourceCtx.putImageData(new ImageData(result.pixels, result.width), 0, 0);
  
  // Target canvas: draw source at reduced size with bilinear filter
  const targetCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const targetCtx = targetCanvas.getContext('2d');
  targetCtx.imageSmoothingEnabled = true;  // ← Bilinear filtering
  targetCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
  
  // Extract scaled pixels
  const scaledImage = targetCtx.getImageData(0, 0, targetWidth, targetHeight);
  
  return {
    ...result,
    width: targetWidth,
    height: targetHeight,
    pixels: scaledImage.data,  // New Uint8ClampedArray
    previewScale: scale,       // Metadata
  };
}
```

**Why Canvas Instead of CPU Downsampling?**
- GPU-accelerated bilinear filtering (very fast)
- Smoother preview than nearest-neighbor
- Avoids complex resampling logic

**Used In:** Every `triggerRender()` call applies the current `previewScale`

---

### 9. **Error Suppression for Missing Inputs**

**Problem:** Before user connects an input, Viewer shows error. But this is expected, not an error.

**Solution:**
```tsx
triggerRender: (viewerNodeId) => {
  try {
    const result = await getEngine().renderViewer(...);
  } catch (e) {
    const error = parseEngineError(e);
    // Suppress "missing input" error
    if (error.code === 'MISSING_INPUT') {
      // Silently ignore, don't set lastError
      return;
    }
    // Only display real errors
    set({ lastError: error });
  }
}
```

**Result:**
- Disconnected viewer shows "No output" (friendly)
- Real errors (e.g., invalid param, out of memory) show error banner

---

### 10. **Node Timing Extraction After Every Render**

**Problem:** Need to display performance timings (which nodes are slow?).

**Solution:**
```tsx
renderViewer(...) {
  const result = await getEngine().render_viewer(...);
  
  // WASM: Extract timings from engine
  const timingsRaw = this.getEngine().get_last_render_timings();
  if (timingsRaw) {
    this.lastTimings = timingsRaw as Record<string, number>;
  }
  
  return result;
}

// Later, update store
updateNodeTimings: () => {
  const timings = getEngine().getLastRenderTimings?.();
  if (timings) {
    const merged = new Map(get().nodeTimings);
    for (const [nodeId, value] of Object.entries(timings)) {
      // Only update if non-zero (don't overwrite cached/skipped results)
      if (value > 0) {
        merged.set(nodeId, value);
      }
    }
    set({ nodeTimings: merged });
  }
}
```

**Why Non-Zero Only?**
- If a node's output is cached, render returns 0ms (no actual execution)
- We want to preserve the last *real* execution time for the badge
- Overwriting with 0 would hide the timing from previous run

---

## Critical Insights

### A. Render Results Are Ephemeral
- `renderResults` Map holds only **latest render per viewer**
- No history of previous renders (no need)
- If user changes 100 params, only final render is stored
- Reduces memory usage

### B. Preview Scaling Is Viewer-Aware
- All viewers share same `previewScale` setting
- If one viewer renders at 0.25x, so do all
- Downsampling is applied to each viewer independently
- After idle, all viewers re-render at 1.0x

### C. Tauri Desktop Has Optimization Web Doesn't
- `setParamAndRender`: Set param + render all viewers in 1 IPC
- Web WASM: `setParam` (no render), then separate `triggerRender` calls
- Desktop is ~2x faster for interactive param changes
- Web/WASM uses requestAnimationFrame debounce to compensate

### D. Errors Are Per-Node or Global
- `nodeErrors: Map<nodeId, EngineError>`: Node-specific errors (used for highlighting)
- `lastError: EngineError | null`: Latest error from any node (shown in banner)
- `MISSING_INPUT` error is special: suppressed, doesn't show UI

### E. Render Lock Serializes All Renders
- `triggerAllViewers()` for different reasons (param change, frame change, edit) all go through same lock
- Prevents parallel renders to engine
- Guarantees sequential, predictable execution
- But slower than parallel rendering (trade-off for simplicity)

---

## Performance Characteristics

| Operation | WASM | Tauri |
|-----------|------|-------|
| `setParam` + `renderViewer` | 2 calls (sequential) | 1 call via `setParamAndRender` |
| Interactive latency | ~16-33ms (rAF debounce) | ~5-10ms (direct IPC) |
| Preview scale | User-configurable (default 0.25) | Same |
| Idle full-render | 5s timeout | Same |
| Multi-viewer batch | renderAllViewersAsync (lock queue) | `setParamAndRender` returns all |
| FIFO Scheduling | EngineScheduler + renderLock | renderLock only (no RefCell) |

---

## Edge Cases & Gotchas

### 1. **PreviewScale Affects File Export**
```tsx
// User drags slider, previewScale = 0.25
// Calls Export Image
export(viewerNodeId, currentFrame)
// If this uses previewScale, exports 25% image!
```
**Fix:** Export always renders at full scale (previewScale = 1)

### 2. **Generation Counter Can Overflow**
```tsx
// After 4 billion renders on one viewer:
renderGenerations.get(viewerId) = 2^31 - 1
nextRenderGeneration(viewerId)  // Overflow?
```
**Reality:** Not a concern (would take years, app restarts happen)

### 3. **renderResults Update Triggers All Subscribers**
```tsx
// Viewer1 and Viewer2 both subscribed
set({ renderResults: newResults })  // newResults is entirely new Map

// Both components see Map change, both re-render
// Even if Viewer1's result didn't change
```
**Workaround:** Fine-grained selectors per viewer, but need viewer-specific Map updates

### 4. **Idle Timer Doesn't Account for Sequence Playback**
```tsx
// User clicks play
// isPlaying = true, currentFrame auto-increments
// Each frame triggers triggerAllViewers()

// But if playback is slow, idle timer might fire
// Setting previewScale = 1 mid-playback
```
**Real Behavior:** Each frame change cancels idle timer with `clearTimeout()`

---

## Summary of Key Takeaways

1. **Generation counters prevent stale updates** in concurrent async renders
2. **Render suspension** batches expensive multi-node edits into single render
3. **Preview scaling** (0.25x) + requestAnimationFrame gives fast interactive feedback
4. **Two-phase param interaction** (live + commit) keeps undo atomic
5. **FIFO scheduler** serializes WASM access to prevent RefCell panics
6. **Zustand selectors** reduce unnecessary re-renders
7. **Canvas bilinear downsampling** provides smooth preview
8. **Error suppression** for expected conditions (MISSING_INPUT)
9. **Node timings** extracted per render, preserved across cached renders
10. **Desktop optimization** (setParamAndRender) reduces interactive latency by 2x

