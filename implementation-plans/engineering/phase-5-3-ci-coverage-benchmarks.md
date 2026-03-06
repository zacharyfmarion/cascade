# Phase 5.3 Remainder — CI Coverage Reporting + Benchmark Regression Detection (Implementation Plan)

## Bottom line
Add two new parallel CI jobs: **Rust coverage (blocking, thresholded)** and **CPU benchmark regression detection (blocking, >10% regression)**, both reporting results back to PRs via job summaries and a single bot comment. Defer GPU performance gating until a GPU runner exists; keep GPU tests explicitly "skipped" with reliable detection and reporting.

## Action plan (high level)
1. Adopt **`cargo-llvm-cov`** for Rust coverage and publish LCOV + HTML artifacts.  
2. Measure current main-branch coverage and set an initial **floor + "no drop vs main"** policy.  
3. Run **Criterion CPU benchmarks** on PRs and main with CI-stabilized settings.  
4. Store **main baselines as GitHub artifacts**, fetch on PRs, and compare deterministically.  
5. Fail PRs on **coverage below threshold** or **>10% benchmark regression** (with variance guards).  
6. Add a single PR comment + job summary tables for coverage/bench deltas.  
7. Keep GPU performance as **non-blocking reporting** until GPU CI is available.

**Effort estimate:** Medium (1–2 days)

---

## 0. Success criteria (definition of done)
- CI produces a **coverage percentage** for Rust (workspace + key crates), enforces a minimum, and fails when it drops.
- CI runs **Criterion CPU benchmarks** on PRs and fails if any tracked benchmark regresses by **>10%** (with variance/noise handling).
- Results are visible in PRs (job summary + comment) and easy to reproduce locally.

---

## 1. Goal and scope
### Goal
- **Coverage**: prevent silent loss of test effectiveness, guide where tests are missing, and make refactors safer.
- **Bench regression detection**: prevent performance regressions in core CPU nodes and identify regressions early (before release).

### In scope
- Rust workspace coverage (focused on "shipping" crates; exclude known untestable/generated code).
- Criterion **CPU** benchmarks gating on PRs and `main`.
- PR-visible reporting (comment + job summary).

### Out of scope (for this phase)
- Blocking GPU performance gating (requires GPU CI runner).
- WASM runtime coverage in browsers (can be a later phase; see "Optional future considerations").

---

## 2. Coverage tooling (cargo-tarpaulin vs cargo-llvm-cov)
### Recommendation: `cargo-llvm-cov`
- **Pros**
  - Uses LLVM source-based coverage; generally **more accurate** than ptrace-based approaches.
  - Works well with workspaces and produces **LCOV** (good for PR annotations) and **HTML**.
  - Better compatibility with modern Rust constructs (async, inlining) than older tooling.
- **Cons**
  - Slower than plain tests (typically noticeable compile + instrumentation overhead).
  - Requires installing LLVM coverage tooling (`llvm-tools-preview`) and `cargo-llvm-cov`.

### Alternative: `cargo-tarpaulin` (not primary)
- **Pros**: simple on Linux; historically popular.
- **Cons**: can be less accurate with newer Rust patterns; relies on runtime tracing; can be brittle depending on platform/kernel constraints.

### Threshold policy (minimal, pragmatic)
Because current coverage % is unknown, do **not** guess a fixed number up-front. Use a two-part policy:
1. **Absolute floor**: start with a conservative workspace minimum (e.g., **40–50% lines**) to avoid blocking immediately.
2. **No-regression vs main**: PR coverage must be **≥ main coverage − small tolerance** (e.g., **0.5–1.0 percentage point**) to prevent gradual decay.

### Per-crate thresholds (recommended once baseline is known)
- Establish thresholds for the most important crates (likely `cascade-core`, `cascade-nodes-std`, `cascade-runtime`) by running coverage per package (`--package …`) and applying crate-specific floors.
- Keep FFI/sys crates and GPU/shader-heavy crates excluded from thresholding initially.

### Exclusions (patterns)
Exclude code that would distort metrics or is impractical to cover:
- Generated / FFI bindings (e.g., `*-sys` crates)
- Bench code (`benches/`), examples (`examples/`), build scripts (`build.rs`)
- Test-only helpers if you want "shipping code only" metrics (optional; be careful not to over-exclude)
- Potentially exclude GPU shader sources / kernel manifests if they are not Rust-executable paths

