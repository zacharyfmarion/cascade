use compositor_core::error::CompositorError;
use compositor_core::node::{EvalContext, Node};
use compositor_core::types::*;
use std::any::Any;
use std::collections::HashMap;

pub struct Viewer;

impl Viewer {
    pub fn new() -> Self {
        Self
    }

    pub fn image_to_rgba8(image: &Image) -> Vec<u8> {
        image.to_rgba8_srgb()
    }
}

impl Node for Viewer {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "viewer".to_string(),
            display_name: "Viewer".to_string(),
            category: "Output".to_string(),
            description: "Display output".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            outputs: vec![PortSpec {
                name: "display".to_string(),
                label: "Display".to_string(),
                ty: ValueType::Image,
            }],
            params: vec![],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let image = ctx.get_input_image("image")?;
        let mut outputs = HashMap::new();
        outputs.insert("display".to_string(), Value::Image(image.clone()));
        Ok(outputs)
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

pub struct ExportImage;

impl ExportImage {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ExportImage {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "export_image".to_string(),
            display_name: "Export Image".to_string(),
            category: "Output".to_string(),
            description: "Encode image for export".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            outputs: vec![PortSpec {
                name: "display".to_string(),
                label: "Display".to_string(),
                ty: ValueType::Image,
            }],
            params: vec![
                ParamSpec {
                    key: "output_path".to_string(),
                    label: "Output Path".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::String(String::new()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Hidden,
                },
                ParamSpec {
                    key: "format".to_string(),
                    label: "Format".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec!["PNG".to_string(), "JPEG".to_string()]),
                },
                ParamSpec {
                    key: "quality".to_string(),
                    label: "Quality".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(90),
                    min: Some(1.0),
                    max: Some(100.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
            ],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let image = ctx.get_input_image("image")?;
        let mut outputs = HashMap::new();
        outputs.insert("display".to_string(), Value::Image(image.clone()));
        Ok(outputs)
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

pub struct ExportImageSequence;

impl ExportImageSequence {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ExportImageSequence {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "export_image_sequence".to_string(),
            display_name: "Export Image Sequence".to_string(),
            category: "Output".to_string(),
            description: "Export an image sequence to a directory".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            outputs: vec![PortSpec {
                name: "display".to_string(),
                label: "Display".to_string(),
                ty: ValueType::Image,
            }],
            params: vec![
                ParamSpec {
                    key: "output_dir".to_string(),
                    label: "Output Directory".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::String(String::new()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Hidden,
                },
                ParamSpec {
                    key: "start_frame".to_string(),
                    label: "Start Frame".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(100000.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Hidden,
                },
                ParamSpec {
                    key: "end_frame".to_string(),
                    label: "End Frame".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(100),
                    min: Some(0.0),
                    max: Some(100000.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Hidden,
                },
                ParamSpec {
                    key: "step".to_string(),
                    label: "Step".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1),
                    min: Some(1.0),
                    max: Some(100.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Hidden,
                },
                ParamSpec {
                    key: "format".to_string(),
                    label: "Format".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec!["PNG".to_string(), "JPEG".to_string()]),
                },
                ParamSpec {
                    key: "quality".to_string(),
                    label: "Quality".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(90),
                    min: Some(1.0),
                    max: Some(100.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
            ],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let image = ctx.get_input_image("image")?;
        let mut outputs = HashMap::new();
        outputs.insert("display".to_string(), Value::Image(image.clone()));
        Ok(outputs)
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}
