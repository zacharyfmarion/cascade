use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupDefinition {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub internal_graph: SerializableInternalGraph,
    pub promotions: Vec<Promotion>,
    pub is_builtin: bool,
    /// When set, these override the connection-derived interface ports.
    #[serde(default)]
    pub explicit_inputs: Option<Vec<PortSpec>>,
    #[serde(default)]
    pub explicit_outputs: Option<Vec<PortSpec>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializableInternalGraph {
    pub nodes: Vec<InternalNode>,
    pub connections: Vec<InternalConnection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InternalNode {
    pub id: String,
    pub type_id: String,
    pub params: HashMap<String, ParamValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_data: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub input_defaults: HashMap<String, ParamValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InternalConnection {
    pub from_node: String,
    pub from_port: String,
    pub to_node: String,
    pub to_port: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Promotion {
    pub group_param_key: String,
    pub internal_node_id: String,
    pub internal_param_key: String,
    pub spec: ParamSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupInterface {
    pub inputs: Vec<PortSpec>,
    pub outputs: Vec<PortSpec>,
}

/// Portable package format for sharing custom nodes (.compnode files).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodePackage {
    /// Format version for forward compatibility.
    pub version: u32,
    /// The compositor version that exported this package (informational).
    #[serde(default)]
    pub compositor_version: String,
    /// ISO 8601 timestamp of when the package was exported.
    #[serde(default)]
    pub exported_at: String,
    /// One or more group definitions. Ordered so dependencies come first.
    pub nodes: Vec<GroupDefinition>,
}

/// Metadata about an installed custom node package (used by the desktop manager).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomNodeInfo {
    /// The group definition ID (e.g. "group::imported_<uuid>").
    pub id: String,
    /// Display name.
    pub name: String,
    /// Category in the node library.
    pub category: String,
    /// Description text.
    pub description: String,
    /// Number of group definitions in the source package.
    pub node_count: usize,
    /// Path to the .compnode file on disk (desktop only).
    #[serde(default)]
    pub file_path: String,
}
