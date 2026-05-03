use crate::migrations;
use cascade_core::error::CascadeError;
use cascade_core::group::{GroupDefinition, NodePackage};
use cascade_core::node::NodeRegistry;
use cascade_core::types::{NodeSpec, ParamValue, PortSpec};
use cascade_nodes_std::group::GroupNode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::Arc;

pub const CURRENT_CNODE_FORMAT_VERSION: &str = "1.0.0";
pub const CNODE_EXTENSION: &str = "cnode";

const MAX_PACKAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_EMBEDDED_IMAGE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CnodeErrorKind {
    InvalidJson,
    InvalidVersion,
    FutureVersion,
    MigrationFailed,
    InvalidPackage,
    InvalidDefinition,
    UnknownNodeType,
    InvalidConnection,
    InvalidPromotion,
    PackageTooLarge,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CnodeError {
    pub kind: CnodeErrorKind,
    pub path: String,
    pub message: String,
}

impl CnodeError {
    pub fn new(kind: CnodeErrorKind, path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind,
            path: path.into(),
            message: message.into(),
        }
    }
}

impl fmt::Display for CnodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.path.is_empty() {
            write!(f, "{:?}: {}", self.kind, self.message)
        } else {
            write!(f, "{:?} at {}: {}", self.kind, self.path, self.message)
        }
    }
}

impl std::error::Error for CnodeError {}

impl From<CnodeError> for CascadeError {
    fn from(value: CnodeError) -> Self {
        CascadeError::Other(value.to_string())
    }
}

#[derive(Debug, Clone)]
pub struct PreparedCnodeImport {
    pub definitions: Vec<GroupDefinition>,
    pub specs: Vec<NodeSpec>,
}

pub fn export_package_json(
    nodes: Vec<GroupDefinition>,
    cascade_version: String,
) -> Result<String, CnodeError> {
    let package = NodePackage {
        format_version: CURRENT_CNODE_FORMAT_VERSION.to_string(),
        package_id: uuid::Uuid::new_v4().to_string(),
        cascade_version,
        exported_at: String::new(),
        nodes: nodes
            .into_iter()
            .map(|def| sanitize_group_definition(&def))
            .collect(),
    };
    serde_json::to_string_pretty(&package).map_err(|err| {
        CnodeError::new(
            CnodeErrorKind::InvalidPackage,
            "$",
            format!("Failed to serialize cnode package: {err}"),
        )
    })
}

pub fn parse_package_json(json_str: &str) -> Result<NodePackage, CnodeError> {
    if json_str.len() > MAX_PACKAGE_BYTES {
        return Err(CnodeError::new(
            CnodeErrorKind::PackageTooLarge,
            "$",
            format!(
                "Package is {} bytes, exceeding the {} byte limit",
                json_str.len(),
                MAX_PACKAGE_BYTES
            ),
        ));
    }

    let mut value: Value = serde_json::from_str(json_str).map_err(|err| {
        CnodeError::new(
            CnodeErrorKind::InvalidJson,
            "$",
            format!("Invalid cnode JSON: {err}"),
        )
    })?;

    if value.get("version").is_some() {
        return Err(CnodeError::new(
            CnodeErrorKind::InvalidVersion,
            "$.version",
            "Legacy numeric package versions are not supported; use format_version",
        ));
    }

    let format_version = value
        .get("format_version")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            CnodeError::new(
                CnodeErrorKind::InvalidVersion,
                "$.format_version",
                "Missing cnode format_version",
            )
        })?;

    match compare_versions(format_version, CURRENT_CNODE_FORMAT_VERSION)? {
        std::cmp::Ordering::Greater => {
            return Err(CnodeError::new(
                CnodeErrorKind::FutureVersion,
                "$.format_version",
                format!(
                    "Package version {format_version} is newer than supported {CURRENT_CNODE_FORMAT_VERSION}"
                ),
            ))
        }
        std::cmp::Ordering::Less | std::cmp::Ordering::Equal => {}
    }

    migrate_embedded_group_graphs(&mut value)?;

    serde_json::from_value(value).map_err(|err| {
        CnodeError::new(
            CnodeErrorKind::InvalidPackage,
            "$",
            format!("Invalid cnode package structure: {err}"),
        )
    })
}

