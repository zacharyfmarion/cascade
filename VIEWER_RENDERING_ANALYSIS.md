# Viewer Rendering System: End-to-End Analysis

## Overview

The viewer rendering system is a reactive pull-based architecture where:
1. **Zustand store** is the single source of truth for graph state and render results
2. **Viewer components** subscribe to `renderResults` via store selectors
3. **Render triggers** come from param changes, explicit `triggerRender()` calls, or frame changes
4. **EngineBridge** abstracts over WASM (sync) and Tauri (async) backends
5. **Render generation tracking** prevents stale updates in fast user interactions

---

## 1. Viewer Component Rendering Flow

### Viewer.tsx - Main Component

**Location:** `apps/web/src/components/Viewer.tsx` (425 lines)

**Subscription Pattern:**
```tsx
const renderResults = useGraphStore(s => s.renderResults);  // Map<viewerId, ViewerResult>
const activeViewerId = // selected or auto-picked viewer node
const activeResult = useMemo(() => {
  return activeViewerId ? renderResults.get(activeViewerId) : undefined;
}, [renderResults, activeViewerId]);  // Recompute when renderResults changes
```

**Key Points:**
- Uses Zustand **selector** to subscribe to `renderResults` map only (not entire store)
- Automatically selects first available viewer if none selected
- Re-renders when `renderResults` Map updates (via Zustand shallow comparison)
- Canvas is re-rendered in `useEffect([activeResult, ...])` when result changes

**Rendering Logic:**
1. If `isPixelResult(activeResult)`: Draw to 2D canvas using `putImageData()`
2. If scalar result: Show `<ScalarViewer>` with type-specific formatting (float, int, bool, color, string, none)
3. If no result: Show placeholder "No output"

**Visual Scaling:**
- `previewScale` parameter (from store) downscales render for interactive speed
- During `setParamLive` (interactive slider drag), uses `livePreviewScale` (typically 0.25)
- After idle timeout (5s default), returns to full scale via `triggerAllViewers()`

### ViewerNode.tsx - Inline Node Display

**Location:** `apps/web/src/components/nodes/ViewerNode.tsx` (125 lines)

**Subscription:**
```tsx
const result = useGraphStore(s => s.renderResults.get(props.id));
```

- Same pattern: subscribed to the specific viewer's render result
- Displays 100px thumbnail inline in node graph
- Uses `<InlineScalar>` for non-pixel values (same formatting as main Viewer)

---

## 2. EngineBridge.renderViewer() Implementation

### Bridge Interface

**Location:** `apps/web/src/engine/bridge.ts`

```tsx
export interface EngineBridge {
  renderViewer(viewerNodeId: string, frame: number, previewScale?: number):
    Promise<ViewerResult | null> | ViewerResult | null;
  setAndRender?(mutation: { type: 'param' | 'inputDefault'; nodeId: string; key: string; value: ParamValue }, frame: number, previewScale?: number):
    Promise<Array<[string, ViewerResult]>>;
  // ... 30+ other methods
}

export type ViewerResult = 
  | { type: 'image' | 'mask' | 'field'; nodeId: string; width: number; height: number; pixels: Uint8ClampedArray; previewScale?: number }
  | { type: 'compare'; nodeId: string; width: number; height: number; beforePixels: Uint8ClampedArray; afterPixels: Uint8ClampedArray; previewScale?: number }
  | { type: 'float' | 'int'; nodeId: string; value: number }
  | { type: 'bool'; nodeId: string; value: boolean }
  | { type: 'color'; nodeId: string; value: [number, number, number, number] }
  | { type: 'string'; nodeId: string; value: string }
  | { type: 'none'; nodeId: string };
```

### WASM Implementation

**Location:** `apps/web/src/engine/wasmEngine.ts:239–303`

```tsx
renderViewer(viewerNodeId: string, frame: number, previewScale = 1): Promise<ViewerResult | null> {
  return this.scheduler.enqueue(async (): Promise<ViewerResult | null> => {
    const raw = await this.getEngine().render_viewer(viewerNodeId, BigInt(frame));
    
    // Extract render timings
    const timingsRaw = this.getEngine().get_last_render_timings();
    if (timingsRaw) {
      this.lastTimings = timingsRaw as Record<string, number>;
    }
    
    // Parse result based on type tag (image/mask/field/float/int/bool/color/string/none)
    // Returns Uint8ClampedArray for pixels (sRGB encoded)
    // Returns structured scalars as-is (linear space, except color which is also linear)
  });
}
```

