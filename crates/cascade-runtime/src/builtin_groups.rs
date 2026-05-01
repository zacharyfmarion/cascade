use cascade_core::group::{
    GroupDefinition, InternalConnection, InternalNode, Promotion, SerializableInternalGraph,
};
use cascade_core::types::*;
use std::collections::HashMap;

use crate::Engine;

/// Color Range: generates a binary mask from an image based on hue, saturation, and value ranges.
///
/// Internal graph:
///   gi (group_input) → sep (separate_hsva)
///   sep.hue → gt_low (math: Greater Than) & lt_high (math: Less Than)
///   gt_low × lt_high → mul_hue (math: Multiply)
///   sep.saturation → gt_sat (math: Greater Than)
///   sep.value → gt_val (math: Greater Than)
///   mul_hue × gt_sat → mul_sat (math: Multiply)
///   mul_sat × gt_val → mul_final (math: Multiply)
///   mul_final → go (group_output)
///
/// Promoted params: hue_min (0.25), hue_max (0.45), sat_min (0.1), val_min (0.1)
pub fn color_range_group() -> GroupDefinition {
    let nodes = vec![
        InternalNode {
            id: "gi".to_string(),
            type_id: "group_input".to_string(),
            params: HashMap::new(),
            muted: false,
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        InternalNode {
            id: "sep".to_string(),
            type_id: "separate_hsva".to_string(),
            params: HashMap::new(),
            muted: false,
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        // Greater Than: hue > hue_min
        InternalNode {
            id: "gt_low".to_string(),
            type_id: "image_math".to_string(),
            params: HashMap::from([
                ("operation".to_string(), ParamValue::Int(8)), // Greater Than
                ("value".to_string(), ParamValue::Float(0.25)),
                ("clamp_result".to_string(), ParamValue::Bool(false)),
            ]),
            muted: false,
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        // Less Than: hue < hue_max
        InternalNode {
            id: "lt_high".to_string(),
            type_id: "image_math".to_string(),
            params: HashMap::from([
                ("operation".to_string(), ParamValue::Int(9)), // Less Than
                ("value".to_string(), ParamValue::Float(0.45)),
                ("clamp_result".to_string(), ParamValue::Bool(false)),
            ]),
            muted: false,
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        // Multiply: gt_low * lt_high → hue mask
        InternalNode {
            id: "mul_hue".to_string(),
            type_id: "image_math".to_string(),
            params: HashMap::from([
                ("operation".to_string(), ParamValue::Int(2)), // Multiply
                ("value".to_string(), ParamValue::Float(1.0)),
                ("clamp_result".to_string(), ParamValue::Bool(false)),
            ]),
            muted: false,
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        // Greater Than: saturation > sat_min
        InternalNode {
            id: "gt_sat".to_string(),
            type_id: "image_math".to_string(),
            params: HashMap::from([
                ("operation".to_string(), ParamValue::Int(8)), // Greater Than
                ("value".to_string(), ParamValue::Float(0.1)),
                ("clamp_result".to_string(), ParamValue::Bool(false)),
            ]),
            muted: false,
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        // Greater Than: value > val_min
        InternalNode {
            id: "gt_val".to_string(),
            type_id: "image_math".to_string(),
            params: HashMap::from([
                ("operation".to_string(), ParamValue::Int(8)), // Greater Than
                ("value".to_string(), ParamValue::Float(0.1)),
                ("clamp_result".to_string(), ParamValue::Bool(false)),
            ]),
            muted: false,
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        // Multiply: mul_hue * gt_sat → hue+sat mask
        InternalNode {
            id: "mul_sat".to_string(),
            type_id: "image_math".to_string(),
            params: HashMap::from([
                ("operation".to_string(), ParamValue::Int(2)), // Multiply
                ("value".to_string(), ParamValue::Float(1.0)),
                ("clamp_result".to_string(), ParamValue::Bool(false)),
            ]),
            muted: false,
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        // Multiply: mul_sat * gt_val → final mask
        InternalNode {
            id: "mul_final".to_string(),
            type_id: "image_math".to_string(),
            params: HashMap::from([
                ("operation".to_string(), ParamValue::Int(2)), // Multiply
                ("value".to_string(), ParamValue::Float(1.0)),
                ("clamp_result".to_string(), ParamValue::Bool(false)),
            ]),
            muted: false,
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        InternalNode {
            id: "go".to_string(),
            type_id: "group_output".to_string(),
            params: HashMap::new(),
            muted: false,
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
    ];

    let connections = vec![
        // gi.image → sep.image
        InternalConnection {
            from_node: "gi".to_string(),
            from_port: "image".to_string(),
            to_node: "sep".to_string(),
            to_port: "image".to_string(),
        },
        // sep.hue → gt_low.a
        InternalConnection {
            from_node: "sep".to_string(),
            from_port: "hue".to_string(),
            to_node: "gt_low".to_string(),
            to_port: "a".to_string(),
        },
        // sep.hue → lt_high.a
        InternalConnection {
            from_node: "sep".to_string(),
            from_port: "hue".to_string(),
            to_node: "lt_high".to_string(),
            to_port: "a".to_string(),
        },
        // gt_low.image → mul_hue.a
        InternalConnection {
            from_node: "gt_low".to_string(),
            from_port: "image".to_string(),
            to_node: "mul_hue".to_string(),
            to_port: "a".to_string(),
        },
        // lt_high.image → mul_hue.b
        InternalConnection {
            from_node: "lt_high".to_string(),
            from_port: "image".to_string(),
            to_node: "mul_hue".to_string(),
            to_port: "b".to_string(),
        },
        // sep.saturation → gt_sat.a
        InternalConnection {
            from_node: "sep".to_string(),
            from_port: "saturation".to_string(),
            to_node: "gt_sat".to_string(),
            to_port: "a".to_string(),
        },
        // sep.value → gt_val.a
        InternalConnection {
            from_node: "sep".to_string(),
            from_port: "value".to_string(),
            to_node: "gt_val".to_string(),
            to_port: "a".to_string(),
        },
        // mul_hue.image → mul_sat.a
        InternalConnection {
            from_node: "mul_hue".to_string(),
            from_port: "image".to_string(),
            to_node: "mul_sat".to_string(),
            to_port: "a".to_string(),
        },
        // gt_sat.image → mul_sat.b
        InternalConnection {
            from_node: "gt_sat".to_string(),
            from_port: "image".to_string(),
            to_node: "mul_sat".to_string(),
            to_port: "b".to_string(),
        },
        // mul_sat.image → mul_final.a
        InternalConnection {
            from_node: "mul_sat".to_string(),
            from_port: "image".to_string(),
            to_node: "mul_final".to_string(),
            to_port: "a".to_string(),
        },
        // gt_val.image → mul_final.b
        InternalConnection {
            from_node: "gt_val".to_string(),
            from_port: "image".to_string(),
            to_node: "mul_final".to_string(),
            to_port: "b".to_string(),
        },
        // mul_final.image → go.mask
        InternalConnection {
            from_node: "mul_final".to_string(),
            from_port: "image".to_string(),
            to_node: "go".to_string(),
            to_port: "mask".to_string(),
        },
    ];

    let promotions = vec![
        Promotion {
            group_param_key: "hue_min".to_string(),
            internal_node_id: "gt_low".to_string(),
            internal_param_key: "value".to_string(),
            spec: ParamSpec {
                key: "hue_min".to_string(),
                label: "Hue Min".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(0.25),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
                promotable: true,
            },
        },
        Promotion {
            group_param_key: "hue_max".to_string(),
            internal_node_id: "lt_high".to_string(),
            internal_param_key: "value".to_string(),
            spec: ParamSpec {
                key: "hue_max".to_string(),
                label: "Hue Max".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(0.45),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
                promotable: true,
            },
        },
        Promotion {
            group_param_key: "sat_min".to_string(),
            internal_node_id: "gt_sat".to_string(),
            internal_param_key: "value".to_string(),
            spec: ParamSpec {
                key: "sat_min".to_string(),
                label: "Saturation Min".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(0.1),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
                promotable: true,
            },
        },
        Promotion {
            group_param_key: "val_min".to_string(),
            internal_node_id: "gt_val".to_string(),
            internal_param_key: "value".to_string(),
            spec: ParamSpec {
                key: "val_min".to_string(),
                label: "Value Min".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(0.1),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
                promotable: true,
            },
        },
    ];

    GroupDefinition {
        id: "group::color_range".to_string(),
        name: "Color Range".to_string(),
        category: "Matte".to_string(),
        description: "Generate a mask from hue, saturation, and value ranges".to_string(),
        internal_graph: SerializableInternalGraph { nodes, connections },
        promotions,
        is_builtin: true,
        explicit_inputs: None,
        explicit_outputs: None,
    }
}

pub fn photo_adjust_group() -> GroupDefinition {
    fn slider_input(
        name: &str,
        label: &str,
        default: f64,
        min: f64,
        max: f64,
        step: f64,
    ) -> PortSpec {
        PortSpec {
            name: name.to_string(),
            label: label.to_string(),
            ty: ValueType::Float,
            default: Some(ParamDefault::Float(default)),
            min: Some(min),
            max: Some(max),
            step: Some(step),
            ui_hint: Some(UiHint::Slider),
        }
    }

    let nodes = vec![
        InternalNode {
            id: "gi".to_string(),
            type_id: "group_input".to_string(),
            params: HashMap::new(),
            muted: false,
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        InternalNode {
            id: "white_balance".to_string(),
            type_id: "gpu_kernel::white_balance".to_string(),
            params: HashMap::from([
                ("temperature".to_string(), ParamValue::Float(0.0)),
                ("tint".to_string(), ParamValue::Float(0.0)),
            ]),
            muted: false,
            position: (200.0, -120.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        InternalNode {
            id: "exposure".to_string(),
            type_id: "gpu_kernel::exposure".to_string(),
            params: HashMap::from([("exposure".to_string(), ParamValue::Float(0.0))]),
            muted: false,
            position: (420.0, -120.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        InternalNode {
            id: "contrast".to_string(),
            type_id: "gpu_kernel::contrast".to_string(),
            params: HashMap::from([("contrast".to_string(), ParamValue::Float(0.0))]),
            muted: false,
            position: (640.0, -120.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        InternalNode {
            id: "shadows".to_string(),
            type_id: "gpu_kernel::luma_adjust".to_string(),
            params: HashMap::from([
                ("mode".to_string(), ParamValue::Int(0)),
                ("amount".to_string(), ParamValue::Float(0.0)),
            ]),
            muted: false,
            position: (860.0, -120.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        InternalNode {
            id: "highlights".to_string(),
            type_id: "gpu_kernel::luma_adjust".to_string(),
            params: HashMap::from([
                ("mode".to_string(), ParamValue::Int(1)),
                ("amount".to_string(), ParamValue::Float(0.0)),
            ]),
            muted: false,
            position: (1080.0, -120.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        InternalNode {
            id: "blacks".to_string(),
            type_id: "gpu_kernel::luma_adjust".to_string(),
            params: HashMap::from([
                ("mode".to_string(), ParamValue::Int(2)),
                ("amount".to_string(), ParamValue::Float(0.0)),
            ]),
            muted: false,
            position: (1300.0, -120.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        InternalNode {
            id: "whites".to_string(),
            type_id: "gpu_kernel::luma_adjust".to_string(),
            params: HashMap::from([
                ("mode".to_string(), ParamValue::Int(3)),
                ("amount".to_string(), ParamValue::Float(0.0)),
            ]),
            muted: false,
            position: (1520.0, -120.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        InternalNode {
            id: "go".to_string(),
            type_id: "group_output".to_string(),
            params: HashMap::new(),
            muted: false,
            position: (1740.0, -80.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
    ];

    let connections = vec![
        InternalConnection {
            from_node: "gi".to_string(),
            from_port: "image".to_string(),
            to_node: "white_balance".to_string(),
            to_port: "image".to_string(),
        },
        InternalConnection {
            from_node: "white_balance".to_string(),
            from_port: "image".to_string(),
            to_node: "exposure".to_string(),
            to_port: "image".to_string(),
        },
        InternalConnection {
            from_node: "exposure".to_string(),
            from_port: "image".to_string(),
            to_node: "contrast".to_string(),
            to_port: "image".to_string(),
        },
        InternalConnection {
            from_node: "contrast".to_string(),
            from_port: "image".to_string(),
            to_node: "shadows".to_string(),
            to_port: "image".to_string(),
        },
        InternalConnection {
            from_node: "shadows".to_string(),
            from_port: "image".to_string(),
            to_node: "highlights".to_string(),
            to_port: "image".to_string(),
        },
        InternalConnection {
            from_node: "highlights".to_string(),
            from_port: "image".to_string(),
            to_node: "blacks".to_string(),
            to_port: "image".to_string(),
        },
        InternalConnection {
            from_node: "blacks".to_string(),
            from_port: "image".to_string(),
            to_node: "whites".to_string(),
            to_port: "image".to_string(),
        },
        InternalConnection {
            from_node: "whites".to_string(),
            from_port: "image".to_string(),
            to_node: "go".to_string(),
            to_port: "image".to_string(),
        },
    ];
    let adjustment_nodes = [
        "white_balance",
        "exposure",
        "contrast",
        "shadows",
        "highlights",
        "blacks",
        "whites",
    ];
    let mask_connections = adjustment_nodes.iter().map(|node| InternalConnection {
        from_node: "gi".to_string(),
        from_port: "mask".to_string(),
        to_node: (*node).to_string(),
        to_port: "mask".to_string(),
    });
    let control_connections = [
        ("temperature", "white_balance", "temperature"),
        ("tint", "white_balance", "tint"),
        ("exposure", "exposure", "exposure"),
        ("contrast", "contrast", "contrast"),
        ("shadows", "shadows", "amount"),
        ("highlights", "highlights", "amount"),
        ("blacks", "blacks", "amount"),
        ("whites", "whites", "amount"),
    ]
    .into_iter()
    .map(|(from_port, to_node, to_port)| InternalConnection {
        from_node: "gi".to_string(),
        from_port: from_port.to_string(),
        to_node: to_node.to_string(),
        to_port: to_port.to_string(),
    });
    let connections = connections
        .into_iter()
        .chain(mask_connections)
        .chain(control_connections)
        .collect();

    GroupDefinition {
        id: "group::photo_adjust".to_string(),
        name: "Photo Adjust".to_string(),
        category: "Color".to_string(),
        description: "Basic photographic exposure, color, and tone adjustments".to_string(),
        internal_graph: SerializableInternalGraph { nodes, connections },
        promotions: Vec::new(),
        is_builtin: true,
        explicit_inputs: Some(vec![
            PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..PortSpec::default()
            },
            PortSpec {
                name: "mask".to_string(),
                label: "Mask".to_string(),
                ty: ValueType::Mask,
                ..PortSpec::default()
            },
            slider_input("temperature", "Temperature", 0.0, -100.0, 100.0, 1.0),
            slider_input("tint", "Tint", 0.0, -100.0, 100.0, 1.0),
            slider_input("exposure", "Exposure", 0.0, -5.0, 5.0, 0.01),
            slider_input("contrast", "Contrast", 0.0, -100.0, 100.0, 1.0),
            slider_input("shadows", "Shadows", 0.0, -100.0, 100.0, 1.0),
            slider_input("highlights", "Highlights", 0.0, -100.0, 100.0, 1.0),
            slider_input("blacks", "Blacks", 0.0, -100.0, 100.0, 1.0),
            slider_input("whites", "Whites", 0.0, -100.0, 100.0, 1.0),
        ]),
        explicit_outputs: Some(vec![PortSpec {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: ValueType::Image,
            ..PortSpec::default()
        }]),
    }
}

pub fn register_builtin_groups(engine: &mut Engine) {
    if let Err(err) = engine.register_group(color_range_group()) {
        eprintln!("[cascade-runtime] Failed to register Color Range group: {err}");
    }
    if engine.gpu_context().is_some() {
        if let Err(err) = engine.register_group(photo_adjust_group()) {
            eprintln!("[cascade-runtime] Failed to register Photo Adjust group: {err}");
        }
    }
}
