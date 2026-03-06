# Phase 6.3 — GPU Subgraph Batching (Implementation Plan)

## 1) Goal and scope
**Goal:** Eliminate redundant CPU↔GPU transfers for contiguous GPU kernel regions by executing them as a single fused GPU "subgraph pass": **upload once → N dispatches → read back once**.  
**Expected win:** For a chain of *k* GPU nodes, reduce transfers from **2k** (upload+readback per node) to roughly **2** (one upload at the boundary, one readback at the end), plus fewer allocations via the texture pool.

**In scope**
- Detect GPU-only connected regions in the evaluated slice of the graph (including branching/diamonds).
- Keep intermediates GPU-resident until the fused region finishes (or until a CPU boundary demands readback).
- Integrate with the existing pull-based evaluator and CPU `Value::Image` cache (final output only).

**Out of scope (explicitly not Phase 6.3)**
- Persistent GPU-resident caching across evaluations (e.g., `Value::GpuImage` stored in evaluator cache).
- Kernel fusion into a single shader (this plan is *dispatch batching*, not shader fusion).

---

## 2) Subgraph detection
### Definitions
- **GPU node:** a node evaluated via `cascade-gpu` kernel dispatch producing an image-like output.
- **GPU edge:** a connection where a GPU node output is consumed as an image input by another GPU node.
- **GPU subgraph (batch candidate):** a maximal connected DAG of GPU nodes within the *currently required* evaluation slice where GPU edges connect them.

### Algorithm (per evaluation request)
1. **Compute the required slice** for the requested output (already implied by pull-based postorder traversal).
2. Build a **GPU-only DAG** induced by nodes in that slice:
   - Vertex: GPU nodes in slice.
   - Directed edge A→B if B consumes an image output from A.
3. Partition into **connected components** (or "maximal GPU regions") in the induced GPU DAG, but keep direction for scheduling.
4. For each component, compute:
   - **Inputs (boundaries):** edges from CPU/non-GPU producers into the component (require upload to GPU texture).
   - **Outputs (boundaries):** component outputs consumed by CPU/non-GPU nodes in-slice, plus the final requested output if it lies in the component (require readback).

### Branches / diamonds
- Branching (one GPU output feeding multiple GPU consumers) stays within the same GPU component; execution is in topological order.
- Diamonds (two paths merging) are naturally handled by topo order: both upstream textures exist before the merge node dispatch.

### Mixed GPU/CPU chains
- Any edge crossing GPU↔CPU (or non-image types) forms a **hard boundary**:
  - CPU→GPU: upload once at boundary for that input.
  - GPU→CPU: read back at boundary for that output *only if needed in the required slice*.

---

## 3) Execution fusion design
### Primary design: `GpuSubgraphExecutor`
Introduce an internal executor (name flexible) that can evaluate a GPU component without intermediate readbacks:

- **Input:** component description + boundary CPU inputs (as `Image`) + requested boundary outputs.
- **Output:** CPU `Image` for requested outputs (typically only the final requested output for Phase 6.3).

**Core loop**
1. Acquire/upload boundary inputs into GPU textures (from texture pool).
2. Topologically iterate GPU nodes in the component:
   - Acquire output texture(s) from pool.
   - Create bind groups for this node (inputs are texture views + uniform buffer).
   - Encode compute dispatch (no readback).
   - Track produced texture handles in a map keyed by `(node_id, output_port)`.
3. Read back only required boundary outputs (typically one) to CPU `Image`.
4. Release intermediate textures back to pool as soon as their last GPU consumer is done.

### Chaining strategy
- **General DAG support (recommended):** Maintain a map of live intermediate textures, not just ping-pong.
- **Ping-pong optimization (optional later):** Only safe for strict linear chains with single-use intermediates; keep as a future micro-optimization, not required.

---

## 4) Intermediate texture management (and texture pool interaction)
### Requirements from pooling (Phase 2.4)
Batching depends on being able to:
- `acquire(domain, format=Rgba16Float, usage=STORAGE_BINDING|COPY_SRC|COPY_DST|TEXTURE_BINDING as needed)`
- Return textures to the pool on drop (RAII handle) without device stalls.
- Support many short-lived textures per evaluation.

### Lifecycle / liveness
Within a GPU component:
- Build a **GPU-use refcount** for each produced output: number of downstream GPU edges inside the component that consume it.
- Keep an intermediate texture alive until:
  - Its refcount reaches 0 **and**
  - It is not needed for a boundary readback.
- After scheduling a node, decrement refcounts of its input textures; release any that reach 0.

### Output size/domain changes
Some nodes may change size (e.g., resize/crop). The executor must determine each node's **output domain** *before* acquiring its output texture:
- Add/standardize a method on GPU kernel nodes to compute output domain from input domains + params (pure function).
- Validate compatibility: input/output sizes required by the kernel must be satisfied; otherwise return a structured error attributed to the node.

---

## 5) Bind group / pipeline management
### Pipelines
Keep using the existing pipeline cache keyed by WGSL hash. For batching:
- Fetch/compile pipeline once per kernel type (already cached).
- Reuse `ComputePipeline` across dispatches; per-dispatch bind groups are still created (cheap relative to transfers).

### Uniforms / params
Each node has different parameters; plan:
- Allocate a per-node uniform buffer (or sub-allocated slice if you already have a buffer pool).
- Write params via `queue.write_buffer` before dispatch.
- Keep buffer alive until GPU submission completes (own it in the per-dispatch record).

### Bind group creation per node
For each dispatch:
- Bind group entries typically include:
  - input texture view(s) (storage or sampled, matching current kernel contract)
  - output storage texture view(s)
  - uniform buffer
- Create bind groups on-the-fly; cache only if there is an existing mechanism with a clear invalidation key (otherwise keep it simple).

