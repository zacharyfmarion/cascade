# Phase 5.2 — Frontend Component Tests (React/TypeScript)

## Bottom line
Add a dedicated component-test layer using **Vitest + React Testing Library + jsdom** to verify that critical UI components render correctly, are accessible, and correctly drive the Zustand store + EngineBridge mocks. Keep existing store tests (node env) and Playwright E2E; component tests fill the gap between them with fast, focused interaction coverage.

## Effort estimate
**Medium (1–2 days)** for stack + infra + initial critical coverage (BaseNode, NodeCanvas, CurvesNode). Expect follow-on additions to expand coverage across the remaining components.

---

## 1) Goal and scope

### Goals (what component testing adds)
Component tests should verify, at the DOM and interaction layer, that:
- **UI renders NodeSpec-driven controls correctly** (labels, defaults, disabled/mute states, error badges).
- **User interactions are wired correctly to store actions** (click/keyboard/drag → store mutation → engine call ordering).
- **Undo/redo and "gesture vs commit" behavior** works end-to-end through the UI (not just store-level unit tests).
- **Accessibility basics** exist (roles/labels, keyboard navigation, focus management), which E2E rarely checks systematically.
- **Regressions are caught quickly** without booting a full app or browser.

### In scope (Phase 5.2)
- Testing stack + jsdom infrastructure
- Test harness utilities (providers, engine mock reset/overrides, ReactFlow container stubs)
- Critical component tests:
  - **NodeCanvas**: node creation, connection, deletion, selection + keyboard delete
  - **BaseNode**: param rendering, enable/mute/disable, error display
  - **CurvesNode**: curve editing interactions and resulting param updates
- Component↔store integration tests:
  - Undo/redo round-trips initiated via UI
  - Live parameter gestures (continuous updates + single undo commit)
  - Node deletion cleanup (edges, selection, engine calls)

### Explicit non-goals (for now)
- Pixel-perfect rendering assertions (canvas/WebGL output)
- Full app flows already covered by Playwright (save/load projects, multi-page navigation)
- Broad coverage of all 41 components (prioritize critical path first)

---

## 2) Testing stack

### Primary stack
- **Vitest** (already present)
- **jsdom** environment for component tests
- **React Testing Library**: `@testing-library/react`
- **Interactions**: `@testing-library/user-event`
- **DOM assertions**: `@testing-library/jest-dom` (Vitest integration)

### Optional but recommended (keep optional unless explicitly desired)
- **Accessibility checks**: `axe-core` + `vitest-axe`
  - Use for "no obvious violations" checks on key panels/nodes.

---

## 3) Test infrastructure setup

### 3.1 Vitest config: split node vs jsdom
Current config is `environment: 'node'` (good for store tests). Add jsdom **only for component tests** to keep existing suite fast.

**Recommended approach (minimal change):**
- Keep default `environment: 'node'`
- Add `environmentMatchGlobs` for component tests:
  - `**/*.component.test.tsx` → `jsdom`
  - `**/*.component.test.ts` → `jsdom` (if needed)

Also add a second setup file for jsdom-only concerns.

**Example configuration intent (not exact code):**
- `test.setupFiles`: keep `src/__tests__/setup.ts` for node tests
- `test.environmentMatchGlobs`: route component tests to jsdom
- `test.setupFiles` for jsdom tests: add `src/__tests__/setup.dom.ts` via conditional config or a small "always safe" import pattern

### 3.2 jsdom setup file (`setup.dom.ts`)
Add the missing browser-ish APIs used by ReactFlow and UI controls:
- `ResizeObserver` polyfill stub
- `IntersectionObserver` stub (if used by tooltips/menus)
- `PointerEvent` shim if missing
- `requestAnimationFrame` shim
- Canvas stubs:
  - `HTMLCanvasElement.prototype.getContext = vi.fn(() => fakeCtx)`
  - minimal `measureText`, `fillRect`, etc. as needed
- WebGL stubs (only if components touch WebGL in tests):
  - `HTMLCanvasElement.getContext('webgl'|'webgl2')` returns a fake object

Also:
- `import '@testing-library/jest-dom/vitest'`
- RTL cleanup is automatic in recent RTL; if needed, add explicit `afterEach(cleanup)`.

