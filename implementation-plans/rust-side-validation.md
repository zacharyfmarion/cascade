# Rust-Side Graph Validation

## Problem

The DSL validator in TypeScript re-implements semantic checks that the Rust engine already owns:
- **Type compatibility** — TS does exact-match (`outputSpec.ty !== inputSpec.ty`), but Rust allows implicit coercions (Int↔Float, Field→Image/Mask). This causes false errors.
- **Port existence** — TS checks port names against `NodeSpec`, duplicating what `graph.connect()` already validates.
- **Cycle detection** — TS runs its own DFS, duplicating `graph.has_path()`.

These will continue to diverge as the type system evolves (e.g., adding new coercion rules, polymorphic ports, or custom type constraints).

## Approach

**Keep parsing and source mapping in TypeScript. Move all semantic validation to Rust via a new WASM endpoint.**

The key insight: the Rust engine already validates everything when you call `graph.connect()`, `graph.add_node()`, etc. We just need a way to do a **dry run** — validate a batch of proposed edits without committing them.

### What stays in TypeScript
- DSL parser (text → AST) — Rust doesn't know about DSL syntax
- Source map generation (line numbers, spans) — UI concern
- Structural/syntactic checks that are purely about the DSL format:
  - Duplicate handle names (DSL concept, not a graph concept)
  - Unknown handles in connections (resolved before hitting Rust)
  - Fuzzy "did you mean?" suggestions (UI polish)
  - Warnings (no viewer, disconnected nodes)

### What moves to Rust
- Type compatibility checking
- Port existence validation
- Cycle detection
- Node type existence (already validated by `add_node`)
- Any future semantic rules (param range validation, connection cardinality, etc.)

## Design

### Phase 1: Add `validate_edits()` to the WASM bridge

Add a new function to `cascade-wasm`:

```rust
/// Validate a batch of proposed graph edits without committing them.
/// Returns a list of structured errors, each tagged with the operation index.
pub fn validate_edits(&self, edits_json: &str) -> Result<JsValue, JsValue> {
    let edits: Vec<EditOp> = serde_json::from_str(edits_json)
        .map_err(|e| to_engine_error(CascadeError::Other(e.to_string())))?;

    let errors = self.validate_edits_internal(&edits)
        .map_err(to_engine_error)?;

    serde_wasm_bindgen::to_value(&errors)
        .map_err(|e| to_engine_error(CascadeError::Other(e.to_string())))
}
```

### Phase 2: Define the Edit IR

The edit operations mirror the existing `GraphMutation` type in TypeScript:

```rust
#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum EditOp {
    #[serde(rename = "addNode")]
    AddNode { op_id: usize, type_id: String },

    #[serde(rename = "removeNode")]
    RemoveNode { op_id: usize, node_id: String },

    #[serde(rename = "connect")]
    Connect {
        op_id: usize,
        from_node: String,  // UUID or temp ID from AddNode
        from_port: String,
        to_node: String,
        to_port: String,
    },

    #[serde(rename = "disconnect")]
    Disconnect {
        op_id: usize,
        to_node: String,
        to_port: String,
    },
}

#[derive(Serialize)]
pub struct EditValidationError {
    /// Index of the operation that failed
    pub op_id: usize,
    /// Structured error kind for programmatic handling
    pub kind: EditErrorKind,
    /// Human-readable message
    pub message: String,
}

#[derive(Serialize)]
#[serde(tag = "type")]
pub enum EditErrorKind {
    TypeMismatch { from_type: String, to_type: String },
    PortNotFound { node_type: String, port_name: String },
    NodeNotFound { node_id: String },
    UnknownNodeType { type_id: String },
    CycleDetected,
}
```

Note: `op_id` is a simple index that TypeScript assigns to each operation. TypeScript uses the source map to translate `op_id` back to a DSL line number for Monaco markers.

### Phase 3: Implement validation via graph clone

```rust
fn validate_edits_internal(&self, edits: &[EditOp]) -> Result<Vec<EditValidationError>, CascadeError> {
    // Clone the graph for dry-run validation
    let mut shadow = self.graph.clone();
    // Track temp node IDs from AddNode operations
    let mut temp_ids: HashMap<String, NodeId> = HashMap::new();
    let mut errors = Vec::new();

    for edit in edits {
        match edit {
            EditOp::AddNode { op_id, type_id } => {
                if self.registry.get_spec(type_id).is_none() {
                    errors.push(EditValidationError {
                        op_id: *op_id,
                        kind: EditErrorKind::UnknownNodeType { type_id: type_id.clone() },
                        message: format!("Unknown node type: {}", type_id),
                    });
                    continue;
                }
                let id = shadow.add_node(type_id);
                // Use op_id as temp identifier so Connect can reference it
                temp_ids.insert(format!("__temp_{}", op_id), id);
            }
            EditOp::Connect { op_id, from_node, from_port, to_node, to_port } => {
                let from_id = self.resolve_node_id(&shadow, &temp_ids, from_node);
                let to_id = self.resolve_node_id(&shadow, &temp_ids, to_node);

                match (from_id, to_id) {
                    (Some(fid), Some(tid)) => {
                        if let Err(e) = shadow.connect(&self.registry, fid, from_port, tid, to_port) {
                            errors.push(EditValidationError {
                                op_id: *op_id,
                                kind: cascade_error_to_edit_kind(&e),
                                message: e.to_string(),
                            });
                        }
                    }
                    _ => {
                        // Node resolution failed — skip, TS-side handles unknown handles
                    }
                }
            }
            // ... RemoveNode, Disconnect similarly
        }
    }

    Ok(errors)
}
```

