# DSL Synthetic Param Inputs

## Goal

Prevent DSL serialization from emitting duplicate entries when frontend node specs include
connectable params both in `params` and as synthetic inputs from `NodeSpec::all_inputs()`.

## Approach

Teach the graph serializer to skip input-default serialization for input ports that are mirrors of
connectable params, leaving those values to the existing param serialization path. Add regression
coverage that models the bridge-expanded spec shape seen for GPU nodes like Difference Matte.

## Affected Areas

- `apps/web/src/ai/dsl/serializer.ts`
- `apps/web/src/ai/dsl/__tests__/serializer.test.ts`

## Checklist

- [x] Skip synthetic param-backed inputs during input-default serialization
- [x] Add unit coverage for bridge-expanded param/input specs
- [x] Run focused DSL tests
- [x] Run frontend validation