**Implementation note:** `cargo-llvm-cov` supports ignore regexes and package selection; use those instead of ad-hoc filtering.

---

## 3. Benchmark regression design
### What to benchmark (include/exclude)
**Include (blocking):**
- Criterion CPU benchmarks in `cascade-nodes-std/benches/node_benchmarks.rs` that cover core CPU operations (blur, blend, brightness/contrast, invert, resize, alpha_over, sRGB conversion).

**Exclude (non-blocking for now):**
- GPU kernel performance (runner-dependent, high variance without pinned GPU hardware).

### Baseline comparison strategy
- Baseline = latest successful `main` benchmark results (artifact).
- PR run = current PR benchmark results.
- Compare per benchmark ID on:
  - **Primary metric**: median or mean estimate (pick one and be consistent; median is often more robust).
  - **Regression rule**: fail if **PR is >10% slower** than baseline for any tracked benchmark.

### Noise handling (CI variance)
To avoid false positives:
- Require both:
  - **Ratio threshold**: `PR / baseline > 1.10`
  - **Stability guard**: confidence intervals indicate meaningful change (e.g., PR CI lower bound still above baseline point estimate, or CI overlap is minimal).  
If implementing CI math is too heavy at first, use a simpler guard:
- Run benchmarks with a CI-tuned config (see below) and enforce `>10%` only on a curated subset known to be stable.

### CI-tuned Criterion configuration
Update the benchmark harness to be deterministic and faster in CI:
- When `CI=true`, reduce runtime while preserving signal:
  - Smaller `measurement_time`, reasonable `sample_size`
  - `--noplot`
