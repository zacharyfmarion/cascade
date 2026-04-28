# DSL Editor Production Readiness

## Goal

Make the Cascade DSL a production-ready, functional-style graph authoring language for the editor and AI tools. The graph/document model remains the source of truth; DSL text is a parsed, formatted, editable projection.

Core syntax decisions:

- Functional node construction: `blur = GaussianBlur(amount: 12.0)`.
- Functional wrappers for node modifiers: `blur = muted(GaussianBlur(amount: 12.0))`.
- Arrow syntax for connections: `plate.image -> blur.image`.
- No node positions, canvas coordinates, frames, or frame metadata in DSL.
- Asset constructors inline: `image(...)`, `sequence(...)`, `video(...)`, `images(...)`.
- Group and GPU script definitions share a custom-node definition style.

## Approach

Use a staged migration so current graph editing keeps working while the new language foundation lands.

1. Add the durable plan and update tests around the agreed syntax.
2. Replace the regex-only DSL path with a parser/formatter foundation that understands versioned documents, `graph { ... }`, arrow connections, `muted(...)`, inline asset constructors, and multiline code/string blocks.
3. Keep serialization pure: formatting must not mutate Zustand or assign handles as a side effect.
4. Update AI tool instructions and schemas so the assistant emits the new syntax.
5. Extend the execution path for group internals and GPU definitions only after the required engine/store APIs exist.

Recommended parser library for the full production parser is Chevrotain: it is TypeScript-native, works with Monaco, supports CST output, and has fault-tolerant parsing suitable for live diagnostics.

## Language Shape

```cascade
cascade 1

graph {
  plate = LoadImage(path: image("file:///shots/a/plate.exr", color_space: "sRGB"))
  blur = muted(GaussianBlur(amount: 12.0))
  view = Viewer()

  plate.image -> blur.image
  blur.image -> view.image
}
```

```cascade
graph {
  still = LoadImage(path: image("file:///plate.exr", color_space: "sRGB"))
  seq = LoadImageSequence(path: sequence("file:///shot.%04d.exr", first: 1001, last: 1100))
  clip = LoadVideo(path: video("file:///ref.mov"))
  batch = LoadImageBatch(files: images([
    "file:///a.png",
    "file:///b.png"
  ]))
}
```

```cascade
node KeyMix = group {
  inputs {
    image plate
    image foreground
    mask matte
  }

  outputs {
    image image
  }

  params {
    float opacity = 1.0 min 0.0 max 1.0 step 0.01
    bool invert_matte = false
  }

  graph {
    inv = InvertMask(enabled: param.invert_matte)
    over = AlphaOver(opacity: param.opacity)

    input.matte -> inv.mask
    input.plate -> over.background
    input.foreground -> over.foreground
    inv.mask -> over.mask
    over.image -> output.image
  }
}
```

```cascade
node FilmGlow = gpu {
  inputs {
    image image
    mask mask?
    float gain = 1.2 min 0.0 max 4.0 step 0.01
  }

  outputs {
    image image
  }

  code """
  vec3 glow = color.rgb * gain;
  return vec4(glow, color.a);
  """
}
```

## Affected Areas

- `apps/web/src/ai/dsl/*`: parser, AST, serializer, formatter, validator, differ, executor.
- `apps/web/src/ai/tools.ts`: AI syntax instructions and tool descriptions.
- `apps/web/src/components/DslEditor.tsx`: Monaco language tokens, diagnostics, format/apply behavior.
- `apps/web/src/store/graphStore/*`: handle persistence and future internal group mutation support.
- `apps/web/src/engine/*` and `crates/cascade-wasm`: future internal group/GPU definition APIs.

## Architecture Status

Root graph DSL edits can be parsed, validated, diffed, and applied through the existing executor. Internal group authoring is not yet cleanly implementable as DSL execution because the current engine bridge exposes group interface edits and internal connection edits, but not the full internal graph mutation surface needed by the DSL:

- add/remove internal group nodes
- set internal group node params and input defaults
- set internal group node mute state
- compile/update GPU script nodes inside a group definition
- register or replace a complete custom `node Name = group/gpu { ... }` definition from parsed DSL

