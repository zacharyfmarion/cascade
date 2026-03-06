use serde_json::Value;
use std::cmp::Ordering;
use std::fmt;

pub mod v1_0_0_to_v1_1_0;

/// Current document format version
pub const CURRENT_VERSION: &str = "1.1.0";

/// Error type for migration operations
#[derive(Debug, Clone)]
pub enum MigrationError {
    /// Document structure is invalid
    InvalidStructure(String),
    /// Document is from a future version
    FutureVersion(String, String),
    /// No migration path exists between versions
    NoMigrationPath(String, String),
    /// Migration logic failed
    MigrationFailed(String),
}

impl fmt::Display for MigrationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MigrationError::InvalidStructure(msg) => {
                write!(f, "Invalid document structure: {msg}")
            }
            MigrationError::FutureVersion(from, to) => {
                write!(f, "Document version {from} is newer than supported {to}")
            }
            MigrationError::NoMigrationPath(from, to) => {
                write!(f, "No migration path from {from} to {to}")
            }
            MigrationError::MigrationFailed(msg) => write!(f, "Migration failed: {msg}"),
        }
    }
}

impl std::error::Error for MigrationError {}

/// Report of migrations applied to a document
#[derive(Debug, Clone)]
pub struct MigrationReport {
    /// Version migrated from
    pub from_version: String,
    /// Version migrated to
    pub to_version: String,
    /// List of migration descriptions applied
    pub applied: Vec<String>,
}

/// A single migration step from one version to another
struct Migration {
    from_version: &'static str,
    to_version: &'static str,
    description: &'static str,
    migrate: fn(&mut Value) -> Result<(), MigrationError>,
}

/// Array of available migrations in order
/// Each migration transforms a document from one version to the next
/// Array of available migrations in order
/// Each migration transforms a document from one version to the next
static MIGRATIONS: &[Migration] = &[Migration {
    from_version: "1.0.0",
    to_version: "1.1.0",
    description: "Rename Viewer input port 'image' to 'value'",
    migrate: v1_0_0_to_v1_1_0::migrate,
}];

/// Extract the format version from a document.
/// Supports both the current `"cascade"` key and the legacy `"compositor"` key.
fn extract_version(doc: &Value) -> Result<String, MigrationError> {
    let meta = doc
        .get("cascade")
        .or_else(|| doc.get("compositor"))
        .ok_or_else(|| {
            MigrationError::InvalidStructure(
                "Missing cascade (or compositor) envelope field".to_string(),
            )
        })?;
    meta.get("format_version")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| {
            MigrationError::InvalidStructure(
                "Missing format_version in envelope".to_string(),
            )
        })
}

/// Set the format version in a document.
/// Also normalises the legacy `"compositor"` key to `"cascade"`.
fn set_version(doc: &mut Value, version: &str) -> Result<(), MigrationError> {
    // If the doc uses the old "compositor" key, rename it to "cascade"
    if let Some(obj) = doc.as_object_mut() {
        if obj.contains_key("compositor") && !obj.contains_key("cascade") {
            if let Some(val) = obj.remove("compositor") {
                obj.insert("cascade".to_string(), val);
            }
        }
    }
    if let Some(comp) = doc.get_mut("cascade") {
        if let Some(comp_obj) = comp.as_object_mut() {
            comp_obj.insert(
                "format_version".to_string(),
                Value::String(version.to_string()),
            );
            Ok(())
        } else {
            Err(MigrationError::InvalidStructure(
                "cascade field is not an object".to_string(),
            ))
        }
    } else {
        Err(MigrationError::InvalidStructure(
            "Missing cascade field".to_string(),
        ))
    }
}

/// Compare two semantic version strings lexicographically
/// This is a naive implementation; semantic versioning comparison can be added later
fn compare_versions(a: &str, b: &str) -> Ordering {
    a.cmp(b)
}

/// Check if a document needs migration
pub fn needs_migration(doc: &Value) -> bool {
    match extract_version(doc) {
        Ok(version) => version != CURRENT_VERSION,
        Err(_) => false,
    }
}

