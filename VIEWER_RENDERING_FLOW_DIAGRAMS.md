# Viewer Rendering: Flow Diagrams

## Sequence 1: Param Change → Live Render

```
User moves slider on a node parameter
    ↓
onChange event in ParamControl component
    ↓
useGraphStore.setParamLive(nodeId, key, value)
    ├─ Save preCommitSnapshot (for undo if not already saved)
    ├─ Update local node.params in store
    ├─ Set previewScale = livePreviewScale (0.25x for speed)
    │
    ├─ If Tauri:
    │   └─ eng.setParamAndRender(nodeId, key, value, frame)
    │       └─ IPC call: Set param + render all viewers in one shot
    │       └─ Returns Map<viewerId, ViewerResult>
    │       └─ Batch apply downscaleRenderResult()
    │       └─ set({ renderResults })
    │
    └─ If WASM:
        └─ Schedule pendingLiveRender() via requestAnimationFrame
            └─ Coalesces multiple param changes in same frame
            └─ eng.setParam(nodeId, key, value)  [no render yet]
            └─ triggerAllViewers()
                └─ For each viewer: triggerRender(viewerId)
                    └─ Acquire renderLock, render sequentially
    ↓
[5 second idle timer starts]
    ↓
User finishes interaction (mouse up)
    ↓
setParamCommit(nodeId, key, value)
    ├─ Save preCommitSnapshot to undoStack
    ├─ Clear preCommitSnapshot
    └─ Clear idlePreviewTimer
    ↓
[After 5 seconds with no interaction]
    ↓
idlePreviewTimer fires
    ├─ set({ previewScale: 1 })  [return to full resolution]
    └─ triggerAllViewers()  [re-render at full quality]

===== RENDER EXECUTION =====

triggerRender(viewerNodeId) [async in renderLock queue]
    ├─ generation = nextRenderGeneration(viewerNodeId)
    │  [Increment and store: renderGenerations[viewerId] = gen]
    │
    ├─ [Wait for previous render in renderLock]
    │
    ├─ result = await getEngine().renderViewer(viewerNodeId, frame)
    │  │
    │  ├─ WASM path:
    │  │  ├─ Scheduler.enqueue(() => engine.render_viewer(...))
    │  │  ├─ Return ParsedViewerResult (pixels or scalar)
    │  │  └─ Extract timings via engine.get_last_render_timings()
    │  │
    │  └─ Tauri path:
    │     ├─ IPC invoke('render_viewer', {viewerNodeId, frame})
    │     ├─ Decode binary: [width][height][pixels...]
    │     └─ Fetch timings separately
    │
    ├─ scaled = await downscaleRenderResult(result, previewScale)
    │  └─ Canvas bilinear downsample if scale < 1
    │
    ├─ [Check if this is still latest generation]
    │  └─ if (renderGenerations[viewerId] !== generation) return  [stale, discard]
    │
    └─ set({
         renderResults: new Map(...).set(viewerId, scaled),
         lastError: null,
         nodeErrors: new Map()
       })

===== REACT UPDATE =====

Zustand broadcasts renderResults update
    ↓
Viewer component selector detects change
    ├─ renderResults = useGraphStore(s => s.renderResults)  [triggers]
    └─ activeResult = useMemo(() => renderResults.get(activeViewerId), [renderResults])
    ↓
useEffect([activeResult]) fires
    ├─ canvas.width = activeResult.width
    ├─ canvas.height = activeResult.height
    ├─ ctx.putImageData(new ImageData(activeResult.pixels), 0, 0)
    ├─ canvas.style.width = `${logicalWidth}px`  [apply preview scale visually]
    └─ canvas.style.height = `${logicalHeight}px`
    ↓
Browser paints updated canvas to screen
```

---

## Sequence 2: Frame Navigation

```
User scrubs timeline or presses play/step
    ↓
setCurrentFrame(frame)
    │
    ├─ set({ currentFrame: frame })
    └─ renderAllViewersAsync()
        ↓
        renderLock = renderLock.then(async () => {
            await pushSequenceFrames(frame)  [load sequence frame data if needed]
                │
                └─ For each LoadImageSequence node:
                   └─ eng.loadSequenceFrameData(nodeId, frame, data)
            ↓
            newResults = new Map(get().renderResults)
            changed = false
            ↓
            for (const [viewerId, node] of nodes) {
                if (node.typeId !== 'viewer') continue;
                try {
                    result = await getEngine().renderViewer(viewerId, frame)
                    if (result) {
                        scaled = await downscaleRenderResult(result, previewScale)
                        newResults.set(viewerId, scaled)
                        changed = true
                    }
                } catch (e) {
                    error = parseEngineError(e)
                    set({ lastError: error, nodeErrors: ... })
                }
            }
            ↓
            if (changed) {
                set({ renderResults: newResults, lastError: null })
                updateNodeTimings()
            }
        })
    ↓
[Renders all viewers sequentially in same renderLock queue]
```