- Pin threads / reduce noise where possible:
  - Set `RAYON_NUM_THREADS` to a fixed value (e.g., 2 or number of cores) for consistency.
  - Avoid dynamic CPU frequency assumptions (can't fully control on GitHub-hosted runners).

### What constitutes "regression"
- Any tracked benchmark exceeding **10% slowdown** after applying noise guard.
- Optional: separate "warning-only" threshold (e.g., 5–10%) surfaced in PR comment but not failing.

---

## 4. Benchmark storage (baselines)
### Recommendation: GitHub artifacts (no external service required)
- On `push` to `main`, run benchmarks and upload a small baseline bundle:
  - Parsed summary JSON (preferred) + raw Criterion output (optional)
  - Metadata: commit SHA, runner OS, Rust version, CPU arch, benchmark config hash

### How PRs fetch the baseline
- Download the **latest successful main** artifact using a GitHub Action designed for cross-workflow artifact download (or GitHub API via `gh`).
- Validate metadata; if mismatched (different OS/toolchain/config), **warn and skip gating** rather than producing misleading results.

### How baselines update
- Baselines update automatically whenever `main` benchmarks run successfully.
- Do **not** "accept new baselines" from PRs; only merges to `main` should advance the baseline.

**External services (codspeed/bencher.dev)**
- Only consider if you need long-term trending dashboards, hardware pinning, or large-scale historical analytics. For this phase, artifacts are the simplest path with minimal surface area.

---

## 5. GPU CI considerations
### Cost/benefit
- **Benefit**: stable GPU performance gating requires fixed hardware; huge value for shader-heavy workloads.
- **Cost**: self-hosted GPU runners require provisioning, security hardening, and ongoing maintenance.

### Minimal approach for now (recommended)
- Keep existing GPU tests that skip when no GPU is available, but make skip behavior **explicit and detectable**:
  - Ensure skip logs a consistent marker (e.g., "GpuContext unavailable; skipping GPU tests").
  - Add a CI step that surfaces whether GPU tests ran vs skipped (job summary).

### Conditional execution
- Add a non-blocking GPU benchmark/report job that runs only when:
  - Label is applied (e.g., `gpu-ci`), or
  - Scheduled nightly workflow, or
  - On a self-hosted runner if/when available.

---

## 6. UX considerations (PR feedback + badges)
### PR feedback loop (recommended)
- Add a single PR comment (updated-in-place) that includes:
  - Coverage: total %, delta vs main, link to artifact/report
  - Benchmarks: top regressions/improvements table, and pass/fail status
- Also write concise tables to the GitHub Actions **Job Summary** for visibility without scrolling logs.

### Badges
- Coverage badge is easiest with Codecov, but that introduces an external dependency.  
Minimal approach: add a GitHub Actions badge for the coverage workflow/job; add a coverage badge later if you adopt Codecov.

---

## 7. Edge cases
- **Flaky benchmarks / variance**: curated benchmark subset + CI-tuned Criterion config; add a "rerun benchmarks" label/workflow_dispatch.
- **Coverage of async code**: `cargo-llvm-cov` generally handles it; ensure tests actually execute async paths (avoid "green but uncovered").
- **Coverage of WASM code**: likely excluded initially; separate plan needed for `wasm-bindgen-test` + headless runtime coverage.
- **Coverage of unsafe code**: coverage tools report execution, not correctness; keep unsafe-heavy areas under unit/integration tests and consider targeted property tests later (not part of this phase).

---

## 8. Error handling (CI behavior)
- **Coverage below threshold**: job fails; upload LCOV + HTML report artifacts; PR comment includes "blocked" status and delta.
- **Coverage tool failure** (tool install, report generation): job fails with actionable log + "how to reproduce locally" snippet.
- **Benchmark baseline missing/mismatched**: do not block by default; report "baseline unavailable" and upload PR results artifact.
- **Benchmark regression detected**: job fails; PR comment shows which benchmarks regressed and by how much.

---

## 9. Cost analysis (runtime impact + optimizations)
### Expected impact
- Coverage jobs typically add noticeable time vs normal tests due to instrumentation.
- Benchmarks can add several minutes depending on sample sizes and number of benches.

### Optimizations
- Only run coverage/bench jobs when Rust files change (`crates/**`, `Cargo.*`), not for docs-only changes.
- Use caching (`target/`, cargo registry/git) to reduce rebuild time.
- Keep benchmark set small and stable for gating; run the full suite nightly if needed.

---

## 10. Integration with existing CI (4-job structure)
Add two new parallel jobs to `.github/workflows/ci.yml`:
- `rust-coverage` (blocking)
- `bench-regression` (blocking)

Optionally add a third lightweight job:
- `ci-report` (non-blocking) that depends on the above and posts/updates the PR comment once, to avoid duplicate comments.

**Minimal YAML sketch (conceptual):**
```yaml
jobs:
  rust_coverage:
    runs-on: ubuntu-latest
    steps:
      - checkout
      - install rust + llvm-tools-preview
      - install cargo-llvm-cov
      - run cargo llvm-cov --workspace ... --lcov --output-path lcov.info
      - enforce thresholds
      - upload artifacts (lcov + html)

  bench_regression:
    runs-on: ubuntu-latest
    steps:
      - checkout
      - restore cache
      - download main baseline artifact
      - run cargo bench -p cascade-nodes-std --bench node_benchmarks -- --noplot
      - parse criterion output -> summary.json
      - compare summary.json vs baseline.json; fail on >10%
      - upload artifacts (summary + raw criterion dir)
```

---

## 11. Step-by-step implementation checklist
- [ ] Add `rust-coverage` job using `cargo-llvm-cov` and generate LCOV + HTML artifacts.  
- [ ] Run coverage on `main` to capture baseline; decide initial floor + no-drop tolerance.  
- [ ] Add ignore/exclude patterns (FFI sys crates, benches, examples, generated code).  
- [ ] Add `bench-regression` job that runs CPU Criterion benches with CI-tuned settings.  
- [ ] Create a small CI script (Python recommended) to:
  - [ ] Parse `target/criterion/**/new/estimates.json`
  - [ ] Emit `bench_summary.json` + metadata
  - [ ] Compare against downloaded `main` baseline and fail on regressions
- [ ] Upload baseline artifact on `main` runs; download it on PR runs.  
- [ ] Add PR reporting (job summary + single updated comment).  

---

## 12. Risks and mitigations
- **Risk: Coverage thresholds block work unexpectedly.**  
  Mitigation: start with a low absolute floor + "no drop vs main", then ratchet upward deliberately.
- **Risk: Benchmarks are flaky on shared runners.**  
  Mitigation: CI-tuned Criterion config + curated stable benchmark set + confidence/overlap guard before failing.
- **Risk: Baseline mismatch (toolchain/runner/config) causes false comparisons.**  
  Mitigation: embed metadata in baseline; skip gating with warning when mismatched.

---

## Optional future considerations (max 2)
1. Add a scheduled nightly workflow that runs the **full benchmark suite** (including GPU, if self-hosted runner exists) and posts a trend summary.  
2. Add WASM/browser-specific coverage as a separate phase once the desired runtime and reporting format are agreed.