**Key Details:**
- Runs through **EngineScheduler** to serialize access (WASM RefCell limitation)
- Calls Rust `render_viewer()` which returns serialized result
- Extracts **node timings** via `get_last_render_timings()` after render
- WASM is sync at the Rust boundary but wrapped in Promise for consistency
- Pixels are in **Uint8ClampedArray** format (sRGB-encoded, ready for canvas)

**EngineScheduler:**
```tsx
class EngineScheduler {
  private chain: Promise<void> = Promise.resolve();
  
  enqueue<T>(op: () => T | Promise<T>): Promise<T> {
    const result = this.chain.then(op);
    this.chain = result.then(() => undefined, () => undefined);  // Swallow rejections to not block queue
    return result;
  }
}
```
- Guarantees **FIFO execution** and prevents nested mutable borrows
- Ensures no two engine operations touch the RefCell simultaneously

### Tauri Implementation

**Location:** `apps/web/src/engine/tauriEngine.ts:142–157`

```tsx
async renderViewer(viewerNodeId: string, frame: number): Promise<ViewerResult | null> {
  try {
    const buf = await invoke<ArrayBuffer>('render_viewer', { viewerNodeId, frame });
    if (!buf || buf.byteLength < 8) return null;
    
    const view = new DataView(buf);
    const width = view.getUint32(0, true);
    const height = view.getUint32(4, true);
    const pixels = new Uint8ClampedArray(buf, 8);  // Remaining bytes after width/height
    
    await this.fetchTimings();
    return { type: 'image', nodeId: viewerNodeId, width, height, pixels };
  } catch {
    return null;
  }
}
```

**Key Details:**
- IPC call to Rust backend via `invoke('render_viewer', ...)`
- Returns binary buffer: `[width: u32][height: u32][pixels: Uint8ClampedArray]`
- Only returns **image results** (desktop app always renders as image)
- Scalar types are only available in WASM (Tauri always downconverts)

**setAndRender (Combined Mutation/Render):**
```tsx
async setAndRender(mutation, frame: number, previewScale?: number):
  Promise<Array<[string, ViewerResult]>> {
  const buf = await invoke<ArrayBuffer>('set_param_and_render', ...);
  // Returns multi-result buffer: [count: u32][id_len][id_bytes][width][height][pixels]...
  // Parses all viewer outputs from the single IPC call
  return resultsMap;
}
```
- Combines the mutation and affected viewer renders when the active bridge supports it
- Returns viewer result entries for batch update
- Used by the live param/input-default controller for interactive feedback

---

## 3. What Triggers Viewer Re-renders?

### A. Param Changes (Most Common)

**Flow:**
```
User changes param slider
  ↓
setParamLive(nodeId, key, value)  [graphStore/paramController.ts]
  ↓
If bridge supports it: setAndRender() returns viewer entries → direct setState
Otherwise: schedule mutation + affected viewer renders
  ↓
downscaleRenderResult(result, liveScale)  // Apply preview scaling
  ↓
set({ renderResults: newResults })  [Zustand state update]
  ↓
Viewer component detects Map change
  ↓
useEffect([activeResult]) re-renders canvas
```

**Two-Phase Pattern:**
1. **Live render** (`setParamLive`): Uses `livePreviewScale` (0.25x) for responsiveness
   - Worker/Tauri: `setAndRender` can batch mutation and render
   - Direct WASM fallback: separate mutation and render calls
2. **Commit** (`setParamCommit`): Finishes param interaction, returns to full scale

**Debouncing:**
```tsx
if (liveRenderRaf === null) {
  liveRenderRaf = requestAnimationFrame(() => {
    pendingLiveRender?.();  // Execute render
  });
}

// After 5s idle, scale back to 1.0 and re-render full quality
if (idlePreviewTimer) clearTimeout(idlePreviewTimer);
idlePreviewTimer = setTimeout(() => {
  set({ previewScale: 1 });
  triggerAllViewers();  // Full-quality render
}, 5000);  // configurable via settingsStore
```

### B. Frame Changes

**Flow:**
```
setCurrentFrame(frame)  [graphStore.ts:1443]
  ↓
renderAllViewersAsync()
  ↓
For each viewer: renderViewer(viewerId, frame)
  ↓
downscaleRenderResult(...)
  ↓
set({ renderResults })  [Zustand update]
```

- Triggered by timeline scrubbing, playback, or sequence navigation
- Renders **all** viewer nodes asynchronously (sequentially via `renderLock`)

### C. Connection/Graph Changes

**Flow:**
```
User connects/disconnects nodes, adds nodes, etc.
  ↓
triggerAllViewers()  [graphStore.ts:364]
  ↓
For each viewer/export node: triggerRender(viewerId)
```

