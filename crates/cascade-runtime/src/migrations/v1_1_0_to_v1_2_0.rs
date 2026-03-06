use serde_json::{Map, Number, Value};
use std::collections::HashMap;

use super::MigrationError;

pub fn migrate(doc: &mut Value) -> Result<(), MigrationError> {
    let graph = doc
        .get_mut("graph")
        .ok_or_else(|| MigrationError::InvalidStructure("Missing graph object".to_string()))?;

    migrate_graph(graph)?;
    migrate_group_definitions(doc)?;

    Ok(())
}

fn migrate_graph(graph: &mut Value) -> Result<(), MigrationError> {
    let nodes = graph
        .get_mut("nodes")
        .ok_or_else(|| MigrationError::InvalidStructure("Missing graph.nodes".to_string()))?;
    let node_types = remap_nodes(nodes)?;

    let connections = graph
        .get_mut("connections")
        .and_then(|c| c.as_array_mut())
        .ok_or_else(|| {
            MigrationError::InvalidStructure("Missing or invalid graph.connections".to_string())
        })?;
    migrate_connections(connections, &node_types);

    Ok(())
}

fn migrate_group_definitions(doc: &mut Value) -> Result<(), MigrationError> {
    let group_defs = doc
        .get_mut("graph")
        .and_then(|g| g.get_mut("group_definitions"))
        .and_then(|gd| gd.as_array_mut());

    if let Some(group_defs) = group_defs {
        for group_def in group_defs.iter_mut() {
            if let Some(internal_graph) = group_def.get_mut("internal_graph") {
                migrate_internal_graph(internal_graph)?;
            }
        }
    }

    Ok(())
}

fn migrate_internal_graph(internal_graph: &mut Value) -> Result<(), MigrationError> {
    let Some(nodes) = internal_graph.get_mut("nodes") else {
        return Ok(());
    };
    let node_types = remap_nodes(nodes)?;

    if let Some(connections) = internal_graph
        .get_mut("connections")
        .and_then(|c| c.as_array_mut())
    {
        migrate_connections(connections, &node_types);
    }

    Ok(())
}

fn remap_nodes(nodes: &mut Value) -> Result<HashMap<String, String>, MigrationError> {
    let mut node_types = HashMap::new();

    match nodes {
        Value::Array(nodes) => {
            for node in nodes.iter_mut() {
                let node_id = node
                    .get("id")
                    .and_then(|id| id.as_str())
                    .map(|s| s.to_string());
                let (type_id, was_remapped) = migrate_node_type(node);
                if let Some(type_id) = type_id {
                    if was_remapped {
                        migrate_node_params(node, &type_id);
                    }
                    if let Some(node_id) = node_id {
                        node_types.insert(node_id, type_id);
                    }
                }
            }
        }
        Value::Object(map) => {
            for (node_id, node) in map.iter_mut() {
                let (type_id, was_remapped) = migrate_node_type(node);
                if let Some(type_id) = type_id {
                    if was_remapped {
                        migrate_node_params(node, &type_id);
                    }
                    node_types.insert(node_id.to_string(), type_id);
                }
            }
        }
        _ => {
            return Err(MigrationError::InvalidStructure(
                "graph.nodes must be an array or object".to_string(),
            ))
        }
    }

    Ok(node_types)
}

fn migrate_node_type(node: &mut Value) -> (Option<String>, bool) {
    let Some(type_id) = node.get("type_id").and_then(|t| t.as_str()) else {
        return (None, false);
    };

    if type_id == "gpu_kernel::resize" {
        if let Some(type_obj) = node.get_mut("type_id") {
            *type_obj = Value::String("resize".to_string());
        }
        return (Some("resize".to_string()), false);
    }

    if let Some(mapped) = map_cpu_to_gpu(type_id) {
        if let Some(type_obj) = node.get_mut("type_id") {
            *type_obj = Value::String(mapped.to_string());
        }
        return (Some(mapped.to_string()), true);
    }

    (Some(type_id.to_string()), false)
}