pub fn prepare_import<F>(
    package: NodePackage,
    registry: &NodeRegistry,
    existing_groups: &HashMap<String, Arc<GroupDefinition>>,
    mut id_factory: F,
) -> Result<PreparedCnodeImport, CnodeError>
where
    F: FnMut() -> String,
{
    validate_package_shape(&package)?;

    let sorted = sort_definitions_by_dependency(&package.nodes, existing_groups)?;
    let mut id_remap = HashMap::new();
    for def in &package.nodes {
        id_remap.insert(def.id.clone(), id_factory());
    }

    let mut scratch_registry = registry.clone();
    let mut prepared_definitions = Vec::new();
    let mut prepared_specs = Vec::new();

    for (index, def) in sorted.into_iter().enumerate() {
        let mut remapped = def.clone();
        let original_id = remapped.id.clone();
        remapped.id = id_remap.get(&original_id).cloned().ok_or_else(|| {
            CnodeError::new(
                CnodeErrorKind::InvalidPackage,
                format!("$.nodes[{index}].id"),
                "Missing generated id remap",
            )
        })?;
        remapped.is_builtin = false;

        for internal in &mut remapped.internal_graph.nodes {
            if let Some(remapped_type) = id_remap.get(&internal.type_id) {
                internal.type_id = remapped_type.clone();
            }
        }

        validate_group_definition(&remapped, &scratch_registry, index)?;
        let arc_def = Arc::new(remapped.clone());
        let interface =
            GroupNode::derive_interface(&arc_def, &scratch_registry).map_err(|err| {
                CnodeError::new(
                    CnodeErrorKind::InvalidDefinition,
                    format!("$.nodes[{index}]"),
                    err,
                )
            })?;
        let spec = GroupNode::build_spec(&arc_def, &interface);
        GroupNode::from_definition(arc_def, &scratch_registry).map_err(|err| {
            CnodeError::new(
                CnodeErrorKind::InvalidDefinition,
                format!("$.nodes[{index}]"),
                err,
            )
        })?;
        scratch_registry.register_spec(&spec.id, spec.clone());

        prepared_definitions.push(remapped);
        prepared_specs.push(spec);
    }

    Ok(PreparedCnodeImport {
        definitions: prepared_definitions,
        specs: prepared_specs,
    })
}

pub fn sanitize_group_definition(definition: &GroupDefinition) -> GroupDefinition {
    let mut sanitized = definition.clone();
    sanitized.internal_graph.nodes = sanitized
        .internal_graph
        .nodes
        .iter()
        .map(|node| {
            let mut node = node.clone();
            node.params = strip_internal_params(&node.params);
            node
        })
        .collect();
    sanitized
}