Those APIs should be added before enabling parsed group/GPU definitions in the executor; otherwise the DSL would accept syntax that cannot be applied reliably.

### GPU Script Identity Follow-Up

GPU script nodes currently have two identities:

- the live graph/runtime instance id and `gpu_script::<uuid>` type id, with source stored in `__script_manifest`
- the DSL projection, which lifts that instance into `node GpuNode1 = gpu { ... }` plus `gpu1 = GpuNode1()`

That projection is correct syntactically, but it makes stable handle mapping essential. A generated DSL handle must resolve back to the same live node on parse/apply, otherwise edits can be interpreted as a new named GPU kernel instead of recompiling the existing script instance. The immediate fix is to make `deriveHandleMap()` populate deterministic handles for all current nodes, not only nodes that already have an explicit `dslHandle`.

Longer term, production readiness still needs a first-class shadow document/revision model so comments, formatting, custom definition names, and generated handles are preserved intentionally instead of being rediscovered from graph order on every sync.

## Checklist

- [x] Save this implementation plan.
- [x] Audit current DSL and AI tool syntax on latest `main`.
- [x] Add parser/formatter support for `cascade 1`, `graph { ... }`, arrow connections, and `muted(...)`.
- [x] Add inline asset constructor parsing/formatting.
- [x] Remove legacy `@muted` and `<-` compatibility; only the new syntax is supported.
- [x] Update Monaco tokenization for the new syntax.
- [x] Update AI tool descriptions and syntax guidance.
- [x] Clarify loader asset semantics: embedded web assets stay in project state and are omitted from DSL.
- [x] Route desktop `LoadImage(path: image(...))` edits through asset loading and surface invalid path errors in the DSL editor.
- [x] Add tests for arrows, wrappers, graph blocks, assets, and formatting.
- [x] Add coverage tooling and thresholds for DSL code.
- [x] Identify required internal group engine APIs.
- [x] Implement required internal group engine APIs.
- [x] Add group/GPU definition parsing and execution once APIs exist.
  - [x] Parse top-level `node Name = group/gpu { ... }` definitions into the DSL AST.
  - [x] Parse declaration sections, GPU code blocks, group internal graph statements, and `param.*` references.
  - [x] Validate custom definition signatures and internal graph references.
  - [x] Execute GPU definitions by registering/replacing GPU script specs before applying root graph edits.
  - [x] Execute group definitions by registering stable group definitions before applying root graph edits.
  - [x] Serialize/format custom definitions canonically.
- [x] Keep GPU script instance specs available to React Flow after recompiling or loading script nodes.
- [x] Recompile serialized GPU script definitions when the editor applies with a freshly derived handle map.
- [x] Preserve edited GPU script code through mute/unmute serialization.
- [x] Serialize UI-created group nodes as full `node Name = group { ... }` definitions instead of opaque `group::user_*` instances.
- [x] Include runtime group definitions in DSL shadow hashes so internal group edits invalidate stale DSL text.
- [x] Hydrate and refresh runtime group definitions from `exportGraph()` for save/load, group creation, and internal group edits.
- [x] Prune unused runtime/custom group definitions after DSL group renames while preserving reachable nested group dependencies.
- [x] Derive custom group instance handles and canvas display names from preserved DSL definition names when runtime specs still use generic group names.
- [x] Sync custom group definition names bidirectionally between the canvas group title and DSL `node Name = group` blocks.
- [x] Validate DSL editor diagnostics against custom group/GPU definition specs.
- [x] Add first-class shadow document preservation for comments, custom definition names, and generated handles.
  - [x] Add optional `.casc` `dsl` metadata with Rust-owned schema and `1.3.0` migration.
  - [x] Persist and hydrate DSL shadow metadata in web and desktop project paths.
  - [x] Share shadow-aware handle resolution between the DSL editor and AI tools.
- [x] Run `yarn test`, `yarn lint`, and `npx tsc -b --noEmit`.

## Assumptions

- DSL is for semantic graph authoring, not full project serialization.
- Layout/UI state and frames are preserved but not authored in DSL.
- Asset data is referenced by constructors and persisted through existing project mechanisms, not inlined.
- Arrow syntax is final for connections.
- AI tools and visible editor must share one parser, formatter, validator, and syntax guide.