fn migrate_node_params(node: &mut Value, type_id: &str) {
    let Some(params) = node.get_mut("params").and_then(|p| p.as_object_mut()) else {
        return;
    };

    match type_id {
        "gpu_kernel::hue_saturation" => {
            rename_param(params, "value", "lightness");
            if let Some(hue_value) = params.get_mut("hue") {
                if let Some(hue) = hue_value.as_f64() {
                    if let Some(new_hue) = Number::from_f64(hue / 180.0) {
                        *hue_value = Value::Number(new_hue);
                    }
                }
            }
        }
        "gpu_kernel::map_range" => {
            if let Some(clamp_value) = params.remove("clamp") {
                let new_value = match clamp_value {
                    Value::Bool(value) => Value::Number(Number::from(if value { 1 } else { 0 })),
                    other => other,
                };
                params.insert("do_clamp".to_string(), new_value);
            }
        }
        "gpu_kernel::vignette" => {
            rename_param(params, "amount", "intensity");
            rename_param(params, "size", "radius");
        }
        "gpu_kernel::despill" => {
            rename_param(params, "strength", "amount");
            params.remove("key_color");
        }
        "gpu_kernel::merge" => {
            params.remove("bbox");
        }
        _ => {}
    }
}

fn migrate_connections(connections: &mut [Value], node_types: &HashMap<String, String>) {
    for conn in connections.iter_mut() {
        if let (Some(from_node), Some(from_port)) = (
            conn.get("from_node").and_then(|n| n.as_str()),
            conn.get("from_port").and_then(|p| p.as_str()),
        ) {
            if from_port == "output" {
                if let Some(node_type) = node_types.get(from_node) {
                    if node_type.starts_with("gpu_kernel::") {
                        if let Some(port_obj) = conn.get_mut("from_port") {
                            *port_obj = Value::String("image".to_string());
                        }
                    }
                }
            }
        }

        if let Some(from_node) = conn.get("from_node").and_then(|n| n.as_str()) {
            if let Some(node_type) = node_types.get(from_node) {
                remap_connection_port(conn, "from_port", node_type);
            }
        }

        if let Some(to_node) = conn.get("to_node").and_then(|n| n.as_str()) {
            if let Some(node_type) = node_types.get(to_node) {
                remap_connection_port(conn, "to_port", node_type);
            }
        }
    }
}

fn remap_connection_port(conn: &mut Value, port_key: &str, node_type: &str) {
    let Some(port) = conn.get(port_key).and_then(|p| p.as_str()) else {
        return;
    };

    let new_port = match (node_type, port) {
        ("gpu_kernel::blend", "blend_input") => Some("blend_image"),
        ("gpu_kernel::set_alpha", "alpha") => Some("alpha_source"),
        ("gpu_kernel::difference_matte", "plate") => Some("clean_plate"),
        _ => None,
    };

    if let Some(new_port) = new_port {
        if let Some(port_obj) = conn.get_mut(port_key) {
            *port_obj = Value::String(new_port.to_string());
        }
    }
}

fn rename_param(params: &mut Map<String, Value>, from: &str, to: &str) {
    if let Some(value) = params.remove(from) {
        params.insert(to.to_string(), value);
    }
}

