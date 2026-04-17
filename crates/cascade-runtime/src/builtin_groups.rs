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
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        InternalNode {
            id: "sep".to_string(),
            type_id: "separate_hsva".to_string(),
            params: HashMap::new(),
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
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        InternalNode {
            id: "go".to_string(),
            type_id: "group_output".to_string(),
            params: HashMap::new(),
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

pub fn pixelate_group() -> GroupDefinition {
    let nodes = vec![
        InternalNode {
            id: "gi".to_string(),
            type_id: "group_input".to_string(),
            params: HashMap::new(),
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        InternalNode {
            id: "kernel".to_string(),
            type_id: "gpu_kernel::pixelate".to_string(),
            params: HashMap::from([
                ("pixel_size".to_string(), ParamValue::Int(4)),
                ("algorithm".to_string(), ParamValue::Int(0)),
                ("matrix_size".to_string(), ParamValue::Int(8)),
                ("dither_amount".to_string(), ParamValue::Float(1.0)),
            ]),
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
        InternalNode {
            id: "go".to_string(),
            type_id: "group_output".to_string(),
            params: HashMap::new(),
            position: (0.0, 0.0),
            image_data: None,
            input_defaults: HashMap::new(),
        },
    ];

    let connections = vec![
        InternalConnection {
            from_node: "gi".to_string(),
            from_port: "image".to_string(),
            to_node: "kernel".to_string(),
            to_port: "image".to_string(),
        },
        InternalConnection {
            from_node: "gi".to_string(),
            from_port: "palette".to_string(),
            to_node: "kernel".to_string(),
            to_port: "palette".to_string(),
        },
        InternalConnection {
            from_node: "kernel".to_string(),
            from_port: "image".to_string(),
            to_node: "go".to_string(),
            to_port: "image".to_string(),
        },
    ];

    let promotions = vec![
        Promotion {
            group_param_key: "pixel_size".to_string(),
            internal_node_id: "kernel".to_string(),
            internal_param_key: "pixel_size".to_string(),
            spec: ParamSpec {
                key: "pixel_size".to_string(),
                label: "Pixel Size".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(4),
                min: Some(1.0),
                max: Some(128.0),
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
                promotable: true,
            },
        },
        Promotion {
            group_param_key: "algorithm".to_string(),
            internal_node_id: "kernel".to_string(),
            internal_param_key: "algorithm".to_string(),
            spec: ParamSpec {
                key: "algorithm".to_string(),
                label: "Algorithm".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(1.0),
                ui_hint: UiHint::Dropdown(vec![
                    "Two Nearest".to_string(),
                    "Threshold Offset".to_string(),
                ]),
                promotable: true,
            },
        },
        Promotion {
            group_param_key: "matrix_size".to_string(),
            internal_node_id: "kernel".to_string(),
            internal_param_key: "matrix_size".to_string(),
            spec: ParamSpec {
                key: "matrix_size".to_string(),
                label: "Matrix Size".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(8),
                min: Some(2.0),
                max: Some(8.0),
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
                promotable: true,
            },
        },
        Promotion {
            group_param_key: "dither_amount".to_string(),
            internal_node_id: "kernel".to_string(),
            internal_param_key: "dither_amount".to_string(),
            spec: ParamSpec {
                key: "dither_amount".to_string(),
                label: "Dither Amount".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
                promotable: true,
            },
        },
    ];

    GroupDefinition {
        id: "group::pixelate".to_string(),
        name: "Pixelate".to_string(),
        category: "GPU".to_string(),
        description: "Pixelate an image with optional palette dithering".to_string(),
        internal_graph: SerializableInternalGraph { nodes, connections },
        promotions,
        is_builtin: true,
        explicit_inputs: None,
        explicit_outputs: None,
    }
}

pub fn register_builtin_groups(engine: &mut Engine) {
    if let Err(err) = engine.register_group(color_range_group()) {
        eprintln!("[cascade-runtime] Failed to register Color Range group: {err}");
    }
    if let Err(err) = engine.register_group(pixelate_group()) {
        eprintln!("[cascade-runtime] Failed to register Pixelate group: {err}");
    }
}