### 3.3 Mock providers / render harness
Create shared utilities to make component tests readable and consistent:

**`renderWithProviders()`**
- Wrap:
  - Zustand store provider (or direct store injection if the app supports it)
  - Theme/CSS variable wrapper if components assume theme vars
  - `ReactFlowProvider` (for NodeCanvas and node components)
- Accept options:
  - initial graph state (nodes/edges)
  - engine mock instance
  - feature flags / environment toggles

**DOM layout helpers**
ReactFlow and drag logic frequently depends on layout:
- Provide `mockBoundingClientRect(element, { width, height, ... })`
- Ensure the ReactFlow container has stable dimensions in tests

### 3.4 CSS / assets / SVG handling
- Ensure Vite/Vitest ignores CSS imports cleanly (usually works by default in Vite projects).
- If SVG/asset imports break tests, add simple module mocks:
  - `*.svg` → returns a stub React component or string
  - `*.css` → empty module (if needed)

### 3.5 Engine mock improvements
You already have a strong `engineMock.ts`. Extend it for component tests:
- Add a **factory**: `createEngineMock(overrides?)` returning:
  - the EngineBridge mock
  - spies for each method
  - `reset()` to clear call counts/state between tests
- Add "strictness knobs":
  - default: permissive, returns stable NodeSpecs
  - option: "strict mode" to fail tests if unexpected engine calls occur
- Add utilities to override NodeSpec per-test (to test BaseNode rendering variations without editing the global 40+ specs)

---

## 4) Priority components (ranked) + test scenarios

### P0 — BaseNode (fastest ROI; stabilizes many nodes)
**Scenarios**
1. **Renders inputs/outputs + title** from NodeSpec.
2. **Renders param controls** for core param types used in specs:
   - number slider/input
   - boolean toggle
   - enum/select
   - color param (renders control shell; color math can be mocked)
3. **Disabled/muted state**
   - toggling mute/disable updates store and calls engine first
4. **Error badges**
   - given node error in store, badge appears + tooltip text (if applicable)
5. **Param change wiring**
   - change a control → store updates → engine `set_param` called with correct node/param id/value
   - verify ordering: engine call happens before local state commit (per architecture rule)

### P0 — NodeCanvas (critical path; highest integration value)
**Scenarios**
1. **Create node via UI**
   - open NodeLibrary/search (or context menu) → select a node type → node appears on canvas
   - verify engine `add_node` called, store contains new node, node DOM visible
2. **Select + delete node**
   - click node → selected state visible (class/aria)
   - press `Backspace/Delete` (and/or context menu delete) → engine `delete_node` called
   - verify edges removed + selection cleared + node removed from DOM
3. **Connect nodes**
   - create two nodes with compatible ports
   - connect output→input via:
     - preferred: simulate handle drag with pointer events (if stable)
     - fallback (acceptable): trigger connection through the UI path that calls the same handler (e.g., "connect" action) or via exposed hook (see "Risks")
   - verify engine `connect` called and edge appears in store/DOM
4. **Undo/redo from canvas interactions**
   - create node → undo → node removed
   - redo → node returns
   - assert engine undo/redo calls and store graph state
5. **Context menu actions**
   - right-click pane → menu opens (role=menu)
   - actions: add node, delete selection, duplicate (if exists)

### P0/P1 — CurvesNode (complex interaction; ensures gesture semantics)
**Scenarios**
1. **Initial curve renders** from param value (assert presence of control points/handles, not pixels).
2. **Drag a control point**
   - pointer down/move/up on a handle
   - during drag: engine receives live `set_param` updates (possibly throttled)
   - on pointer up: a single undo checkpoint is created (or "commit" action called)
3. **Reset / preset actions**
   - click reset → curve param returns to default; engine call verified
4. **Keyboard accessibility (if supported)**
   - focus a handle (tab) → arrow keys adjust point → param updates

### P1 — Viewer (integration with render triggers; keep lightweight)
**Scenarios**
1. **Changing channel isolation / gain-gamma** updates store and triggers render request (verify engine "render/eval" call).
2. **Pixel inspector toggles** show/hide UI; no need to assert actual pixel values.

