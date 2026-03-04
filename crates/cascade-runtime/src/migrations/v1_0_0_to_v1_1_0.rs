use serde_json::Value;
use std::collections::HashSet;

use super::MigrationError;

/// Migrate from v1.0.0 to v1.1.0: Rename Viewer node input port from "image" to "value"
pub fn migrate(doc: &mut Value) -> Result<(), MigrationError> {
    // Extract all viewer node IDs from the graph
    let viewer_ids = extract_viewer_ids(doc)?;

    // Migrate top-level connections
    migrate_connections(doc, "/graph/connections", &viewer_ids)?;

    // Migrate group definition connections
    migrate_group_definition_connections(doc, &viewer_ids)?;

    Ok(())
}

/// Extract all viewer node IDs from the document
fn extract_viewer_ids(doc: &Value) -> Result<HashSet<String>, MigrationError> {
    let nodes = doc
        .get("graph")
        .and_then(|g| g.get("nodes"))
        .and_then(|n| n.as_array())
        .ok_or_else(|| {
            MigrationError::InvalidStructure("Missing or invalid graph.nodes array".to_string())
        })?;

    let mut viewer_ids = HashSet::new();

    for node in nodes {
        if let (Some(id), Some(type_id)) = (
            node.get("id").and_then(|id| id.as_str()),
            node.get("type_id").and_then(|t| t.as_str()),
        ) {
            if type_id == "viewer" {
                viewer_ids.insert(id.to_string());
            }
        }
    }

    Ok(viewer_ids)
}

/// Migrate connections at a specific JSON path
fn migrate_connections(
    doc: &mut Value,
    path: &str,
    viewer_ids: &HashSet<String>,
) -> Result<(), MigrationError> {
    let connections = doc
        .pointer_mut(path)
        .and_then(|c| c.as_array_mut())
        .ok_or_else(|| {
            MigrationError::InvalidStructure(format!(
                "Missing or invalid connections array at {path}"
            ))
        })?;

    for conn in connections.iter_mut() {
        if let (Some(to_node), Some(to_port)) = (
            conn.get("to_node").and_then(|n| n.as_str()),
            conn.get("to_port").and_then(|p| p.as_str()),
        ) {
            if viewer_ids.contains(to_node) && to_port == "image" {
                if let Some(port_obj) = conn.get_mut("to_port") {
                    *port_obj = Value::String("value".to_string());
                }
            }
        }
    }

    Ok(())
}

/// Migrate connections in all group definitions
fn migrate_group_definition_connections(
    doc: &mut Value,
    _viewer_ids: &HashSet<String>,
) -> Result<(), MigrationError> {
    let group_defs = doc
        .get_mut("graph")
        .and_then(|g| g.get_mut("group_definitions"))
        .and_then(|gd| gd.as_array_mut());

    if let Some(group_defs) = group_defs {
        for group_def in group_defs.iter_mut() {
            // Extract viewer IDs from internal graph
            let internal_viewer_ids = if let Some(internal_graph) = group_def.get("internal_graph")
            {
                extract_viewer_ids_from_internal_graph(internal_graph)?
            } else {
                HashSet::new()
            };

            // Migrate internal connections
            if let Some(internal_graph) = group_def.get_mut("internal_graph") {
                if let Some(connections) = internal_graph
                    .get_mut("connections")
                    .and_then(|c| c.as_array_mut())
                {
                    for conn in connections.iter_mut() {
                        if let (Some(to_node), Some(to_port)) = (
                            conn.get("to_node").and_then(|n| n.as_str()),
                            conn.get("to_port").and_then(|p| p.as_str()),
                        ) {
                            if internal_viewer_ids.contains(to_node) && to_port == "image" {
                                if let Some(port_obj) = conn.get_mut("to_port") {
                                    *port_obj = Value::String("value".to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

/// Extract viewer node IDs from an internal graph (within a group definition)
fn extract_viewer_ids_from_internal_graph(
    internal_graph: &Value,
) -> Result<HashSet<String>, MigrationError> {
    let default_vec = vec![];
    let nodes = internal_graph
        .get("nodes")
        .and_then(|n| n.as_array())
        .unwrap_or(&default_vec);

    let mut viewer_ids = HashSet::new();

    for node in nodes {
        if let (Some(id), Some(type_id)) = (
            node.get("id").and_then(|id| id.as_str()),
            node.get("type_id").and_then(|t| t.as_str()),
        ) {
            if type_id == "viewer" {
                viewer_ids.insert(id.to_string());
            }
        }
    }

    Ok(viewer_ids)
}
