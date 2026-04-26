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
- [ ] Add group/GPU definition parsing and execution once APIs exist.
- [x] Run `yarn test`, `yarn lint`, and `npx tsc -b --noEmit`.

## Assumptions

- DSL is for semantic graph authoring, not full project serialization.
- Layout/UI state and frames are preserved but not authored in DSL.
- Asset data is referenced by constructors and persisted through existing project mechanisms, not inlined.
- Arrow syntax is final for connections.
- AI tools and visible editor must share one parser, formatter, validator, and syntax guide.
