use compositor_core::color::ColorManagement;
use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::ColorSpaceId;
use compositor_core::types::*;
use std::any::Any;
use std::collections::HashMap;

pub struct ColorConvert;

impl ColorConvert {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ColorConvert {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "color_convert".to_string(),
            display_name: "Color Convert".to_string(),
            category: "Color".to_string(),
            description: "Convert between color spaces".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![
                ParamSpec {
                    key: "from_space".to_string(),
                    label: "From Space".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::String(ColorSpaceId::LINEAR_SRGB.to_string()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Dropdown(vec![
                        ColorSpaceId::LINEAR_SRGB.to_string(),
                        ColorSpaceId::SRGB.to_string(),
                    ]),
                    promotable: true,
                },
                ParamSpec {
                    key: "to_space".to_string(),
                    label: "To Space".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::String(ColorSpaceId::SRGB.to_string()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Dropdown(vec![
                        ColorSpaceId::LINEAR_SRGB.to_string(),
                        ColorSpaceId::SRGB.to_string(),
                    ]),
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let from_space = ctx.get_param_string("from_space")?;
            let to_space = ctx.get_param_string("to_space")?;
            let from_id = ColorSpaceId::new(from_space);
            let to_id = ColorSpaceId::new(to_space);

            let mut data = image.data.as_ref().clone();
            let cm: &dyn ColorManagement = ctx.color_management;
            let processor = cm.create_transform(&from_id, &to_id)?;
            processor.apply(&mut data);

            let output =
                Image::new_with_domain(image.format.clone(), image.data_window, data, to_id)?;
            let mut outputs = HashMap::new();
            outputs.insert("image".to_string(), Value::Image(output));
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
