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
