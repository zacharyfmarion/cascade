# Phase 6.1 (remainder) — Full async render pipeline with cancel support

## Bottom line
Move **all evaluation/renders off the UI thread** by making "render" a **job-based background service** (Web Worker on web; dedicated render thread on Tauri) with **latest-wins cancellation** and **progress events**. Keep the main thread responsible for UI state + graph edits.

**Effort estimate**: **Large (3d+)**

---

## 1) Goal and scope
- **No render/evaluation work runs on the UI thread**.
- Renders are **cancelable**: implicit (latest-wins per viewer) and explicit (user cancel).
- Results are **stale-safe**: only the newest job for a given viewer/output updates the UI.
- UI receives **progress** + **node attribution** on errors.
- Out of scope: per-pixel progress, hard GPU preemption, multi-viewer parallel evaluation.

## 2) Architecture design
### Web (WASM): All evaluation in a dedicated Web Worker.
### Tauri (native): Dedicated render thread with `std::sync::mpsc` channels; events via `AppHandle::emit_to`.
### Main thread: Graph/editor state (Zustand), render UI state, thin EngineBridge sending messages.

## 3) Cancel support design
- **Cooperative cancellation** with per-job token: `Arc<AtomicBool>` in Rust.
- Checks at: job boundary (mandatory), per-node boundary (mandatory), inside long-running nodes (incremental).
- Cancelled jobs return `RenderOutcome::Cancelled`, don't overwrite nodeErrors.

## 4) Tauri background rendering
- Dedicated render thread owning engine instance; one render job at a time.
- IPC: `requestRender(params) -> jobId`, `cancelRender(jobId)`, progress/completion via events.

## 5) UX considerations
- Show per-viewer render status with spinner + node progress.
- Keep last completed image during render; overlay "updating" indicator.
- Cancel button visible after threshold (150-300ms).

## 6) Edge cases
- Rapid param changes: latest-wins cancellation.
- Undo/redo during render: cancel current, apply patch, new job.
- Node deletion during render: cancel current, apply patch.
- Cancel race conditions: before start (never execute), during (cooperative exit), after finish (no-op).

## 7) Error handling
- Structured errors with node attribution: `RenderFailed { job_id, error, node_id?, node_name? }`.
- `Cancelled` is not an error in UI.

## 8) State management + message passing
- Monotonic `renderGeneration` per viewer + `job_id`.
- Message schema: `Render.Request/Cancel/Ack/Progress/Completed/Cancelled/Failed`.
- Image payload via transferables (`ArrayBuffer`).

## 9) Migration strategy
1. Unify render-request API (job_id + progress + cancel).
2. Route full-quality web renders through worker behind feature flag.
3. Make UI only talk via async bridge.
4. Add cancellation token through evaluator + EvalContext.
5. Instrument top CPU-cost nodes with mid-loop cancellation.
6. Implement Tauri render thread + event protocol.
7. Remove "two-engine render split".

## Step-by-step implementation checklist
- [ ] Define job model + message schema; add job_id/generation in renderSlice.
- [ ] Web worker: implement RenderJobManager (latest-wins per viewer).
- [ ] Move full-quality render to worker.
- [ ] Plumb cancellation token through Rust evaluator (job + per-node boundaries).
- [ ] Add progress reporting (node count).
- [ ] Instrument hot nodes for mid-loop cancel.
- [ ] Tauri: implement render thread service + event bridge.

## Risks and mitigations
- **Soft cancellation:** start with per-node cancel + discard; add short-circuiting in hottest nodes.
- **Engine state divergence:** version patches with monotonic revision; full resync on mismatch.
- **Misleading progress:** define as "nodes evaluated in this job" (approximate).