### P1 — Parameter controls used widely (ColorPicker, ColorRamp)
**Scenarios**
- "Shell-level" correctness:
  - opens/closes popover
  - emits value on interaction
  - respects disabled state
- Defer precise color math / gradient sampling (mock canvas where needed).

### P2 — ScriptNodeEditor (Monaco)
**Strategy**
- Mock Monaco component (`@monaco-editor/react`) to a `<textarea>` adapter in tests.
**Scenarios**
- change text → store updates → engine shader update method called.

---

## 5) Store integration tests (component↔store)

Focus on "wiring correctness" rather than duplicating large store test suites.

### Target integration behaviors
1. **Undo/redo round-trips**
   - Perform action via UI (create/delete/connect)
   - Trigger undo/redo via toolbar shortcuts or store actions exposed in UI
   - Assert DOM + store state returns to exact prior shape
2. **Live parameter gestures**
   - Slider drag or curve drag:
     - multiple intermediate engine calls allowed
     - exactly one undo entry (or one "commit") at gesture end
3. **Node deletion cleanup**
   - deleting a node removes:
     - its edges
     - its selection state
     - dependent UI panels (inspector) if they depend on selection
   - engine calls should reflect "engine first" rule

---

## 6) UX considerations (accessibility)

### Baseline a11y checks (in component tests)
- All actionable controls have:
  - accessible name (`aria-label`/label text)
  - correct role (`button`, `textbox`, `menuitem`, etc.)
- Keyboard navigation:
  - NodeCanvas: selection via click + delete via keyboard
  - BaseNode: tab order reaches param controls
- Focus management:
  - menus/popovers trap/restore focus as expected (basic assertions)

### Optional automated a11y scan
- Run `axe` on:
  - NodeCanvas screen shell
  - BaseNode with a representative set of params
  - Viewer panel
- Assert no serious/critical violations.

---

## 7) Edge cases (what to explicitly cover)

### ReactFlow-heavy interactions
- Drag/zoom are often flaky in jsdom. Prioritize:
  - selection
  - connect/disconnect
  - keyboard delete
  - context menu actions
- If zoom/pan are essential, test the **state change** (store transform) rather than pixel coordinates.

### Canvas rendering
- Avoid pixel assertions.
- Assert:
  - correct calls made (e.g., "set curve param")
  - presence of expected DOM handles/controls
  - that canvas methods were invoked (only if necessary)

### WebGL/GPU components
- Do not attempt real WebGL in jsdom.
- Mock WebGL context and assert:
  - the component requests initialization
  - error paths show a friendly fallback UI (if exists)

---

## 8) Mocking strategy (what to mock vs keep real)

### Keep real
- Zustand store slices (real store composition)
- Most presentational components
- NodeSpec-driven rendering logic (this is what we want confidence in)
- React Testing Library + user-event (real interactions)

### Mock / stub
- **EngineBridge**: always mock (use existing engineMock)
- **ReactFlow internals only when needed**
  - Prefer real `@xyflow/react` first
  - If tests are too flaky, mock the lowest-level parts (e.g., viewport/zoom) but keep NodeCanvas handlers real
- **Canvas/WebGL**: stub `getContext` with minimal fake contexts
- **Monaco**: replace with simple input component

### "Refactor allowance" (if required for testability)
If connection-drag tests are unreliable, extract NodeCanvas's event handlers into a small hook/module:
- `useNodeCanvasHandlers(store, engine)` returning `onConnect`, `onNodesDelete`, etc.
- Unit-test handlers in node env; keep one or two jsdom "smoke" tests to ensure wiring.

---

## 9) Test organization

### Naming conventions
- Component tests: `*.component.test.tsx` (ensures jsdom routing)
- Store/unit tests: keep existing `*.test.ts` in node env

### Suggested structure
- `src/__tests__/setup.ts` (existing; node env)
- `src/__tests__/setup.dom.ts` (new; jsdom env)
- `src/__tests__/utils/renderWithProviders.tsx`
- `src/__tests__/utils/reactflow.ts` (bounding boxes, container helpers)
- `src/__tests__/mocks/engine.ts` (factory wrapper around engineMock)
- Co-locate tests near components when practical:
  - `src/components/nodes/BaseNode.component.test.tsx`
  - `src/components/NodeCanvas/NodeCanvas.component.test.tsx`
  - `src/components/nodes/CurvesNode.component.test.tsx`

