use serde_json::Value;

use super::MigrationError;

/// Migrate from v1.2.0 to v1.3.0.
///
/// v1.3.0 introduces an optional top-level `dsl` metadata section. Existing
/// documents should not synthesize DSL text during migration because the graph
/// remains the semantic source of truth and the DSL shadow is only a preserved
/// editor projection.
pub fn migrate(doc: &mut Value) -> Result<(), MigrationError> {
    if !doc.is_object() {
        return Err(MigrationError::InvalidStructure(
            "Document root must be an object".to_string(),
        ));
    }
    Ok(())
}