/// Migrate a document to the current version
///
/// Applies a sequence of migrations in order, updating the document's version
/// at each step. Returns a report of all migrations applied.
///
/// # Errors
///
/// Returns an error if:
/// - Document structure is invalid
/// - Document version is newer than current
/// - No migration path exists
/// - A migration step fails
pub fn migrate_document(doc: &mut Value) -> Result<MigrationReport, MigrationError> {
    let mut from_version = extract_version(doc)?;
    let mut applied = Vec::new();

    // Check if document is from the future
    if compare_versions(&from_version, CURRENT_VERSION) == Ordering::Greater {
        return Err(MigrationError::FutureVersion(
            from_version,
            CURRENT_VERSION.to_string(),
        ));
    }

    // If already at current version, return immediately
    if from_version == CURRENT_VERSION {
        return Ok(MigrationReport {
            from_version: from_version.clone(),
            to_version: CURRENT_VERSION.to_string(),
            applied,
        });
    }

    // Find and apply migration chain
    loop {
        if from_version == CURRENT_VERSION {
            break;
        }

        // Find the next migration step
        let migration = MIGRATIONS
            .iter()
            .find(|m| m.from_version == from_version)
            .ok_or_else(|| {
                MigrationError::NoMigrationPath(from_version.clone(), CURRENT_VERSION.to_string())
            })?;

        // Apply the migration
        (migration.migrate)(doc)?;

        // Update the version in the document
        set_version(doc, migration.to_version)?;

        applied.push(migration.description.to_string());
        from_version = migration.to_version.to_string();
    }

    Ok(MigrationReport {
        from_version: extract_version(doc).unwrap_or_default(),
        to_version: CURRENT_VERSION.to_string(),
        applied,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_extract_version_valid() {
        let doc = json!({
            "cascade": {
                "format_version": "1.0.0"
            }
        });
        assert_eq!(extract_version(&doc).unwrap(), "1.0.0");
    }

    #[test]
    fn test_extract_version_missing_cascade() {
        let doc = json!({});
        assert!(matches!(
            extract_version(&doc),
            Err(MigrationError::InvalidStructure(_))
        ));
    }

    #[test]
    fn test_extract_version_missing_format_version() {
        let doc = json!({
            "cascade": {}
        });
        assert!(matches!(
            extract_version(&doc),
            Err(MigrationError::InvalidStructure(_))
        ));
    }

    #[test]
    fn test_set_version() {
        let mut doc = json!({
            "cascade": {
                "format_version": "1.0.0"
            }
        });
        set_version(&mut doc, "1.1.0").unwrap();
        assert_eq!(extract_version(&doc).unwrap(), "1.1.0");
    }

    #[test]
    fn test_compare_versions() {
        assert_eq!(compare_versions("1.0.0", "1.0.0"), Ordering::Equal);
        assert_eq!(compare_versions("1.0.0", "1.1.0"), Ordering::Less);
        assert_eq!(compare_versions("1.1.0", "1.0.0"), Ordering::Greater);
    }

    #[test]
    fn test_needs_migration_current_version() {
        let doc = json!({
            "cascade": {
                "format_version": CURRENT_VERSION
            }
        });
        assert!(!needs_migration(&doc));
    }

    #[test]
    fn test_needs_migration_old_version() {
        let doc = json!({
            "cascade": {
                "format_version": "1.0.0"
            }
        });
        assert!(needs_migration(&doc));
    }

    #[test]
    fn test_migrate_document_already_current() {
        let mut doc = json!({
            "cascade": {
                "format_version": CURRENT_VERSION
            }
        });
        let report = migrate_document(&mut doc).unwrap();
        assert_eq!(report.from_version, CURRENT_VERSION);
        assert_eq!(report.to_version, CURRENT_VERSION);
        assert!(report.applied.is_empty());
    }

    #[test]
    fn test_migrate_document_future_version() {
        let mut doc = json!({
            "cascade": {
                "format_version": "2.0.0"
            }
        });
        assert!(matches!(
            migrate_document(&mut doc),
            Err(MigrationError::FutureVersion(_, _))
        ));
    }

    #[test]
    fn test_migrate_document_no_path() {
        let mut doc = json!({
            "cascade": {
                "format_version": "0.5.0"
            }
        });
        // Should fail because no migration path exists for 0.5.0
        assert!(matches!(
            migrate_document(&mut doc),
            Err(MigrationError::NoMigrationPath(_, _))
        ));
    }

    #[test]
    fn test_migrate_viewer_port_image_to_value() {
        let mut doc = json!({
            "cascade": {
                "format_version": "1.0.0"
            },
            "graph": {
                "nodes": [
                    {"id": "viewer-1", "type_id": "viewer"},
                    {"id": "math-1", "type_id": "math"}
                ],
                "connections": [
                    {"from_node": "math-1", "from_port": "value", "to_node": "viewer-1", "to_port": "image"}
                ],
                "group_definitions": []
            }
        });

        v1_0_0_to_v1_1_0::migrate(&mut doc).unwrap();

        let connection = &doc["graph"]["connections"][0];
        assert_eq!(connection["to_node"].as_str().unwrap(), "viewer-1");
        assert_eq!(connection["to_port"].as_str().unwrap(), "value");
        assert_eq!(connection["from_port"].as_str().unwrap(), "value");
    }

    #[test]
    fn test_non_viewer_connections_unchanged() {
        let mut doc = json!({
            "cascade": {
                "format_version": "1.0.0"
            },
            "graph": {
                "nodes": [
                    {"id": "math-1", "type_id": "math"},
                    {"id": "math-2", "type_id": "math"}
                ],
                "connections": [
                    {"from_node": "math-1", "from_port": "value", "to_node": "math-2", "to_port": "image"}
                ],
                "group_definitions": []
            }
        });

        v1_0_0_to_v1_1_0::migrate(&mut doc).unwrap();

        let connection = &doc["graph"]["connections"][0];
        assert_eq!(connection["to_port"].as_str().unwrap(), "image");
    }

    #[test]
    fn test_migrate_multiple_viewer_nodes() {
        let mut doc = json!({
            "cascade": {
                "format_version": "1.0.0"
            },
            "graph": {
                "nodes": [
                    {"id": "viewer-1", "type_id": "viewer"},
                    {"id": "viewer-2", "type_id": "viewer"},
                    {"id": "math-1", "type_id": "math"}
                ],
                "connections": [
                    {"from_node": "math-1", "from_port": "value", "to_node": "viewer-1", "to_port": "image"},
                    {"from_node": "math-1", "from_port": "value", "to_node": "viewer-2", "to_port": "image"}
                ],
                "group_definitions": []
            }
        });

        v1_0_0_to_v1_1_0::migrate(&mut doc).unwrap();

        assert_eq!(
            doc["graph"]["connections"][0]["to_port"].as_str().unwrap(),
            "value"
        );
        assert_eq!(
            doc["graph"]["connections"][1]["to_port"].as_str().unwrap(),
            "value"
        );
    }

    #[test]
    fn test_migrate_group_definition_connections() {
        let mut doc = json!({
            "cascade": {
                "format_version": "1.0.0"
            },
            "graph": {
                "nodes": [],
                "connections": [],
                "group_definitions": [
                    {
                        "id": "group-1",
                        "internal_graph": {
                            "nodes": [
                                {"id": "viewer-1", "type_id": "viewer"},
                                {"id": "math-1", "type_id": "math"}
                            ],
                            "connections": [
                                {"from_node": "math-1", "from_port": "value", "to_node": "viewer-1", "to_port": "image"}
                            ]
                        }
                    }
                ]
            }
        });

        v1_0_0_to_v1_1_0::migrate(&mut doc).unwrap();

        let group_conn = &doc["graph"]["group_definitions"][0]["internal_graph"]["connections"][0];
        assert_eq!(group_conn["to_port"].as_str().unwrap(), "value");
    }

    #[test]
    fn test_migrate_idempotent() {
        let mut doc = json!({
            "cascade": {
                "format_version": "1.0.0"
            },
            "graph": {
                "nodes": [
                    {"id": "viewer-1", "type_id": "viewer"},
                    {"id": "math-1", "type_id": "math"}
                ],
                "connections": [
                    {"from_node": "math-1", "from_port": "value", "to_node": "viewer-1", "to_port": "value"}
                ],
                "group_definitions": []
            }
        });

        v1_0_0_to_v1_1_0::migrate(&mut doc).unwrap();
        assert_eq!(
            doc["graph"]["connections"][0]["to_port"].as_str().unwrap(),
            "value"
        );

        v1_0_0_to_v1_1_0::migrate(&mut doc).unwrap();
        assert_eq!(
            doc["graph"]["connections"][0]["to_port"].as_str().unwrap(),
            "value"
        );
    }

    #[test]
    fn test_migration_missing_graph_nodes() {
        let mut doc = json!({
            "cascade": {
                "format_version": "1.0.0"
            }
        });

        assert!(matches!(
            v1_0_0_to_v1_1_0::migrate(&mut doc),
            Err(MigrationError::InvalidStructure(_))
        ));
    }

    #[test]
    fn test_migration_missing_connections_array() {
        let mut doc = json!({
            "cascade": {
                "format_version": "1.0.0"
            },
            "graph": {
                "nodes": [
                    {"id": "viewer-1", "type_id": "viewer"}
                ]
            }
        });

        assert!(matches!(
            v1_0_0_to_v1_1_0::migrate(&mut doc),
            Err(MigrationError::InvalidStructure(_))
        ));
    }

    #[test]
    fn test_extract_version_compositor_key() {
        let doc = json!({
            "compositor": {
                "format_version": "1.0.0"
            }
        });
        assert_eq!(extract_version(&doc).unwrap(), "1.0.0");
    }

    #[test]
    fn test_needs_migration_compositor_key() {
        let doc = json!({
            "compositor": {
                "format_version": "1.0.0"
            }
        });
        assert!(needs_migration(&doc));
    }

    #[test]
    fn test_migrate_renames_compositor_to_cascade() {
        let mut doc = json!({
            "compositor": {
                "format_version": "1.0.0"
            },
            "graph": {
                "nodes": [{"id": "v1", "type_id": "viewer"}],
                "connections": [],
                "group_definitions": []
            }
        });
        migrate_document(&mut doc).unwrap();
        assert!(doc.get("cascade").is_some());
        assert!(doc.get("compositor").is_none());
        assert_eq!(
            doc["cascade"]["format_version"].as_str().unwrap(),
            CURRENT_VERSION
        );
    }
}