---

## Sequence 3: Graph Edit (Connect/Disconnect)

```
User connects nodes A.out → B.in
    ↓
useGraphStore.connect(fromNode, fromPort, toNode, toPort)
    ├─ eng.connect(...)  [sync call, updates engine graph]
    ├─ Update local connections state
    └─ tagUiOrigin()  [mark mutation as UI-originated]
    ├─ triggerAllViewers()
    │   ↓
    │   if (renderSuspendCount > 0) {
    │       renderNeededWhileSuspended = true
    │       return  [defer render]
    │   }
    │   ↓
    │   for (const [viewerId, node] of nodes) {
    │       if (node.typeId === 'viewer') {
    │           get().triggerRender(viewerId)
    │       }
    │   }
    └─ pushUndo()  [capture undo snapshot]
    ↓
[same triggerRender() flow as Sequence 1]
```

---

## Sequence 4: Desktop "setParamAndRender" Optimization

```
[Desktop only: Tauri backend]

User drags slider on BrightnessContrast node
    ↓
setParamLive(nodeId='brightness', key='amount', value=0.5)
    ├─ update local node.params
    ├─ set({ previewScale: 0.25 })
    │
    └─ eng.setParamAndRender('brightness', 'amount', 0.5, frame)
       │
       ├─ IPC invoke('set_param_and_render', {nodeId, key, value, frame})
       │   │
       │   └─ Tauri backend (Rust):
       │      ├─ engine.set_param(nodeId, key, value)
       │      ├─ For each viewer node:
       │      │   └─ Render viewer, store result
       │      ├─ Serialize all results to binary buffer:
       │      │   [count: u32]
       │      │   [viewer1: id_len | id_bytes | width | height | pixels]
       │      │   [viewer2: id_len | id_bytes | width | height | pixels]
       │      │   ...
       │      └─ Return ArrayBuffer
       │
       ├─ Frontend decodes buffer
       ├─ Builds Map<viewerId, ViewerResult>
       └─ For each result:
           └─ scaled = await downscaleRenderResult(result, 0.25)
    ↓
    set({ renderResults: newResults })
    ↓
    [All viewers updated in single Zustand dispatch]
    ↓
    Viewer components re-render with new results
```

**Advantage over Web WASM:**
- Single async IPC call renders all viewers (not N separate calls)
- Param change + all renders = 1 round-trip latency instead of N+1
- Batch decoding/downsampling in TypeScript

---

## Sequence 5: Stale Render Prevention

```
User rapidly clicks through 5 different param values: v1, v2, v3, v4, v5
    ↓
setParamLive(..., 'value', v1)
    └─ generation = 1; renderGenerations['viewer1'] = 1
    └─ Schedule render(v1)
    ↓
setParamLive(..., 'value', v2)
    └─ generation = 2; renderGenerations['viewer1'] = 2
    └─ Schedule render(v2)  [previous render(v1) still in queue]
    ↓
setParamLive(..., 'value', v3)
    └─ generation = 3; renderGenerations['viewer1'] = 3
    └─ Schedule render(v3)
    ↓
[renderLock queue processes first scheduled render]
    ├─ render(v1) completes
    ├─ Check: if (renderGenerations['viewer1'] === 1) → FALSE (now 3)
    ├─ Discard result
    └─ Next in queue...
    ↓
[renderLock processes render(v2)]
    ├─ render(v2) completes
    ├─ Check: if (renderGenerations['viewer1'] === 2) → FALSE (now 3)
    ├─ Discard result
    └─ Next in queue...
    ↓
[renderLock processes render(v3)]
    ├─ render(v3) completes
    ├─ Check: if (renderGenerations['viewer1'] === 3) → TRUE
    ├─ Apply result:
    │   └─ set({ renderResults: new Map().set('viewer1', scaledResult3) })
    └─ Display v3 on screen

Result: Only the latest param value is rendered and displayed.
Older renders execute but their results are discarded.
```