The key property: `shadow.connect()` calls the **exact same** `types_compatible()`, cycle detection, and port validation as the real `graph.connect()`. Zero divergence by construction.

### Phase 4: Wire into the TypeScript DSL pipeline

Update `validator.ts` to only do structural checks:

```typescript
// validator.ts — AFTER refactor
export const validateAst = (ast: DslAst, nodeSpecs: NodeSpec[]): ValidationResult => {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Structural checks (DSL-specific, stay in TS)
  validateDuplicateHandles(ast, errors);
  validateUnknownHandles(ast, errors);  // with fuzzy suggestions
  validateWarnings(ast, warnings);

  // Semantic checks REMOVED — moved to Rust via validate_edits()
  // No more: type compatibility, port existence, cycle detection

  return { valid: errors.length === 0, errors, warnings };
};
```

Add a new semantic validation step in the DSL pipeline:

```typescript
// semanticValidator.ts — NEW
export const validateSemantics = async (
  mutations: GraphMutation[],
  sourceMap: DslSourceMap,
  handleMap: HandleMap,
): Promise<ValidationError[]> => {
  const engine = getEngine();

  // Convert GraphMutation[] to EditOp[] with op_ids
  const editOps = mutations.map((m, i) => toEditOp(m, i, handleMap));
  const result = engine.validateEdits(JSON.stringify(editOps));

  // Map op_id → DSL line number using source map
  return result.map(err => ({
    line: resolveLineFromOpId(err.op_id, mutations, sourceMap),
    message: err.message,
  }));
};
```

### Phase 5: Update the DSL editor pipeline

In `DslEditor.tsx`, the flow becomes:

```
User types → parse (TS) → structural validate (TS) → show syntax errors immediately
                        → diff → validate_edits (WASM) → show semantic errors
                        → apply (if all pass)
```

The structural validation stays instant (no WASM call). The semantic validation happens on the same debounce as the apply — it's effectively free since WASM calls are synchronous and fast.

In `executor.ts`'s `applyDsl()`:

```typescript
// After parse + structural validation pass:
const mutations = diffAst(currentAst, newAst);

// Semantic validation via Rust (dry run)
const semanticErrors = await validateSemantics(mutations, sourceMap, handleMap);
if (semanticErrors.length > 0) {
  return { success: false, errors: semanticErrors };
}

// Apply for real (same mutations, guaranteed to succeed)
const applyResult = await applyMutations(mutations, handleMap, nodeSpecs, { origin: 'dsl', awaitRender: true });
```

## Migration plan

### Step 1: Rust side (cascade-core + cascade-wasm)
1. Add `EditOp`, `EditValidationError`, `EditErrorKind` types to `cascade-core` (or a new `cascade-core::validation` module)
2. Add `validate_edits_internal()` to `Engine` in `cascade-wasm`
3. Expose `validate_edits()` via `#[wasm_bindgen]`
4. Add unit tests: Int→Float connect should pass, Image→Float should fail, cycle should fail

### Step 2: TypeScript side
1. Add `validateEdits()` to `EngineBridge` interface and `WasmEngine`/`TauriEngine` implementations
2. Create `semanticValidator.ts` with the `toEditOp()` and `validateSemantics()` functions
3. Strip semantic checks from `validator.ts` (remove `validateConnections`'s type/port/cycle checks, keep handle resolution and duplicate handle detection)
4. Update `applyDsl()` in `executor.ts` to call `validateSemantics()` before applying
5. Update `DslEditor.tsx` to show semantic errors as markers

### Step 3: Cleanup
1. Remove dead code from `validator.ts` (cycle detection DFS, type checking)
2. Update validator tests
3. Add integration test: DSL with Int→Float connection validates and applies without errors

## What we're NOT doing (and why)

- **Not moving the parser to Rust** — The DSL is a UI-layer concept. The parser feeds Monaco directly, and Rust doesn't need to know about handles, line numbers, or DSL syntax. Moving it would slow iteration on DSL features.
- **Not moving param validation to Rust** — Param type checking and range validation are cheap, stable, and benefit from TS-side formatting. They can move later if needed, but they're low divergence risk.
- **Not creating a separate "validator graph"** — We clone the real graph for each validation. For Cascade-scale graphs (10s–100s of nodes), this is negligible. Only revisit if profiling shows a problem.

## Effort estimate

~1.5 days:
- Day 1: Rust types + validate_edits implementation + tests
- Day 1.5: TypeScript wiring + validator refactor + cleanup

## Testing

- **Rust unit tests**: Int→Float connects, Float→Int connects, Field→Image connects, Image→Float rejects, cycle rejects, unknown port rejects
- **TypeScript integration tests**: Full DSL text with implicit coercions validates and applies cleanly
- **Manual test**: Type in DSL editor with Int→Float connection, verify no red squiggles