---

## 6) UX considerations
- **Transparent by default:** users see identical results; only performance improves.
- **Debug mode:** add a runtime flag (env var or feature flag) that:
  - Logs fused components: node ids, node type ids, boundary transfer counts (uploads/readbacks).
  - Optionally exposes metrics to the frontend "Diagnostics" panel (if one exists) as counters only (no UI redesign required).

---

## 7) Edge cases
- **Single GPU node:** executor may still run, but batching benefit is minimal; you can short-circuit and keep existing path or reuse executor for consistency.
- **GPU node with multiple outputs:**  
  - Phase 6.3 minimal path: support if the kernel dispatch can write multiple storage textures and the graph type system exposes them; otherwise treat multi-output GPU nodes as boundaries (no batching across them) until supported.
- **GPU node feeding both GPU and CPU nodes:**  
  - If both consumers are in the required slice, keep GPU texture for GPU consumers and additionally read back once for the CPU consumer boundary output.
- **Branching GPU subgraphs:** handled via topo scheduling + refcounted texture lifetimes.
- **Different input/output sizes between nodes:** must be validated per node; allocate outputs by computed domain; kernels must define their expected behavior (e.g., sampling vs exact 1:1 mapping).

---

## 8) Error handling
### Attribution to the failing node
wgpu errors can be asynchronous; aim for best-effort attribution:
- In **debug mode**, wrap each node dispatch in an error scope (validation) and pop it after submission to map errors to node id/type.
- In **release mode**, encode the whole component and submit once for performance; if an error occurs, return a component-level error that includes the list of nodes in the batch and the currently executing node index (tracked while encoding).

### Partial chain failures
- If a node fails during encoding/validation, abort the batch and return an error (no partial CPU outputs).
- Ensure textures acquired so far are dropped/returned to pool via RAII even on error paths.

### Device lost mid-chain
- Surface as a structured `CascadeError` variant that indicates device lost and the batch context (component id + node list). Allow higher layers to trigger GPU context reinit if that's the existing behavior.

---

## 9) Interaction with evaluator cache
- Evaluator cache remains **CPU `Value::Image`** keyed as today.
- **Phase 6.3 rule:** only cache the *requested output* (and any other outputs the evaluator would have cached anyway because a CPU node needs them). Do **not** cache GPU intermediates solely because they were computed during a batch.
- Cache invalidation stays unchanged (param revisions + upstream hashes). The batching mechanism must not alter dependency tracking—only the execution strategy.

---

## 10) Performance measurement
### Metrics to add (cheap, high-signal)
Per evaluation:
- `gpu_upload_count`
- `gpu_readback_count`
- `gpu_dispatch_count`
- `gpu_texture_acquire_count` / `gpu_texture_reuse_count` (from pool)
- wall time split: upload, encode, submit, readback (coarse timers)

### Bench approach
- Add a benchmark graph in an existing bench harness (or runtime bench tool) with:
  - linear chain of 3/5/10 GPU kernels
  - a branching case (diamond) with 6–10 kernels
  - mixed GPU→CPU boundary case
- Compare before/after:
  - total time
  - transfer counts (should collapse from ~2k to ~2 for linear chains)

---

## 11) Step-by-step implementation checklist
- [ ] **(A) Prereq integration:** Confirm texture pool API supports acquire/release of `Rgba16Float` storage textures with required usages; add any missing usage bits needed for upload/readback.  
- [ ] **(B) Graph analysis:** In the evaluator, build the induced GPU DAG for the required slice; partition into GPU components; compute boundary inputs/outputs and topo order.  
- [ ] **(C) Domain planning:** Add/standardize "output domain" computation for GPU kernel nodes so the executor can allocate output textures correctly before dispatch.  
- [ ] **(D) Executor skeleton:** Implement `GpuSubgraphExecutor` that uploads boundary inputs, dispatches nodes in topo order, and reads back only requested/boundary outputs.  
- [ ] **(E) Lifetime management:** Add refcount-based release of intermediate textures back to pool; validate with branching graphs.  
- [ ] **(F) Error attribution + debug:** Add debug flag; implement error scoping/logging per node in debug mode; ensure errors propagate as `CascadeError` without panics.  
- [ ] **(G) Bench + validation:** Add benchmarks + metric counters; verify transfer counts and performance improvements on representative graphs.

---

## 12) Risks and mitigations
- **Risk:** Domain/size mismatches cause subtle wrong outputs.  
  **Mitigation:** Make output-domain computation explicit and validated; add tests for resize/crop-like kernels.
- **Risk:** wgpu async error reporting makes node attribution flaky.  
  **Mitigation:** Provide best-effort attribution in release, strong attribution in debug via error scopes.
- **Risk:** Texture pool misuse causes leaks or reuse-before-GPU-finished hazards.  
  **Mitigation:** RAII handles + clear "return to pool only when handle drops"; avoid manual free lists inside batching code.

---

## 13) Dependency on texture pooling (Phase 2.4)
Batching needs pooling to provide, at minimum:
- **Fast acquire/release** of storage textures keyed by `(width, height, format, usage)` without reallocating every node.
- A handle type that safely returns textures to the pool on drop (even on error paths).
- The ability to keep multiple textures alive concurrently (branching graphs), not just one "current" texture.
- (Optional but helpful) basic pool stats (reuse counts) to validate batching effectiveness without external profilers.

---

## Effort estimate
**Large (3d+)** — primarily due to correct DAG batching (branches), domain planning, and robust error + lifetime handling.  

### Escalation triggers (when to consider a more complex design)
- You need *cross-evaluation* speedups (scrubbing timelines, repeated renders): then you likely want **GPU-resident cached values** (new value type + cache layer), which is beyond Phase 6.3.
