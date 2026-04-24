use cascade_core::color::ColorManagement;
use cascade_core::exr::encode_multilayer_exr;
use cascade_core::node::{EvalContext, Node, NodeFuture};
use cascade_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;
use std::sync::Arc;

pub struct Viewer;

impl Default for Viewer {
    fn default() -> Self {
        Self::new()
    }
}

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
        let processor = cm
            .create_display_transform(source_space, display, view)
            .or_else(|_| cm.create_transform(source_space, &ColorSpaceId::new(ColorSpaceId::SRGB)));
        if let Ok(processor) = processor {
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
                name: "value".to_string(),
                label: "Value".to_string(),
                ty: ValueType::Any,
                ..Default::default()
            }],
            outputs: vec![PortSpec {
                name: "display".to_string(),
                label: "Display".to_string(),
                ty: ValueType::Any,
                ..Default::default()
            }],
            params: vec![],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            // Generic passthrough: forward whatever value we receive
            let value = ctx.inputs.get("value").cloned().unwrap_or(Value::None);
            let mut outputs = HashMap::new();
            outputs.insert("display".to_string(), value);
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

impl Default for ExportImage {
    fn default() -> Self {
        Self::new()
    }
}

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

/// Encodes one or more image inputs into an in-memory EXR file.
pub struct SaveExr;

impl Default for SaveExr {
    fn default() -> Self {
        Self::new()
    }
}

impl SaveExr {
    pub fn new() -> Self {
        Self
    }
}

impl Node for SaveExr {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "save_exr".to_string(),
            display_name: "Save EXR".to_string(),
            category: "Output".to_string(),
            description: "Encode image layers into an EXR file".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            outputs: vec![PortSpec {
                name: "exr_bytes".to_string(),
                label: "EXR Bytes".to_string(),
                ty: ValueType::Bytes,
                ..Default::default()
            }],
            params: vec![ParamSpec {
                key: "compression".to_string(),
                label: "Compression".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(0),
                min: Some(0.0),
                max: Some(4.0),
                step: Some(1.0),
                ui_hint: UiHint::Dropdown(vec![
                    "PIZ".to_string(),
                    "ZIP".to_string(),
                    "ZIPS".to_string(),
                    "RLE".to_string(),
                    "None".to_string(),
                ]),
                promotable: false,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;

            // Map the dropdown index to a compression name.
            let comp_idx = ctx.get_param_int("compression").unwrap_or(0);
            let compression = match comp_idx {
                0 => "PIZ",
                1 => "ZIP",
                2 => "ZIPS",
                3 => "RLE",
                4 => "None",
                _ => "PIZ",
            };

            // Single-layer encode: the unnamed primary layer.
            let layers: Vec<(&str, &Image)> = vec![("", image)];
            let bytes = encode_multilayer_exr(&layers, compression)?;

            let mut outputs = HashMap::new();
            outputs.insert("exr_bytes".to_string(), Value::Bytes(Arc::new(bytes)));
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

impl Default for ExportVideo {
    fn default() -> Self {
        Self::new()
    }
}

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

impl Default for ExportImageSequence {
    fn default() -> Self {
        Self::new()
    }
}

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

pub struct ExportImageBatch;

impl Default for ExportImageBatch {
    fn default() -> Self {
        Self::new()
    }
}

impl ExportImageBatch {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ExportImageBatch {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "export_image_batch".to_string(),
            display_name: "Export Image Batch".to_string(),
            category: "Output".to_string(),
            description: "Export a batch of processed images".to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "filename".to_string(),
                    label: "Filename".to_string(),
                    ty: ValueType::String,
                    ..Default::default()
                },
            ],
            outputs: vec![PortSpec {
                name: "display".to_string(),
                label: "Display".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_save_exr_spec() {
        let node = SaveExr::new();
        let spec = node.spec();

        assert_eq!(spec.id, "save_exr");

        let input = spec
            .inputs
            .iter()
            .find(|port| port.name == "image")
            .expect("save_exr input missing");
        assert_eq!(input.ty, ValueType::Image);

        let output = spec
            .outputs
            .iter()
            .find(|port| port.name == "exr_bytes")
            .expect("save_exr output missing");
        assert_eq!(output.ty, ValueType::Bytes);

        let compression = spec
            .params
            .iter()
            .find(|param| param.key == "compression")
            .expect("save_exr compression param missing");

        match &compression.ui_hint {
            UiHint::Dropdown(options) => {
                assert!(!options.is_empty());
            }
            _ => panic!("compression param should use dropdown"),
        }
    }
}
