use serde_json::Value;

use super::MigrationError;

/// Migrate from v1.3.0 to v1.4.0.
///
/// v1.4.0 introduces optional asset storage metadata and canonical bundled asset
/// URIs. The new fields all deserialize with defaults, so existing v1.3.0
/// documents only need the envelope version bump.
pub fn migrate(doc: &mut Value) -> Result<(), MigrationError> {
    if !doc.is_object() {
        return Err(MigrationError::InvalidStructure(
            "Document root must be an object".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn preserves_existing_asset_metadata() {
        let mut doc = json!({
            "cascade": {"format_version": "1.3.0"},
            "project": {},
            "graph": {"nodes": [], "connections": [], "group_definitions": []},
            "asset_storage": "bundled",
            "assets": {
                "node-1": {
                    "type": "image",
                    "source": "packed",
                    "path": "assets/image.png",
                    "hash": "abc",
                    "uri": "asset://sha256/abc"
                }
            }
        });

        migrate(&mut doc).unwrap();

        assert_eq!(doc["asset_storage"].as_str(), Some("bundled"));
        assert_eq!(
            doc["assets"]["node-1"]["uri"].as_str(),
            Some("asset://sha256/abc")
        );
    }
}
