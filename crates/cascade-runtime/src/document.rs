use cascade_gpu::KernelManifest;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::SerializableGraph;

// Version history:
// 1.0.0 - Initial format
// 1.1.0 - Viewer node input port renamed from "image" to "value" for universal value inspection
// 1.2.0 - CPU/GPU node ID and port unification
// 1.3.0 - Optional DSL shadow document metadata
pub const CURRENT_FORMAT_VERSION: &str = "1.3.0";

#[derive(Serialize, Deserialize)]
pub struct CascadeDocument {
    pub cascade: DocumentHeader,
    pub project: ProjectMetadata,
    pub graph: SerializableGraph,
    #[serde(default)]
    pub assets: HashMap<String, AssetReference>,
    #[serde(default)]
    pub scripts: HashMap<String, ScriptEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<ViewState>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_dsl_shadow"
    )]
    pub dsl: Option<DslShadowMetadata>,
}

#[derive(Serialize, Deserialize)]
pub struct DocumentHeader {
    pub format_version: String,
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub modified_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct ProjectMetadata {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Serialize, Deserialize)]
pub struct AssetReference {
    #[serde(rename = "type")]
    pub asset_type: String,
    pub source: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub original_filename: String,
    #[serde(default)]
    pub hash: String,
}

#[derive(Serialize, Deserialize)]
pub struct ScriptEntry {
    pub manifest: KernelManifest,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DslShadowMetadata {
    #[serde(default = "default_dsl_shadow_version")]
    pub version: u32,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub graph_hash: String,
    #[serde(default)]
    pub handles: Vec<DslHandleEntry>,
    #[serde(default)]
    pub custom_definition_names: Vec<DslCustomDefinitionName>,
}

fn default_dsl_shadow_version() -> u32 {
    1
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DslHandleEntry {
    pub node_id: String,
    pub handle: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DslCustomDefinitionName {
    pub runtime_id: String,
    pub name: String,
}

fn deserialize_optional_dsl_shadow<'de, D>(
    deserializer: D,
) -> Result<Option<DslShadowMetadata>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value.and_then(|item| serde_json::from_value(item).ok()))
}

#[derive(Serialize, Deserialize)]
pub struct ViewState {
    #[serde(default)]
    pub viewport: ViewportState,
    #[serde(default)]
    pub theme: String,
    #[serde(default)]
    pub timeline: TimelineState,
}

#[derive(Serialize, Deserialize, Default)]
pub struct ViewportState {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
}

fn default_zoom() -> f64 {
    1.0
}

#[derive(Serialize, Deserialize, Default)]
pub struct TimelineState {
    #[serde(default)]
    pub current_frame: u64,
    #[serde(default = "default_fps")]
    pub fps: u32,
    #[serde(default = "default_true")]
    pub loop_playback: bool,
}

fn default_fps() -> u32 {
    24
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SerializableGraph;
    use serde_json::json;

    #[test]
    fn dsl_shadow_metadata_roundtrips() {
        let doc = json!({
            "cascade": {"format_version": CURRENT_FORMAT_VERSION},
            "project": {},
            "graph": {
                "nodes": [],
                "connections": [],
                "group_definitions": []
            },
            "dsl": {
                "version": 1,
                "text": "# keep me\ngraph {}",
                "graph_hash": "hash",
                "handles": [{"node_id": "node-1", "handle": "load1"}],
                "custom_definition_names": [{"runtime_id": "gpu_script::1", "name": "FilmGlow"}]
            }
        });

        let parsed: CascadeDocument = serde_json::from_value(doc).unwrap();
        let dsl = parsed.dsl.unwrap();

        assert_eq!(dsl.version, 1);
        assert_eq!(dsl.text, "# keep me\ngraph {}");
        assert_eq!(dsl.handles[0].node_id, "node-1");
        assert_eq!(dsl.custom_definition_names[0].name, "FilmGlow");
    }

    #[test]
    fn missing_dsl_shadow_metadata_is_optional() {
        let doc = json!({
            "cascade": {"format_version": CURRENT_FORMAT_VERSION},
            "project": {},
            "graph": {
                "nodes": [],
                "connections": [],
                "group_definitions": []
            }
        });

        let parsed: CascadeDocument = serde_json::from_value(doc).unwrap();
        assert!(parsed.dsl.is_none());
    }

    #[test]
    fn malformed_dsl_shadow_metadata_is_ignored() {
        let doc = json!({
            "cascade": {"format_version": CURRENT_FORMAT_VERSION},
            "project": {},
            "graph": {
                "nodes": [],
                "connections": [],
                "group_definitions": []
            },
            "dsl": "not an object"
        });

        let parsed: CascadeDocument = serde_json::from_value(doc).unwrap();
        assert!(parsed.dsl.is_none());
    }

    #[test]
    fn cascade_document_serializes_dsl_shadow_metadata() {
        let document = CascadeDocument {
            cascade: DocumentHeader {
                format_version: CURRENT_FORMAT_VERSION.to_string(),
                app_version: String::new(),
                created_at: String::new(),
                modified_at: String::new(),
            },
            project: ProjectMetadata {
                name: String::new(),
                author: String::new(),
                description: String::new(),
            },
            graph: SerializableGraph {
                nodes: vec![],
                connections: vec![],
                group_definitions: vec![],
            },
            assets: HashMap::new(),
            scripts: HashMap::new(),
            view: None,
            dsl: Some(DslShadowMetadata {
                version: 1,
                text: "graph {}".to_string(),
                graph_hash: "hash".to_string(),
                handles: vec![DslHandleEntry {
                    node_id: "node-1".to_string(),
                    handle: "load1".to_string(),
                }],
                custom_definition_names: vec![],
            }),
        };

        let value = serde_json::to_value(document).unwrap();
        assert_eq!(value["dsl"]["text"].as_str().unwrap(), "graph {}");
    }
}