**Render Lock (Sequential):**
```tsx
let renderLock: Promise<void> = Promise.resolve();

triggerRender: (viewerNodeId) => {
  const generation = nextRenderGeneration(viewerNodeId);
  renderLock = renderLock.then(async () => {
    if (renderGenerations.get(viewerNodeId) !== generation) return;  // Stale check
    const result = await getEngine().renderViewer(...);
    // ...update store
  });
}
```

- Uses **generation counter** to prevent stale updates
- If `triggerRender` is called 5 times rapidly, only the last render executes
- Serializes across all viewers to avoid hammering the engine

### D. Explicit Render Call

```tsx
triggerRender(viewerNodeId)  // Can be called from UI or code
```

---

## 4. Render Result Storage & Delivery

### Storage Location: Zustand Store

**Location:** `apps/web/src/store/graphStore.ts`

```tsx
interface GraphState {
  renderResults: Map<string, ViewerResult>;  // viewerId → latest render output
  lastError: EngineError | null;            // Last error from any render
  nodeErrors: Map<string, EngineError>;     // Per-node errors
  nodeTimings: Map<string, number>;         // Last non-zero execution time per node
  previewScale: number;                     // Current downscale factor
  isRendering: boolean;                     // Batch/sequence render in progress
  renderProgress: JobProgress | null;       // Batch/sequence render progress
  // ... 20+ other state fields
}
```

### Update Path

```
Engine render completes
  ↓
WasmEngine/TauriEngine returns ViewerResult
  ↓
graphStore.triggerRender() or setParamLive()
  ↓
downscaleRenderResult() applies preview scaling
  ↓
set({ renderResults: newResults, lastError: null, nodeErrors: new Map() })  [Zustand]
  ↓
Zustand broadcasts to all subscribers
  ↓
Viewer component selector detects change
  ↓
React re-renders with new result
```

### Subscription Types

**1. Selector Subscription (Most Common):**
```tsx
const renderResults = useGraphStore(s => s.renderResults);
const activeResult = useMemo(() => 
  renderResults.get(activeViewerId)
, [renderResults, activeViewerId]);
```
- Zustand detects Map object change (not deep equality)
- Component re-renders whenever any viewer's result updates
- Fine for a few viewers, but wastes renders if many viewers exist

**2. Direct Selector (Specific Viewer):**
```tsx
const result = useGraphStore(s => s.renderResults.get(viewerNodeId));
```
- Zustand tracks `renderResults.get(viewerNodeId)` as dependency
- More efficient: only re-renders when *that* viewer's result changes

**3. Store Action (Imperative):**
```tsx
const results = useGraphStore.getState().renderResults;
const result = results.get(viewerId);
```
- No subscription, manual access
- Used in error handling or non-React code

---

## 5. Render Optimization: Batching & Debouncing

### Live Preview Scaling (Interactive Performance)

**During Slider Drag (`setParamLive`):**
- **Goal:** Render fast feedback without waiting for full resolution
- **Mechanism:**
  ```tsx
  const liveScale = useSettingsStore.getState().livePreviewScale;  // e.g., 0.25
  set({ previewScale: liveScale });
  // Render at 0.25x resolution (4x fewer pixels)
  ```
- **requestAnimationFrame Debounce:**
  - Multiple param changes within one frame coalesce into single render
  - Prevents N renders per frame

**After Interaction Idle (`setParamCommit`):**
  ```tsx
  idlePreviewTimer = setTimeout(() => {
    set({ previewScale: 1 });
    triggerAllViewers();  // Full-resolution render
  }, 5000);  // configurable
  ```

### Generation Tracking (Stale Prevention)

**Problem:** User changes param 5 times in rapid succession; older renders might complete *after* newer ones.

**Solution:**
```tsx
let renderGenerations = new Map<string, number>();  // viewerId → generation number

const nextRenderGeneration = (viewerNodeId: string): number => {
  const next = (renderGenerations.get(viewerNodeId) ?? 0) + 1;
  renderGenerations.set(viewerNodeId, next);
  return next;
};

triggerRender: (viewerNodeId) => {
  const generation = nextRenderGeneration(viewerNodeId);  // e.g., gen=3
  renderLock = renderLock.then(async () => {
    const result = await getEngine().renderViewer(...);
    // Only update if this is still the latest generation
    if (renderGenerations.get(viewerNodeId) === generation) {
      set({ renderResults: newResults });
    } else {
      // Discard result, newer render is pending
    }
  });
}
```

### Live Render Generation Tracking