fn strip_internal_params(params: &HashMap<String, ParamValue>) -> HashMap<String, ParamValue> {
    params
        .iter()
        .filter(|(key, _)| {
            key.as_str() == crate::GPU_SCRIPT_MANIFEST_PARAM_KEY || !key.starts_with("__")
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn migrate_embedded_group_graphs(package: &mut Value) -> Result<(), CnodeError> {
    let nodes = package.get("nodes").cloned().ok_or_else(|| {
        CnodeError::new(
            CnodeErrorKind::InvalidPackage,
            "$.nodes",
            "Missing nodes array",
        )
    })?;
    let mut synthetic = json!({
        "cascade": {"format_version": "1.0.0"},
        "project": {},
        "graph": {
            "nodes": [],
            "connections": [],
            "group_definitions": nodes
        }
    });
    migrations::migrate_document(&mut synthetic).map_err(|err| {
        CnodeError::new(
            CnodeErrorKind::MigrationFailed,
            "$.nodes",
            format!("Failed to migrate embedded group graph: {err}"),
        )
    })?;
    let migrated_nodes = synthetic
        .get_mut("graph")
        .and_then(|graph| graph.get_mut("group_definitions"))
        .cloned()
        .ok_or_else(|| {
            CnodeError::new(
                CnodeErrorKind::MigrationFailed,
                "$.nodes",
                "Migration did not return group definitions",
            )
        })?;
    package["nodes"] = migrated_nodes;
    Ok(())
}

fn validate_package_shape(package: &NodePackage) -> Result<(), CnodeError> {
    if package.nodes.is_empty() {
        return Err(CnodeError::new(
            CnodeErrorKind::InvalidPackage,
            "$.nodes",
            "Package must contain at least one custom node",
        ));
    }
    let mut ids = HashSet::new();
    for (index, def) in package.nodes.iter().enumerate() {
        if def.id.trim().is_empty() {
            return Err(CnodeError::new(
                CnodeErrorKind::InvalidDefinition,
                format!("$.nodes[{index}].id"),
                "Group definition id cannot be empty",
            ));
        }
        if !ids.insert(def.id.clone()) {
            return Err(CnodeError::new(
                CnodeErrorKind::InvalidPackage,
                format!("$.nodes[{index}].id"),
                format!("Duplicate group definition id '{}'", def.id),
            ));
        }
    }
    Ok(())
}

fn validate_group_definition(
    definition: &GroupDefinition,
    registry: &NodeRegistry,
    index: usize,
) -> Result<(), CnodeError> {
    let mut internal_ids = HashSet::new();
    let mut group_input_count = 0usize;
    let mut group_output_count = 0usize;

    for (node_index, node) in definition.internal_graph.nodes.iter().enumerate() {
        let path = format!("$.nodes[{index}].internal_graph.nodes[{node_index}]");
        if node.id.trim().is_empty() {
            return Err(CnodeError::new(
                CnodeErrorKind::InvalidDefinition,
                format!("{path}.id"),
                "Internal node id cannot be empty",
            ));
        }
        if !internal_ids.insert(node.id.clone()) {
            return Err(CnodeError::new(
                CnodeErrorKind::InvalidDefinition,
                format!("{path}.id"),
                format!("Duplicate internal node id '{}'", node.id),
            ));
        }
        match node.type_id.as_str() {
            "group_input" => group_input_count += 1,
            "group_output" => group_output_count += 1,
            type_id if registry.get_spec(type_id).is_none() => {
                return Err(CnodeError::new(
                    CnodeErrorKind::UnknownNodeType,
                    format!("{path}.type_id"),
                    format!("Unknown internal node type '{type_id}'"),
                ))
            }
            _ => {}
        }
        if let Some(bytes) = &node.image_data {
            if bytes.len() > MAX_EMBEDDED_IMAGE_BYTES {
                return Err(CnodeError::new(
                    CnodeErrorKind::PackageTooLarge,
                    format!("{path}.image_data"),
                    format!(
                        "Embedded image data is {} bytes, exceeding the {} byte limit",
                        bytes.len(),
                        MAX_EMBEDDED_IMAGE_BYTES
                    ),
                ));
            }
        }
    }

    if group_input_count != 1 {
        return Err(CnodeError::new(
            CnodeErrorKind::InvalidDefinition,
            format!("$.nodes[{index}].internal_graph.nodes"),
            format!("Expected exactly one group_input node, found {group_input_count}"),
        ));
    }
    if group_output_count != 1 {
        return Err(CnodeError::new(
            CnodeErrorKind::InvalidDefinition,
            format!("$.nodes[{index}].internal_graph.nodes"),
            format!("Expected exactly one group_output node, found {group_output_count}"),
        ));
    }

    for (conn_index, conn) in definition.internal_graph.connections.iter().enumerate() {
        if !internal_ids.contains(&conn.from_node) {
            return Err(CnodeError::new(
                CnodeErrorKind::InvalidConnection,
                format!("$.nodes[{index}].internal_graph.connections[{conn_index}].from_node"),
                format!("Unknown from_node '{}'", conn.from_node),
            ));
        }
        if !internal_ids.contains(&conn.to_node) {
            return Err(CnodeError::new(
                CnodeErrorKind::InvalidConnection,
                format!("$.nodes[{index}].internal_graph.connections[{conn_index}].to_node"),
                format!("Unknown to_node '{}'", conn.to_node),
            ));
        }
    }

    validate_ports(
        "explicit_inputs",
        definition.explicit_inputs.as_ref(),
        index,
    )?;
    validate_ports(
        "explicit_outputs",
        definition.explicit_outputs.as_ref(),
        index,
    )?;
    validate_promotions(definition, registry, index)?;

    Ok(())
}

fn validate_ports(
    field: &str,
    ports: Option<&Vec<PortSpec>>,
    index: usize,
) -> Result<(), CnodeError> {
    let Some(ports) = ports else {
        return Ok(());
    };
    let mut names = HashSet::new();
    for (port_index, port) in ports.iter().enumerate() {
        if port.name.trim().is_empty() {
            return Err(CnodeError::new(
                CnodeErrorKind::InvalidDefinition,
                format!("$.nodes[{index}].{field}[{port_index}].name"),
                "Port name cannot be empty",
            ));
        }
        if !names.insert(port.name.clone()) {
            return Err(CnodeError::new(
                CnodeErrorKind::InvalidDefinition,
                format!("$.nodes[{index}].{field}[{port_index}].name"),
                format!("Duplicate port name '{}'", port.name),
            ));
        }
    }
    Ok(())
}

fn validate_promotions(
    definition: &GroupDefinition,
    registry: &NodeRegistry,
    index: usize,
) -> Result<(), CnodeError> {
    let internal_by_id: HashMap<&str, &str> = definition
        .internal_graph
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node.type_id.as_str()))
        .collect();
    let mut group_keys = HashSet::new();
    for (promo_index, promo) in definition.promotions.iter().enumerate() {
        let path = format!("$.nodes[{index}].promotions[{promo_index}]");
        if !group_keys.insert(promo.group_param_key.clone()) {
            return Err(CnodeError::new(
                CnodeErrorKind::InvalidPromotion,
                format!("{path}.group_param_key"),
                format!(
                    "Duplicate promoted parameter key '{}'",
                    promo.group_param_key
                ),
            ));
        }
        let type_id = internal_by_id
            .get(promo.internal_node_id.as_str())
            .ok_or_else(|| {
                CnodeError::new(
                    CnodeErrorKind::InvalidPromotion,
                    format!("{path}.internal_node_id"),
                    format!("Unknown promoted node '{}'", promo.internal_node_id),
                )
            })?;
        let spec = registry.get_spec(type_id).ok_or_else(|| {
            CnodeError::new(
                CnodeErrorKind::UnknownNodeType,
                format!("{path}.internal_node_id"),
                format!("Unknown promoted node type '{type_id}'"),
            )
        })?;
        let param = spec
            .params
            .iter()
            .find(|param| param.key == promo.internal_param_key)
            .ok_or_else(|| {
                CnodeError::new(
                    CnodeErrorKind::InvalidPromotion,
                    format!("{path}.internal_param_key"),
                    format!(
                        "Node type '{}' has no parameter '{}'",
                        type_id, promo.internal_param_key
                    ),
                )
            })?;
        if param.ty != promo.spec.ty {
            return Err(CnodeError::new(
                CnodeErrorKind::InvalidPromotion,
                format!("{path}.spec.ty"),
                format!(
                    "Promoted parameter type mismatch for '{}'",
                    promo.group_param_key
                ),
            ));
        }
    }
    Ok(())
}

fn sort_definitions_by_dependency(
    definitions: &[GroupDefinition],
    existing_groups: &HashMap<String, Arc<GroupDefinition>>,
) -> Result<Vec<GroupDefinition>, CnodeError> {
    let by_id: HashMap<&str, &GroupDefinition> = definitions
        .iter()
        .map(|def| (def.id.as_str(), def))
        .collect();
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    let mut sorted = Vec::new();

    for def in definitions {
        visit_definition(
            def.id.as_str(),
            &by_id,
            existing_groups,
            &mut visiting,
            &mut visited,
            &mut sorted,
        )?;
    }

    Ok(sorted)
}

fn visit_definition(
    id: &str,
    by_id: &HashMap<&str, &GroupDefinition>,
    existing_groups: &HashMap<String, Arc<GroupDefinition>>,
    visiting: &mut HashSet<String>,
    visited: &mut HashSet<String>,
    sorted: &mut Vec<GroupDefinition>,
) -> Result<(), CnodeError> {
    if visited.contains(id) {
        return Ok(());
    }
    if !visiting.insert(id.to_string()) {
        return Err(CnodeError::new(
            CnodeErrorKind::InvalidDefinition,
            "$.nodes",
            format!("Group dependency cycle includes '{id}'"),
        ));
    }

    let def = by_id.get(id).ok_or_else(|| {
        CnodeError::new(
            CnodeErrorKind::InvalidPackage,
            "$.nodes",
            format!("Missing group definition '{id}'"),
        )
    })?;

    for node in &def.internal_graph.nodes {
        if by_id.contains_key(node.type_id.as_str()) {
            visit_definition(
                node.type_id.as_str(),
                by_id,
                existing_groups,
                visiting,
                visited,
                sorted,
            )?;
        } else if node.type_id.starts_with("group::")
            && !existing_groups.contains_key(&node.type_id)
            && node.type_id != "group_input"
            && node.type_id != "group_output"
        {
            return Err(CnodeError::new(
                CnodeErrorKind::UnknownNodeType,
                "$.nodes",
                format!("Unknown group dependency '{}'", node.type_id),
            ));
        }
    }

    visiting.remove(id);
    visited.insert(id.to_string());
    sorted.push((*def).clone());
    Ok(())
}

fn compare_versions(a: &str, b: &str) -> Result<std::cmp::Ordering, CnodeError> {
    let a_parts = parse_version(a)?;
    let b_parts = parse_version(b)?;
    Ok(a_parts.cmp(&b_parts))
}

fn parse_version(value: &str) -> Result<[u64; 3], CnodeError> {
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3 {
        return Err(CnodeError::new(
            CnodeErrorKind::InvalidVersion,
            "$.format_version",
            format!("Invalid semver version '{value}'"),
        ));
    }
    let mut parsed = [0u64; 3];
    for (index, part) in parts.iter().enumerate() {
        parsed[index] = part.parse::<u64>().map_err(|_| {
            CnodeError::new(
                CnodeErrorKind::InvalidVersion,
                "$.format_version",
                format!("Invalid semver version '{value}'"),
            )
        })?;
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cascade_core::group::{
        InternalConnection, InternalNode, Promotion, SerializableInternalGraph,
    };
    use cascade_core::types::{ParamDefault, ParamSpec, UiHint, ValueType};
    use cascade_nodes_std::register_standard_nodes;

    fn registry() -> NodeRegistry {
        let mut registry = NodeRegistry::new();
        register_standard_nodes(&mut registry);
        registry
    }

    fn simple_definition(id: &str) -> GroupDefinition {
        GroupDefinition {
            id: id.to_string(),
            name: "Sample".to_string(),
            category: "Custom".to_string(),
            description: String::new(),
            internal_graph: SerializableInternalGraph {
                nodes: vec![
                    InternalNode {
                        id: "in".to_string(),
                        type_id: "group_input".to_string(),
                        params: HashMap::new(),
                        muted: false,
                        position: (0.0, 0.0),
                        image_data: None,
                        input_defaults: HashMap::new(),
                    },
                    InternalNode {
                        id: "solid".to_string(),
                        type_id: "solid_color".to_string(),
                        params: HashMap::new(),
                        muted: false,
                        position: (100.0, 0.0),
                        image_data: None,
                        input_defaults: HashMap::new(),
                    },
                    InternalNode {
                        id: "out".to_string(),
                        type_id: "group_output".to_string(),
                        params: HashMap::new(),
                        muted: false,
                        position: (200.0, 0.0),
                        image_data: None,
                        input_defaults: HashMap::new(),
                    },
                ],
                connections: vec![InternalConnection {
                    from_node: "solid".to_string(),
                    from_port: "field".to_string(),
                    to_node: "out".to_string(),
                    to_port: "field".to_string(),
                }],
            },
            promotions: vec![],
            is_builtin: false,
            explicit_inputs: Some(vec![]),
            explicit_outputs: Some(vec![PortSpec {
                name: "field".to_string(),
                label: "Field".to_string(),
                ty: ValueType::Field,
                default: None,
                min: None,
                max: None,
                step: None,
                ui_hint: None,
            }]),
        }
    }

    fn package(defs: Vec<GroupDefinition>) -> NodePackage {
        NodePackage {
            format_version: CURRENT_CNODE_FORMAT_VERSION.to_string(),
            package_id: "pkg".to_string(),
            cascade_version: String::new(),
            exported_at: String::new(),
            nodes: defs,
        }
    }

    #[test]
    fn roundtrips_current_cnode_package() {
        let json =
            export_package_json(vec![simple_definition("group::sample")], "test".to_string())
                .unwrap();
        let parsed = parse_package_json(&json).unwrap();
        assert_eq!(parsed.format_version, CURRENT_CNODE_FORMAT_VERSION);
        assert_eq!(parsed.nodes.len(), 1);
    }

    #[test]
    fn rejects_legacy_numeric_version() {
        let err = parse_package_json(r#"{"version":2,"nodes":[]}"#).unwrap_err();
        assert_eq!(err.kind, CnodeErrorKind::InvalidVersion);
    }

    #[test]
    fn rejects_missing_format_version() {
        let err = parse_package_json(r#"{"nodes":[]}"#).unwrap_err();
        assert_eq!(err.kind, CnodeErrorKind::InvalidVersion);
    }

    #[test]
    fn rejects_future_version() {
        let err = parse_package_json(r#"{"format_version":"999.0.0","nodes":[]}"#).unwrap_err();
        assert_eq!(err.kind, CnodeErrorKind::FutureVersion);
    }

    #[test]
    fn rejects_empty_package() {
        let err = prepare_import(package(vec![]), &registry(), &HashMap::new(), || {
            "group::new".to_string()
        })
        .unwrap_err();
        assert_eq!(err.kind, CnodeErrorKind::InvalidPackage);
    }

    #[test]
    fn sorts_dependencies_before_dependents() {
        let mut child = simple_definition("group::child");
        child.name = "Child".to_string();
        let mut parent = simple_definition("group::parent");
        parent.internal_graph.nodes.push(InternalNode {
            id: "child_instance".to_string(),
            type_id: "group::child".to_string(),
            params: HashMap::new(),
            muted: false,
            position: (50.0, 50.0),
            image_data: None,
            input_defaults: HashMap::new(),
        });
        let sorted = sort_definitions_by_dependency(&[parent, child], &HashMap::new()).unwrap();
        assert_eq!(sorted[0].name, "Child");
        assert_eq!(sorted[1].id, "group::parent");
    }

    #[test]
    fn prepares_valid_package_with_remapped_id() {
        let prepared = prepare_import(
            package(vec![simple_definition("group::sample")]),
            &registry(),
            &HashMap::new(),
            || "group::imported_1".to_string(),
        )
        .unwrap();
        assert_eq!(prepared.definitions[0].id, "group::imported_1");
        assert_eq!(prepared.specs[0].id, "group::imported_1");
    }

    #[test]
    fn rejects_duplicate_internal_ids() {
        let mut def = simple_definition("group::sample");
        def.internal_graph.nodes[1].id = "in".to_string();
        let err = prepare_import(package(vec![def]), &registry(), &HashMap::new(), || {
            "group::new".to_string()
        })
        .unwrap_err();
        assert_eq!(err.kind, CnodeErrorKind::InvalidDefinition);
    }

    #[test]
    fn rejects_missing_group_output() {
        let mut def = simple_definition("group::sample");
        def.internal_graph
            .nodes
            .retain(|node| node.type_id != "group_output");
        let err = prepare_import(package(vec![def]), &registry(), &HashMap::new(), || {
            "group::new".to_string()
        })
        .unwrap_err();
        assert_eq!(err.kind, CnodeErrorKind::InvalidDefinition);
    }

    #[test]
    fn rejects_bad_connection_endpoint() {
        let mut def = simple_definition("group::sample");
        def.internal_graph.connections[0].from_node = "missing".to_string();
        let err = prepare_import(package(vec![def]), &registry(), &HashMap::new(), || {
            "group::new".to_string()
        })
        .unwrap_err();
        assert_eq!(err.kind, CnodeErrorKind::InvalidConnection);
    }

    #[test]
    fn rejects_unknown_node_type() {
        let mut def = simple_definition("group::sample");
        def.internal_graph.nodes[1].type_id = "unknown_node".to_string();
        let err = prepare_import(package(vec![def]), &registry(), &HashMap::new(), || {
            "group::new".to_string()
        })
        .unwrap_err();
        assert_eq!(err.kind, CnodeErrorKind::UnknownNodeType);
    }

    #[test]
    fn rejects_oversized_embedded_image_data() {
        let mut def = simple_definition("group::sample");
        def.internal_graph.nodes[1].image_data = Some(vec![0; MAX_EMBEDDED_IMAGE_BYTES + 1]);
        let err = prepare_import(package(vec![def]), &registry(), &HashMap::new(), || {
            "group::new".to_string()
        })
        .unwrap_err();
        assert_eq!(err.kind, CnodeErrorKind::PackageTooLarge);
    }

    #[test]
    fn rejects_invalid_promotion() {
        let mut def = simple_definition("group::sample");
        def.promotions.push(Promotion {
            group_param_key: "missing".to_string(),
            internal_node_id: "solid".to_string(),
            internal_param_key: "missing".to_string(),
            spec: ParamSpec {
                key: "missing".to_string(),
                label: "Missing".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(0.0),
                min: None,
                max: None,
                step: None,
                ui_hint: UiHint::Slider,
                promotable: true,
            },
        });
        let err = prepare_import(package(vec![def]), &registry(), &HashMap::new(), || {
            "group::new".to_string()
        })
        .unwrap_err();
        assert_eq!(err.kind, CnodeErrorKind::InvalidPromotion);
    }

    #[test]
    fn migrates_embedded_group_connections() {
        let json = r#"{
          "format_version":"1.0.0",
          "nodes":[{
            "id":"group::sample",
            "name":"Sample",
            "category":"Custom",
            "description":"",
            "internal_graph":{
              "nodes":[
                {"id":"viewer","type_id":"viewer","params":{}},
                {"id":"out","type_id":"group_output","params":{}},
                {"id":"in","type_id":"group_input","params":{}}
              ],
              "connections":[{"from_node":"in","from_port":"image","to_node":"viewer","to_port":"image"}]
            },
            "promotions":[],
            "is_builtin":false
          }]
        }"#;
        let parsed = parse_package_json(json).unwrap();
        assert_eq!(
            parsed.nodes[0].internal_graph.connections[0].to_port,
            "value"
        );
    }
}