### Test style guidelines
- Prefer role/name queries: `getByRole('button', { name: /delete/i })`
- Avoid snapshots for complex DOM; assert meaningful outcomes (store state, engine calls, visible controls)
- Use `userEvent` for interactions; reserve `fireEvent` for edge cases (contextmenu, low-level pointer)

---

## 10) CI integration

### Commands
- Add a dedicated script for component tests, e.g.:
  - `yarn test:components` → vitest run for `*.component.test.*`
  - keep existing `yarn test` for full suite (store + component)

### Coverage
- Enable coverage reporting (Vitest built-in coverage, typically `@vitest/coverage-v8`)
- Start with **modest thresholds** to avoid blocking adoption:
  - global: statements/lines ~20–30% initially
  - raise thresholds after P0 coverage stabilizes

### CI wiring
- Ensure the existing frontend CI job runs:
  - lint
  - typecheck
  - unit/component tests
  - coverage upload (optional)

---

## 11) Step-by-step implementation checklist

### A. Stack + config (foundation)
- [ ] Add deps: `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`
- [ ] Update Vitest config to run `*.component.test.*` in **jsdom** while keeping others in **node**
- [ ] Add `src/__tests__/setup.dom.ts` with jsdom polyfills + `jest-dom` import
- [ ] Add canvas/WebGL stubs (minimal; only what current components require)

### B. Shared test harness
- [ ] Implement `createEngineMock()` factory + `reset()` and per-test overrides
- [ ] Implement `renderWithProviders()` wrapper:
  - [ ] real store composition
  - [ ] ReactFlowProvider wrapper for canvas/node tests
  - [ ] stable container sizing helpers

### C. P0 tests
- [ ] BaseNode: render + param controls + mute/disable + error badge + param change calls engine
- [ ] NodeCanvas: create node + select + delete via keyboard + undo/redo
- [ ] NodeCanvas: connect nodes (attempt real pointer drag; fallback to handler testing if unstable)
- [ ] CurvesNode: drag handle updates param (live updates) + commit semantics

### D. Integration behaviors
- [ ] Undo/redo round-trip initiated from UI controls/shortcuts
- [ ] Live gesture tests (slider or curves): many updates, single undo commit
- [ ] Node deletion cleanup: edges removed, inspector cleared, selection reset

### E. A11y baseline
- [ ] Add role/name assertions for key controls
- [ ] (Optional) Add `axe` smoke checks for NodeCanvas shell + BaseNode

### F. CI + stability
- [ ] Add CI command for component tests + coverage
- [ ] Identify and quarantine flaky tests:
  - [ ] remove timing dependence (use `waitFor`)
  - [ ] fix bounding boxes / RAF
  - [ ] mock only the unstable pieces

---

## 12) Risks and mitigations

### Risk: ReactFlow drag/connect flakiness in jsdom
**Mitigation**
- Provide stable container geometry + pointer event shims.
- If still flaky, test connection via extracted handler hook (unit-level) and keep a minimal jsdom smoke test for wiring.

### Risk: Canvas/WebGL-heavy components are not meaningfully testable in jsdom
**Mitigation**
- Stub contexts; assert state changes + engine calls + fallback UI.
- Keep true rendering validation in Playwright (already in CI).

### Risk: Tests become tightly coupled to DOM structure/classes
**Mitigation**
- Prefer a11y queries (roles/names) and stable test-ids only where necessary (handles/control points).
- Assert outcomes (store state, engine calls) rather than internal DOM nesting.

---

## Escalation triggers (when to revisit with a more complex approach)
- Connection/drag interactions remain flaky after geometry + pointer shims.
- Components depend on real layout measurement or WebGL behavior for correctness.

## Alternative sketch (only if needed)
- Add a small "interaction harness" layer:
  - unit-test ReactFlow event handlers (node env)
  - keep jsdom tests for rendering and non-drag interactions
  - rely on Playwright for full drag/connect fidelity