---

## Sequence 6: Render Suspension (Undo/Group Operations)

```
User presses Ctrl+Z (undo)
    ↓
useGraphStore.undo()
    └─ editTransaction({ ... }, async () => {
        renderSuspendCount++
        ↓
        Try:
            restoreSnapshot(undoStack.pop())
            ├─ await eng.importGraph(snapshot.engineState)
            ├─ Restore nodes, connections, frames
            ├─ tagUiOrigin()
            ├─ triggerAllViewers()  [SUSPENDED]
            │   └─ if (renderSuspendCount > 0) {
            │       renderNeededWhileSuspended = true
            │       return  [no render yet]
            │   }
            │
            └─ Return from restoreSnapshot
        ↓
        Finally:
            renderSuspendCount--  [back to 0]
            if (renderNeededWhileSuspended) {
                renderNeededWhileSuspended = false
                triggerAllViewers()  [NOW render!]
            }
    })
    ↓
[Single triggerAllViewers() call processes entire undo operation]
[Prevents N renders if undo changed N nodes]
```

---

## Data Structure: ViewerResult Union Type

```tsx
type ViewerResult = 
  | {
      type: 'image' | 'mask' | 'field'
      nodeId: string
      width: number
      height: number
      pixels: Uint8ClampedArray  // sRGB-encoded RGBA bytes
      previewScale?: number        // Applied downscale factor (e.g., 0.25)
    }
  | { type: 'float'; nodeId: string; value: number }
  | { type: 'int'; nodeId: string; value: number }
  | { type: 'bool'; nodeId: string; value: boolean }
  | { type: 'color'; nodeId: string; value: [r, g, b, a] }  // Linear space
  | { type: 'string'; nodeId: string; value: string }
  | { type: 'none'; nodeId: string }

// Helper to determine if contains pixel data
function isPixelResult(result: ViewerResult): result is {type: 'image'|'mask'|'field'; pixels: ...}
```

---

## Store State Snapshot (Relevant Fields)

```tsx
{
  // Render outputs
  renderResults: Map<viewerId, ViewerResult>
  lastError: EngineError | null
  nodeErrors: Map<nodeId, EngineError>
  nodeTimings: Map<nodeId, number>  // Last non-zero execution time (ms)
  
  // Render configuration
  currentFrame: number
  previewScale: number  // Current downscale (1.0 = full, 0.25 = 4x smaller)
  
  // Batch/sequence render progress
  isRendering: boolean
  renderProgress: JobProgress | null
  
  // UI state
  selectedNodeIds: Set<string>
  nodes: Map<nodeId, NodeInstance>
  connections: Connection[]
  
  // Playback
  isPlaying: boolean
  fps: number
  playbackFps: number | null  // Actual playback rate
  
  // Methods
  triggerRender: (viewerNodeId: string) => void
  setParamLive: (nodeId, key, value) => Promise<void>
  setParamCommit: (nodeId, key, value) => Promise<void>
  setCurrentFrame: (frame: number) => void
  // ... 30+ other methods
}
```

---

## Architecture: Render Path Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER INTERACTION                              │
│   (Slider, Connection, Frame Change, Explicit triggerRender)    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    ZUSTAND STORE                                 │
│  (Serialize to renderLock queue, apply generation tracking)     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                     ┌────────┴────────┐
                     ↓                 ↓
            ┌─────────────────┐  ┌──────────────┐
            │  WASM Engine    │  │ Tauri Engine │
            │  (Sync wrapped) │  │   (IPC)      │
            └─────────────────┘  └──────────────┘
                 ↓                      ↓
        ┌──────────────────────────────────┐
        │   Render at preview scale (0.25) │
        └──────────────────────────────────┘
                        ↓
        ┌──────────────────────────────────┐
        │  downscaleRenderResult()          │
        │  (Canvas bilinear filter)         │
        └──────────────────────────────────┘
                        ↓
        ┌──────────────────────────────────┐
        │  Update Zustand renderResults     │
        │  (Broadcast to subscribers)       │
        └──────────────────────────────────┘
                        ↓
        ┌──────────────────────────────────┐
        │  Viewer Component                 │
        │  (useEffect on activeResult)      │
        │  (Canvas.putImageData)            │
        └──────────────────────────────────┘
                        ↓
        ┌──────────────────────────────────┐
        │  Browser Paint                    │
        └──────────────────────────────────┘
```

