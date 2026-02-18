use compositor_core::color::ColorManagement;
use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

pub struct Viewer;

impl Viewer {
    pub fn new() -> Self {
        Self
    }

    pub fn image_to_rgba8(image: &Image, cm: &dyn ColorManagement) -> Vec<u8> {
        Self::image_to_rgba8_with_display(image, cm, "sRGB", "Standard")
    }

    pub fn image_to_rgba8_with_display(
        image: &Image,
        cm: &dyn ColorManagement,
        display: &str,
        view: &str,
    ) -> Vec<u8> {
        let mut pixels = image.data.as_ref().clone();
        let source_space = cm.working_space();
        if let Ok(processor) = cm.create_display_transform(source_space, display, view) {
            processor.apply(&mut pixels);
        }
        let pixel_count = image.pixel_count();
        let mut out = vec![0u8; pixel_count * 4];
        out.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, rgba_out)| {
                let idx = i * 4;
                for c in 0..3 {
                    rgba_out[c] = (pixels[idx + c].clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
                }
                rgba_out[3] = (pixels[idx + 3].clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
            });
        out
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
                ..Default::default()
            }],
            outputs: vec![PortSpec {
                name: "display".to_string(),
                label: "Display".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let mut outputs = HashMap::new();
            outputs.insert("display".to_string(), Value::Image(image.clone()));
            Ok(outputs)
        })
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
                ..Default::default()
            }],
            outputs: vec![PortSpec {
                name: "display".to_string(),
                label: "Display".to_string(),
                ty: ValueType::Image,
                ..Default::default()
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let mut outputs = HashMap::new();
            outputs.insert("display".to_string(), Value::Image(image.clone()));
            Ok(outputs)
        })
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

pub struct ExportVideo;

impl ExportVideo {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ExportVideo {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "export_video".to_string(),
            display_name: "Export Video".to_string(),
            category: "Output".to_string(),
            description: "Export rendered frames as an encoded video file".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            outputs: vec![PortSpec {
                name: "display".to_string(),
                label: "Display".to_string(),
                ty: ValueType::Image,
                ..Default::default()
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
                    promotable: true,
                },
                ParamSpec {
                    key: "codec".to_string(),
                    label: "Codec".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "H.264".to_string(),
                        "H.265 (HEVC)".to_string(),
                    ]),
                    promotable: true,
                },
                ParamSpec {
                    key: "quality".to_string(),
                    label: "Quality (CRF)".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(23),
                    min: Some(0.0),
                    max: Some(51.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "fps".to_string(),
                    label: "FPS".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(24),
                    min: Some(1.0),
                    max: Some(120.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "start_frame".to_string(),
                    label: "Start Frame".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(100000.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "end_frame".to_string(),
                    label: "End Frame".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(100),
                    min: Some(0.0),
                    max: Some(100000.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "step".to_string(),
                    label: "Step".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1),
                    min: Some(1.0),
                    max: Some(100.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let mut outputs = HashMap::new();
            outputs.insert("display".to_string(), Value::Image(image.clone()));
            Ok(outputs)
        })
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
                ..Default::default()
            }],
            outputs: vec![PortSpec {
                name: "display".to_string(),
                label: "Display".to_string(),
                ty: ValueType::Image,
                ..Default::default()
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
                    promotable: true,
                },
                ParamSpec {
                    key: "start_frame".to_string(),
                    label: "Start Frame".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(100000.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "end_frame".to_string(),
                    label: "End Frame".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(100),
                    min: Some(0.0),
                    max: Some(100000.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "step".to_string(),
                    label: "Step".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1),
                    min: Some(1.0),
                    max: Some(100.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let mut outputs = HashMap::new();
            outputs.insert("display".to_string(), Value::Image(image.clone()));
            Ok(outputs)
        })
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}