fn map_cpu_to_gpu(type_id: &str) -> Option<&'static str> {
    match type_id {
        "invert" => Some("gpu_kernel::invert"),
        "brightness_contrast" => Some("gpu_kernel::brightness_contrast"),
        "hue_saturation" => Some("gpu_kernel::hue_saturation"),
        "gamma" => Some("gpu_kernel::gamma"),
        "threshold" => Some("gpu_kernel::threshold"),
        "posterize" => Some("gpu_kernel::posterize"),
        "white_balance" => Some("gpu_kernel::white_balance"),
        "clamp" => Some("gpu_kernel::clamp"),
        "levels" => Some("gpu_kernel::levels"),
        "color_balance" => Some("gpu_kernel::color_balance"),
        "vibrance" => Some("gpu_kernel::vibrance"),
        "grade" => Some("gpu_kernel::grade"),
        "gradient_map" => Some("gpu_kernel::gradient_map"),
        "tone_map" => Some("gpu_kernel::tone_map"),
        // color_ramp stays as CPU node (not migrated to GPU)
        // gpu_kernel::color_ramp was briefly shipped but renamed to two_color_map
        "gpu_kernel::color_ramp" => Some("gpu_kernel::two_color_map"),
        "premultiply" => Some("gpu_kernel::premultiply"),
        "unpremultiply" => Some("gpu_kernel::unpremultiply"),
        "set_alpha" => Some("gpu_kernel::set_alpha"),
        "extract_channel" => Some("gpu_kernel::extract_channel"),
        "copy_channels" => Some("gpu_kernel::copy_channels"),
        "despill" => Some("gpu_kernel::despill"),
        "luminance_key" => Some("gpu_kernel::luminance_key"),
        "difference_matte" => Some("gpu_kernel::difference_matte"),
        "blend" => Some("gpu_kernel::blend"),
        "alpha_over" => Some("gpu_kernel::alpha_over"),
        "merge" => Some("gpu_kernel::merge"),
        "keymix" => Some("gpu_kernel::key_mix"),
        "channel_shuffle" => Some("gpu_kernel::channel_shuffle"),
        "image_math" => Some("gpu_kernel::image_math"),
        "map_range" => Some("gpu_kernel::map_range"),
        "edge_detect" => Some("gpu_kernel::edge_detect"),
        "vignette" => Some("gpu_kernel::vignette"),
        "lens_distortion" => Some("gpu_kernel::lens_distortion"),
        "rotate" => Some("gpu_kernel::rotate"),
        "transform_2d" => Some("gpu_kernel::transform_2d"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_node_type_id_remap() {
        let mut doc = json!({
            "cascade": {"format_version": "1.1.0"},
            "graph": {
                "nodes": {
                    "node-1": {"type_id": "invert", "params": {}}
                },
                "connections": [],
                "group_definitions": []
            }
        });

        migrate(&mut doc).unwrap();

        assert_eq!(
            doc["graph"]["nodes"]["node-1"]["type_id"].as_str().unwrap(),
            "gpu_kernel::invert"
        );
    }

    #[test]
    fn test_hue_saturation_param_migration() {
        let mut doc = json!({
            "cascade": {"format_version": "1.1.0"},
            "graph": {
                "nodes": {
                    "node-1": {
                        "type_id": "hue_saturation",
                        "params": {"value": 0.25, "hue": 90.0}
                    }
                },
                "connections": [],
                "group_definitions": []
            }
        });

        migrate(&mut doc).unwrap();

        let params = &doc["graph"]["nodes"]["node-1"]["params"];
        assert!(params.get("value").is_none());
        assert_eq!(params["lightness"].as_f64().unwrap(), 0.25);
        let hue = params["hue"].as_f64().unwrap();
        assert!((hue - 0.5).abs() < 1e-6);
    }

    #[test]
    fn test_output_port_remap() {
        let mut doc = json!({
            "cascade": {"format_version": "1.1.0"},
            "graph": {
                "nodes": {
                    "node-1": {"type_id": "gpu_kernel::invert", "params": {}}
                },
                "connections": [
                    {"from_node": "node-1", "from_port": "output", "to_node": "node-2", "to_port": "image"}
                ],
                "group_definitions": []
            }
        });

        migrate(&mut doc).unwrap();

        assert_eq!(
            doc["graph"]["connections"][0]["from_port"]
                .as_str()
                .unwrap(),
            "image"
        );
    }

    #[test]
    fn test_keymix_remap() {
        let mut doc = json!({
            "cascade": {"format_version": "1.1.0"},
            "graph": {
                "nodes": {
                    "node-1": {"type_id": "keymix", "params": {}}
                },
                "connections": [],
                "group_definitions": []
            }
        });

        migrate(&mut doc).unwrap();

        assert_eq!(
            doc["graph"]["nodes"]["node-1"]["type_id"].as_str().unwrap(),
            "gpu_kernel::key_mix"
        );
    }

    #[test]
    fn test_idempotent() {
        let mut doc = json!({
            "cascade": {"format_version": "1.1.0"},
            "graph": {
                "nodes": {
                    "node-1": {"type_id": "gpu_kernel::invert", "params": {}}
                },
                "connections": [
                    {"from_node": "node-1", "from_port": "image", "to_node": "node-2", "to_port": "image"}
                ],
                "group_definitions": []
            }
        });

        migrate(&mut doc).unwrap();
        let once = doc.clone();
        migrate(&mut doc).unwrap();

        assert_eq!(doc, once);
    }
}
