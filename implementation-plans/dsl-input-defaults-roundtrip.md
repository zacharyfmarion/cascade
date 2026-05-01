# DSL Input Defaults Round Trip

## Goal

Make edited scalar input defaults on nodes round-trip through the graph DSL, so inline node input
controls such as Math `A` and `B` appear in DSL text, can be edited there, and apply back to
`node.inputDefaults`.

## Approach

Separate node params from input defaults in the DSL AST, teach parsing and validation to resolve
node-call entries against both params and scalar input ports, serialize unconnected scalar input
defaults when they differ from port defaults, and apply input default diffs through the existing
store `setInputDefault` path.

## Affected Areas

- `apps/web/src/ai/dsl/types.ts`
- `apps/web/src/ai/dsl/parser.ts`
- `apps/web/src/ai/dsl/validator.ts`
- `apps/web/src/ai/dsl/serializer.ts`
- `apps/web/src/ai/dsl/differ.ts`
- `apps/web/src/ai/dsl/executor.ts`
- DSL parser/serializer/differ/executor/roundtrip tests

## Checklist

- [x] Add DSL AST and mutation support for input defaults
- [x] Parse and validate scalar input defaults separately from params
- [x] Serialize unconnected scalar input defaults and collision syntax
- [x] Apply and diff input default mutations through the store
- [x] Add focused regression tests
- [x] Run frontend validation