**Combined mutation/render (`setAndRender`):**
```tsx
const renderGeneration = ++liveRenderGeneration;
pendingLiveRender = () => {
  eng.setAndRender!(mutation, frame, previewScale).then(async results => {
    if (renderGeneration !== liveRenderGeneration) return;  // Stale check
    set({ renderResults: newResults });
  });
};
```

### Render Lock (Sequential Renders)

**Problem:** Multiple `triggerRender()` calls from different graph changes might hammer the engine in parallel.

**Solution:**
```tsx
let renderLock: Promise<void> = Promise.resolve();

triggerRender: (viewerNodeId) => {
  renderLock = renderLock.then(async () => {
    // Execute after previous render completes
    const result = await getEngine().renderViewer(...);
  });
};

renderAllViewersAsync: () => {
  renderLock = renderLock.then(async () => {
    for (const [viewerId, node] of nodes) {
      if (node.typeId !== 'viewer') continue;
      const result = await getEngine().renderViewer(viewerId, frame);
      // ...
    }
  });
};
```

---

## 6. Render Suspension (editTransaction)

**Use Case:** When applying a batch of graph edits (undo/redo, group operations), suspend renders until all edits are complete.

```tsx
let renderSuspendCount = 0;
let renderNeededWhileSuspended = false;

const triggerAllViewers = () => {
  if (renderSuspendCount > 0) {
    renderNeededWhileSuspended = true;
    return;  // Queue render for later
  }
  // ... trigger immediately
};

editTransaction: async (options, mutate) => {
  renderSuspendCount++;
  try {
    await mutate();
  } finally {
    renderSuspendCount--;
    if (renderNeededWhileSuspended) {
      renderNeededWhileSuspended = false;
      triggerAllViewers();  // Catch up
    }
  }
}
```

---

## 7. Error Handling & Display

**Error Path:**
```
Engine render throws CascadeError
  ↓
catch(e) in triggerRender / setParamLive
  ↓
parseEngineError(e) → structured EngineError
  ↓
if (error.nodeId) {
  set({ nodeErrors: new Map().set(nodeId, error), lastError: error });
} else {
  set({ lastError: error });
}
  ↓
Viewer displays error banner at bottom
```

**Error Types:**
- `MISSING_INPUT`: Input not connected; suppressed from display (silent ignore)
- `INVALID_PARAM`: Invalid parameter value
- `RENDER_FAILED`: Rust evaluation error (e.g., out of memory, invalid operation)
- Network/IPC errors: Propagated as `lastError`

---

## 8. Render Result Downscaling

**Location:** `apps/web/src/store/graphStore.ts:100–138`

```tsx
const downscaleRenderResult = async (result: ViewerResult, scale: number): Promise<ViewerResult> => {
  if (!isPixelResult(result)) return result;  // Scalars not downscaled
  
  if (scale >= 1) return { ...result, previewScale: 1 };  // No downscale needed
  
  // Use OffscreenCanvas or HTMLCanvas to bilinear-sample down
  const sourceCanvas = createScalingCanvas(result.width, result.height);
  sourceCtx.putImageData(imageData, 0, 0);
  
  targetCtx.imageSmoothingEnabled = true;  // Bilinear filtering
  targetCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
  
  const scaledImage = targetCtx.getImageData(...);
  return {
    ...result,
    width: targetWidth,
    height: targetHeight,
    pixels: scaledImage.data,
    previewScale: scale,
  };
}
```

- **Applied after every render** in `triggerRender()` and `renderAllViewersAsync()`
- Uses canvas **bilinear filtering** (smooth downsampling)
- Returns new dimensions and `previewScale` metadata for UI display
- Pixel array is re-allocated (sRGB bytes)

---

## Summary Table

| Aspect | Details |
|--------|---------|
| **Subscription** | Zustand selector on `renderResults` Map |
| **Trigger Sources** | Param change, frame change, connection change, explicit `triggerRender()` |
| **Render Call** | `EngineBridge.renderViewer(viewerId, frame)` |
| **WASM** | Sync engine wrapped in Promise, serialized via EngineScheduler |
| **Tauri** | Async IPC, `setAndRender` bridge method for batch updates |
| **State Storage** | `renderResults: Map<viewerId, ViewerResult>` in Zustand |
| **Preview Scaling** | `livePreviewScale` (0.25x) during interaction, full scale after 5s idle |
| **Stale Prevention** | Generation counter + conditional update |
| **Serialization** | Render lock ensures sequential engine calls |
| **Downsampling** | Canvas bilinear filter, applied to every render result |
| **Error Handling** | Caught, parsed to `EngineError`, displayed in UI |
| **Batching** | `renderAllViewersAsync()` for frame changes, `setAndRender` for combined mutation/render paths |
