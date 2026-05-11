use cascade_core::node::NodeRegistry;
use std::sync::Arc;

pub mod ai;
pub mod blend;
pub mod color;
pub mod color_convert;
pub mod color_ops;
pub mod filter;
pub mod filter_ops;
pub mod generate;
pub mod group;
pub mod input;
pub mod mask_utils;
pub mod matte;
pub mod output;
pub mod palette;
pub mod script;
pub mod time_ops;
pub mod transform;
pub mod utility;

pub use ai::{
    decode_response_image, encode_image_png, AiDepthEstimate, AiGenerateImage, AiInpaint,
    AiRemoveBackground, AiUpscale,
};
pub use color::{ColorRampNode, CombineHsva, SeparateHsva};
pub use color_convert::ColorConvert;
pub use color_ops::Curves;
pub use filter::GaussianBlur;
pub use filter_ops::{Dilate, DirectionalBlur, Erode, Median, RadialBlur, Sharpen};
pub use generate::{
    BooleanConstant, Checkerboard, ColorConstant, FloatConstant, Gradient, IntegerConstant, Noise,
    RasterizeField, SolidColor, Text, TextArea, UVMap,
};
pub use group::{GroupInputNode, GroupNode, GroupOutputNode};
pub use input::{
    srgb_to_linear_lut, LoadImage, LoadImageBatch, LoadImageSequence, LoadVideo, SequenceInfo,
};
pub use matte::{CombineRgba, EdgeBlur, MatteExpand, MatteShrink, SeparateRgba};
pub use output::{
    CompareViewer, ExportImageBatch, ExportImageSequence, ExportVideo, SaveExr, Viewer,
};
pub use palette::ColorPaletteNode;
pub use script::GpuScriptDraftNode;
pub use time_ops::{FrameBlend, FrameHold, TimeOffset};
pub use transform::{resize_nearest, CornerPin, Crop, Flip, Resize, STMap, Translate};
pub use utility::{Dot, ImageInfo, MathNode, ProjectInfo};

pub fn register_standard_nodes(registry: &mut NodeRegistry) {
    // Input/Output
    registry.register("load_image", || Arc::new(LoadImage::new()));
    registry.register("load_image_sequence", || Arc::new(LoadImageSequence::new()));
    registry.register("load_image_batch", || Arc::new(LoadImageBatch::new()));
    registry.register("load_video", || Arc::new(LoadVideo::new()));
    registry.register("viewer", || Arc::new(Viewer::new()));
    registry.register("compare_viewer", || Arc::new(CompareViewer::new()));

    registry.register("ai_inpaint", || Arc::new(AiInpaint::new()));
    registry.register("ai_depth_estimate", || Arc::new(AiDepthEstimate::new()));
    registry.register("ai_remove_background", || {
        Arc::new(AiRemoveBackground::new())
    });
    registry.register("ai_upscale", || Arc::new(AiUpscale::new()));
    registry.register("ai_generate_image", || Arc::new(AiGenerateImage::new()));

    // Color
    registry.register("color_convert", || Arc::new(ColorConvert::new()));
    registry.register("curves", || Arc::new(Curves::new()));
    registry.register("color_palette", || Arc::new(ColorPaletteNode::new()));
    registry.register("separate_hsva", || Arc::new(SeparateHsva::new()));
    registry.register("combine_hsva", || Arc::new(CombineHsva::new()));
    registry.register("color_ramp", || Arc::new(ColorRampNode::new()));
    registry.register("math", || Arc::new(MathNode::new()));
    registry.register("dot", || Arc::new(Dot::new()));
    registry.register("project_info", || Arc::new(ProjectInfo::new()));
    registry.register("image_info", || Arc::new(ImageInfo::new()));

    // Filter
    registry.register("gaussian_blur", || Arc::new(GaussianBlur::new()));
    registry.register("sharpen", || Arc::new(Sharpen::new()));
    registry.register("dilate", || Arc::new(Dilate::new()));
    registry.register("erode", || Arc::new(Erode::new()));
    registry.register("median", || Arc::new(Median::new()));
    registry.register("directional_blur", || Arc::new(DirectionalBlur::new()));
    registry.register("radial_blur", || Arc::new(RadialBlur::new()));

    // Transform
    registry.register("resize", || Arc::new(Resize::new()));
    registry.register("crop", || Arc::new(Crop::new()));
    registry.register("flip", || Arc::new(Flip::new()));
    registry.register("translate", || Arc::new(Translate::new()));
    registry.register("corner_pin", || Arc::new(CornerPin::new()));
    registry.register("st_map", || Arc::new(STMap::new()));

    registry.register("time_offset", || Arc::new(TimeOffset::new()));
    registry.register("frame_hold", || Arc::new(FrameHold::new()));
    registry.register("frame_blend", || Arc::new(FrameBlend::new()));

    // Generator
    registry.register("solid_color", || Arc::new(SolidColor::new()));
    registry.register("noise", || Arc::new(Noise::new()));
    registry.register("gradient", || Arc::new(Gradient::new()));
    registry.register("checkerboard", || Arc::new(Checkerboard::new()));
    registry.register("rasterize_field", || Arc::new(RasterizeField::new()));
    registry.register("float_constant", || Arc::new(FloatConstant::new()));
    registry.register("integer_constant", || Arc::new(IntegerConstant::new()));
    registry.register("color_constant", || Arc::new(ColorConstant::new()));
    registry.register("boolean_constant", || Arc::new(BooleanConstant::new()));
    registry.register("text_area", || Arc::new(TextArea::new()));
    registry.register("text", || Arc::new(Text::new()));
    registry.register("uv_map", || Arc::new(UVMap::new()));

    // Matte
    registry.register("edge_blur", || Arc::new(EdgeBlur::new()));
    registry.register("matte_expand", || Arc::new(MatteExpand::new()));
    registry.register("matte_shrink", || Arc::new(MatteShrink::new()));
    registry.register("shape", || Arc::new(Shape::new()));
    registry.register("glow", || Arc::new(Glow::new()));
    registry.register("export_image", || Arc::new(ExportImage::new()));
    registry.register("export_image_sequence", || {
        Arc::new(ExportImageSequence::new())
    });
    registry.register("export_video", || Arc::new(ExportVideo::new()));

    registry.register("export_image_batch", || Arc::new(ExportImageBatch::new()));
    registry.register("save_exr", || Arc::new(SaveExr::new()));
    registry.register("gpu_script", || {
        Arc::new(GpuScriptDraftNode::new("gpu_script"))
    });
}

pub use filter_ops::Glow;
pub use generate::Shape;
pub use output::ExportImage;

#[cfg(test)]
mod tests {
    use super::*;
    use cascade_core::color::BuiltinColorManagement;
    use cascade_core::node::{EvalContext, Node};
    use cascade_core::types::*;
    use pollster::block_on;
    use std::collections::HashMap;

    fn eval_field_passthrough(
        node: &dyn Node,
        field_color: [f32; 4],
        params: HashMap<String, ParamValue>,
    ) -> Value {
        let field = Field::new(move |_u, _v| field_color);
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Field(field));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();
        result.get("image").unwrap().clone()
    }

    fn sample_field(value: &Value) -> [f32; 4] {
        match value {
            Value::Field(f) => f.sample(0.5, 0.5),
            other => panic!("Expected Value::Field, got {:?}", other.value_type()),
        }
    }

    fn approx_eq(a: f32, b: f32) -> bool {
        (a - b).abs() < 0.001
    }

    fn assert_color_approx(actual: [f32; 4], expected: [f32; 4], msg: &str) {
        assert!(
            approx_eq(actual[0], expected[0])
                && approx_eq(actual[1], expected[1])
                && approx_eq(actual[2], expected[2])
                && approx_eq(actual[3], expected[3]),
            "{msg}: expected {expected:?}, got {actual:?}"
        );
    }

    fn eval_context_for_inputs<'a>(
        inputs: HashMap<String, Value>,
        params: &'a HashMap<String, ParamValue>,
        cm: &'a BuiltinColorManagement,
        format: &'a Format,
    ) -> EvalContext<'a> {
        EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params,
            frame_time: FrameTime { frame: 0 },
            color_management: cm,
            ai_provider: None,
            project_format: format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        }
    }

    fn scalar_default_type(default: &ParamDefault) -> Option<ValueType> {
        match default {
            ParamDefault::Float(_) => Some(ValueType::Float),
            ParamDefault::Int(_) => Some(ValueType::Int),
            ParamDefault::Bool(_) => Some(ValueType::Bool),
            ParamDefault::Color(_) => Some(ValueType::Color),
            ParamDefault::String(_) => Some(ValueType::String),
            ParamDefault::ColorRamp(_)
            | ParamDefault::ColorPalette(_)
            | ParamDefault::CurvePoints(_) => None,
        }
    }

    fn is_scalar_value_type(ty: &ValueType) -> bool {
        matches!(
            ty,
            ValueType::Float
                | ValueType::Int
                | ValueType::Bool
                | ValueType::Color
                | ValueType::String
        )
    }

    #[test]
    fn standard_node_scalar_param_defaults_match_declared_types() {
        let mut registry = NodeRegistry::new();
        register_standard_nodes(&mut registry);

        for spec in registry.list_specs() {
            for param in &spec.params {
                if matches!(param.ui_hint, UiHint::Dropdown(_)) || !is_scalar_value_type(&param.ty)
                {
                    continue;
                }
                let Some(expected) = scalar_default_type(&param.default) else {
                    continue;
                };
                assert_eq!(
                    param.ty, expected,
                    "{}.{} declares {:?} but has {:?} default",
                    spec.id, param.key, param.ty, param.default
                );
            }
        }
    }

    #[test]
    fn export_image_batch_output_dir_is_string_param() {
        let spec = ExportImageBatch::new().spec();
        let output_dir = spec
            .params
            .iter()
            .find(|param| param.key == "output_dir")
            .expect("ExportImageBatch output_dir param missing");

        assert_eq!(output_dir.ty, ValueType::String);
        assert!(matches!(&output_dir.default, ParamDefault::String(value) if value.is_empty()));
    }

    #[test]
    fn load_image_batch_source_params_are_strings() {
        let spec = LoadImageBatch::new().spec();
        for key in ["directory", "files"] {
            let param = spec
                .params
                .iter()
                .find(|param| param.key == key)
                .unwrap_or_else(|| panic!("LoadImageBatch {key} param missing"));

            assert_eq!(param.ty, ValueType::String);
            assert!(matches!(&param.default, ParamDefault::String(value) if value.is_empty()));
        }
    }

    #[test]
    fn compare_viewer_spec_declares_two_visible_inputs_and_hidden_buffers() {
        let spec = CompareViewer::new().spec();
        assert_eq!(spec.id, "compare_viewer");
        assert_eq!(spec.inputs.len(), 2);
        assert_eq!(spec.inputs[0].name, "before");
        assert_eq!(spec.inputs[1].name, "after");
        assert_eq!(spec.outputs[0].name, "display");
        assert!(spec
            .outputs
            .iter()
            .any(|port| port.name == "before_display"
                && matches!(port.ui_hint, Some(UiHint::Hidden))));
        assert!(spec.outputs.iter().any(
            |port| port.name == "after_display" && matches!(port.ui_hint, Some(UiHint::Hidden))
        ));
    }

    #[test]
    fn compare_viewer_forwards_after_image_to_display() {
        let before = Image::from_f32_data(1, 1, vec![0.0, 0.0, 0.0, 1.0]).unwrap();
        let after = Image::from_f32_data(1, 1, vec![1.0, 0.0, 0.0, 1.0]).unwrap();
        let mut inputs = HashMap::new();
        inputs.insert("before".to_string(), Value::Image(before));
        inputs.insert("after".to_string(), Value::Image(after.clone()));
        let params = HashMap::new();
        let cm = BuiltinColorManagement::new();
        let format = Format::from_dimensions(1, 1);
        let ctx = eval_context_for_inputs(inputs, &params, &cm, &format);

        let result = block_on(CompareViewer::new().evaluate(&ctx)).unwrap();
        match result.get("display") {
            Some(Value::Image(image)) => assert_eq!(image.data.as_ref(), after.data.as_ref()),
            other => panic!("Expected display image, got {other:?}"),
        }
    }

    fn curves_default_params() -> HashMap<String, ParamValue> {
        let identity = vec![CurvePoint { x: 0.0, y: 0.0 }, CurvePoint { x: 1.0, y: 1.0 }];
        let mut params = HashMap::new();
        params.insert("channel".to_string(), ParamValue::Int(0));
        params.insert(
            "master_curve".to_string(),
            ParamValue::CurvePoints(identity.clone()),
        );
        params.insert(
            "red_curve".to_string(),
            ParamValue::CurvePoints(identity.clone()),
        );
        params.insert(
            "green_curve".to_string(),
            ParamValue::CurvePoints(identity.clone()),
        );
        params.insert("blue_curve".to_string(), ParamValue::CurvePoints(identity));
        params
    }

    #[test]
    fn test_curves_field_passthrough() {
        let node = Curves::new();
        let params = curves_default_params();
        let value = eval_field_passthrough(&node, [0.5, 0.5, 0.5, 1.0], params);
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [0.5, 0.5, 0.5, 1.0], "curves identity field");
    }

    #[test]
    fn test_curves_identity() {
        let node = Curves::new();
        let params = curves_default_params();
        let img = make_test_image(2, 2, [0.3, 0.5, 0.7, 1.0]);
        let result = eval_image_node(&node, img, params);
        assert_color_approx(
            [
                result.data[0],
                result.data[1],
                result.data[2],
                result.data[3],
            ],
            [0.3, 0.5, 0.7, 1.0],
            "curves identity",
        );
    }

    #[test]
    fn test_curves_master_darkens() {
        let node = Curves::new();
        let mut params = curves_default_params();
        // S-curve that pulls midtones down
        params.insert(
            "master_curve".to_string(),
            ParamValue::CurvePoints(vec![
                CurvePoint { x: 0.0, y: 0.0 },
                CurvePoint { x: 0.5, y: 0.3 },
                CurvePoint { x: 1.0, y: 1.0 },
            ]),
        );
        let img = make_test_image(2, 2, [0.5, 0.5, 0.5, 1.0]);
        let result = eval_image_node(&node, img, params);
        let r = result.data[0];
        let g = result.data[1];
        let b = result.data[2];
        // Midtones should be pulled down toward 0.3
        assert!(r < 0.5, "master curve should darken midtones, got r={r}");
        assert!((r - 0.3).abs() < 0.02, "expected ~0.3, got r={r}");
        assert!(
            (r - g).abs() < 0.001,
            "master should affect all channels equally"
        );
        assert!(
            (r - b).abs() < 0.001,
            "master should affect all channels equally"
        );
        // Alpha unchanged
        assert!(
            (result.data[3] - 1.0).abs() < 0.001,
            "alpha should be unchanged"
        );
    }

    #[test]
    fn test_curves_per_channel() {
        let node = Curves::new();
        let mut params = curves_default_params();
        // Only adjust red curve — lift midtones
        params.insert(
            "red_curve".to_string(),
            ParamValue::CurvePoints(vec![
                CurvePoint { x: 0.0, y: 0.0 },
                CurvePoint { x: 0.5, y: 0.7 },
                CurvePoint { x: 1.0, y: 1.0 },
            ]),
        );
        let img = make_test_image(2, 2, [0.5, 0.5, 0.5, 1.0]);
        let result = eval_image_node(&node, img, params);
        let r = result.data[0];
        let g = result.data[1];
        let b = result.data[2];
        // Red should be lifted
        assert!(r > 0.6, "red curve should lift red midtones, got r={r}");
        // Green and blue should be unchanged (identity curve)
        assert!(
            (g - 0.5).abs() < 0.01,
            "green should be unchanged, got g={g}"
        );
        assert!(
            (b - 0.5).abs() < 0.01,
            "blue should be unchanged, got b={b}"
        );
    }

    #[test]
    fn test_curves_monotone_no_overshoot() {
        let node = Curves::new();
        let mut params = curves_default_params();
        // Steep S-curve that would overshoot with natural cubic spline
        params.insert(
            "master_curve".to_string(),
            ParamValue::CurvePoints(vec![
                CurvePoint { x: 0.0, y: 0.0 },
                CurvePoint { x: 0.25, y: 0.0 },
                CurvePoint { x: 0.5, y: 1.0 },
                CurvePoint { x: 0.75, y: 1.0 },
                CurvePoint { x: 1.0, y: 1.0 },
            ]),
        );
        // Test values across the range — none should go below 0 or above 1
        for input_val in [0.1f32, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] {
            let img = make_test_image(1, 1, [input_val, input_val, input_val, 1.0]);
            let result = eval_image_node(&node, img, params.clone());
            let out = result.data[0];
            assert!(
                (-0.01..=1.01).contains(&out),
                "monotone cubic should not overshoot: input={input_val}, output={out}"
            );
        }
    }

    #[test]
    fn test_curves_format_passthrough() {
        let node = Curves::new();
        let params = curves_default_params();
        let img = make_test_image(2, 2, [0.5, 0.5, 0.5, 1.0]);
        let result = eval_image_node(&node, img, params);
        assert_eq!(result.format.width(), 2);
        assert_eq!(result.format.height(), 2);
    }

    // ── Format / data_window propagation tests ──────────────────────────

    /// Helper: create a small test image with a non-trivial data_window and format.
    /// The image is 4×4 pixels with data_window offset to (100,100)→(104,104)
    /// and format set to HD 1920×1080. All pixels are set to `color`.
    fn make_test_image(w: u32, h: u32, color: [f32; 4]) -> Image {
        let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];
        for pixel in data.chunks_exact_mut(4) {
            pixel.copy_from_slice(&color);
        }
        Image::from_f32_data(w, h, data).unwrap()
    }

    fn make_offset_image(color: [f32; 4]) -> Image {
        let w = 4u32;
        let h = 4u32;
        let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];
        for pixel in data.chunks_exact_mut(4) {
            pixel.copy_from_slice(&color);
        }
        let format = Format::hd(); // 1920×1080 display window
        let data_window = RectI {
            min: IVec2::new(100, 100),
            max: IVec2::new(104, 104),
        };
        Image::new_with_domain(format, data_window, data, ColorSpaceId::default_working()).unwrap()
    }

    /// Helper: evaluate a node with a single image input and return the output image.
    fn eval_image_node(
        node: &dyn Node,
        input: Image,
        params: HashMap<String, ParamValue>,
    ) -> Image {
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(input));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();
        match result.get("image").unwrap() {
            Value::Image(img) => img.clone(),
            other => panic!("Expected Value::Image, got {:?}", other.value_type()),
        }
    }

    #[test]
    fn test_format_propagation_with_custom_color_space() {
        // Use ACEScg color space to verify it's preserved through the chain
        let w = 4u32;
        let h = 4u32;
        let data = vec![0.5f32; (w as usize) * (h as usize) * 4];
        let format = Format::hd();
        let data_window = RectI {
            min: IVec2::new(50, 50),
            max: IVec2::new(54, 54),
        };
        let input = Image::new_with_domain(
            format,
            data_window,
            data,
            ColorSpaceId::new(ColorSpaceId::ACESCG),
        )
        .unwrap();

        let node = GaussianBlur::new();
        let mut params = HashMap::new();
        params.insert("sigma".to_string(), ParamValue::Float(1.0));
        let output = eval_image_node(&node, input.clone(), params);

        assert_eq!(
            output.color_space.as_str(),
            ColorSpaceId::ACESCG,
            "ACEScg color space must be preserved"
        );
        assert_eq!(output.data_window, input.data_window);
        assert_eq!(output.format, input.format);
    }

    #[test]
    fn test_format_propagation_gaussian_blur() {
        let input = make_offset_image([0.5, 0.5, 0.5, 1.0]);
        let node = GaussianBlur::new();
        let mut params = HashMap::new();
        params.insert("sigma".to_string(), ParamValue::Float(1.0));

        let output = eval_image_node(&node, input.clone(), params);

        assert_eq!(
            output.format, input.format,
            "format must propagate through blur"
        );
        assert_eq!(
            output.data_window, input.data_window,
            "data_window must propagate through blur"
        );
        assert_eq!(
            output.color_space, input.color_space,
            "color_space must propagate through blur"
        );
        assert_eq!(output.width, 4);
        assert_eq!(output.height, 4);
    }

    #[test]
    fn test_get_rgba_respects_data_window() {
        // Verify that get_rgba returns transparent black outside data_window
        let input = make_offset_image([1.0, 0.0, 0.0, 1.0]);

        // Inside data_window (100,100)→(104,104)
        let inside = input.get_rgba(101, 101);
        assert!(
            approx_eq(inside[0], 1.0) && approx_eq(inside[3], 1.0),
            "inside data_window should return red: got {inside:?}"
        );

        // Outside data_window
        let outside = input.get_rgba(0, 0);
        assert!(
            approx_eq(outside[0], 0.0) && approx_eq(outside[3], 0.0),
            "outside data_window should return transparent black: got {outside:?}"
        );

        // Just outside boundary
        let edge = input.get_rgba(104, 104); // max is exclusive
        assert!(
            approx_eq(edge[0], 0.0) && approx_eq(edge[3], 0.0),
            "at max boundary (exclusive) should return transparent black: got {edge:?}"
        );
    }

    // ── Compositing tests ───────────────────────────────────────────────

    fn eval_two_input_node(
        node: &dyn Node,
        input_a_name: &str,
        input_a: Image,
        input_b_name: &str,
        input_b: Image,
        params: HashMap<String, ParamValue>,
    ) -> Image {
        let mut inputs = HashMap::new();
        inputs.insert(input_a_name.to_string(), Value::Image(input_a));
        inputs.insert(input_b_name.to_string(), Value::Image(input_b));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();
        match result.get("image").unwrap() {
            Value::Image(img) => img.clone(),
            other => panic!("Expected Value::Image, got {:?}", other.value_type()),
        }
    }

    #[test]
    fn test_translate_zero_cost_data_window_shift() {
        let input = make_offset_image([1.0, 0.0, 0.0, 1.0]);
        let original_dw = input.data_window;

        let node = Translate::new();
        let mut params = HashMap::new();
        params.insert("x".to_string(), ParamValue::Int(50));
        params.insert("y".to_string(), ParamValue::Int(-30));

        let output = eval_image_node(&node, input.clone(), params);

        let expected_dw = RectI {
            min: IVec2::new(original_dw.min.x + 50, original_dw.min.y - 30),
            max: IVec2::new(original_dw.max.x + 50, original_dw.max.y - 30),
        };
        assert_eq!(output.data_window, expected_dw);
        assert_eq!(output.format, input.format);
        assert_eq!(output.width, input.width);
        assert_eq!(output.height, input.height);

        let px = output.get_rgba(150, 70);
        assert_color_approx(px, [1.0, 0.0, 0.0, 1.0], "pixel at shifted location");
    }

    #[test]
    fn test_crop_intersects_data_window() {
        let input = make_offset_image([0.0, 1.0, 0.0, 1.0]);
        let node = Crop::new();
        let mut params = HashMap::new();
        params.insert("x".to_string(), ParamValue::Int(102));
        params.insert("y".to_string(), ParamValue::Int(101));
        params.insert("width".to_string(), ParamValue::Int(10));
        params.insert("height".to_string(), ParamValue::Int(10));

        let output = eval_image_node(&node, input.clone(), params);

        // Output is always exactly width×height, starting at origin
        let expected_dw = RectI {
            min: IVec2::new(0, 0),
            max: IVec2::new(10, 10),
        };
        assert_eq!(output.data_window, expected_dw);
        assert_eq!(output.width, 10);
        assert_eq!(output.height, 10);
        assert_eq!(output.format, input.format);
        // Pixel at output (0,0) maps to source global (102,101) which is inside the input
        let px = output.get_rgba(0, 0);
        assert_color_approx(px, [0.0, 1.0, 0.0, 1.0], "pixel inside crop");
        // Pixel at output (2,3) maps to source global (104,104) which is outside the input
        let px_outside = output.get_rgba(2, 3);
        assert_color_approx(
            px_outside,
            [0.0, 0.0, 0.0, 0.0],
            "pixel outside source is transparent",
        );
    }

    #[test]
    fn test_crop_no_overlap_produces_empty() {
        let input = make_offset_image([1.0, 0.0, 0.0, 1.0]);
        let node = Crop::new();
        let mut params = HashMap::new();
        params.insert("x".to_string(), ParamValue::Int(200));
        params.insert("y".to_string(), ParamValue::Int(200));
        params.insert("width".to_string(), ParamValue::Int(10));
        params.insert("height".to_string(), ParamValue::Int(10));

        let output = eval_image_node(&node, input, params);

        // Output is always exactly width×height, even with no overlap
        assert_eq!(output.width, 10);
        assert_eq!(output.height, 10);
        let px = output.get_rgba(0, 0);
        assert_color_approx(
            px,
            [0.0, 0.0, 0.0, 0.0],
            "non-overlapping crop is transparent",
        );
    }

    #[test]
    fn test_crop_clip_to_source_intersects_data_window() {
        let input = make_offset_image([0.0, 1.0, 0.0, 1.0]);

        let node = Crop::new();
        let mut params = HashMap::new();
        params.insert("x".to_string(), ParamValue::Int(102));
        params.insert("y".to_string(), ParamValue::Int(101));
        params.insert("width".to_string(), ParamValue::Int(10));
        params.insert("height".to_string(), ParamValue::Int(10));
        params.insert("clip_to_source".to_string(), ParamValue::Bool(true));

        let output = eval_image_node(&node, input.clone(), params);

        // With clip_to_source, output is intersection of crop rect with source data_window
        let expected_dw = RectI {
            min: IVec2::new(102, 101),
            max: IVec2::new(104, 104),
        };
        assert_eq!(output.data_window, expected_dw);
        assert_eq!(output.width, 2);
        assert_eq!(output.height, 3);
        assert_eq!(output.format, input.format);

        let px = output.get_rgba(102, 101);
        assert_color_approx(px, [0.0, 1.0, 0.0, 1.0], "pixel inside crop");
    }

    #[test]
    fn test_crop_clip_to_source_no_overlap_produces_empty() {
        let input = make_offset_image([1.0, 0.0, 0.0, 1.0]);

        let node = Crop::new();
        let mut params = HashMap::new();
        params.insert("x".to_string(), ParamValue::Int(200));
        params.insert("y".to_string(), ParamValue::Int(200));
        params.insert("width".to_string(), ParamValue::Int(10));
        params.insert("height".to_string(), ParamValue::Int(10));
        params.insert("clip_to_source".to_string(), ParamValue::Bool(true));

        let output = eval_image_node(&node, input, params);

        // With clip_to_source and no overlap, output is 1×1 transparent
        assert_eq!(output.width, 1);
        assert_eq!(output.height, 1);
        let px = output.get_rgba(200, 200);
        assert_color_approx(
            px,
            [0.0, 0.0, 0.0, 0.0],
            "non-overlapping crop is transparent",
        );
    }
    #[test]
    fn test_resize_produces_new_format() {
        let input = make_offset_image([0.5, 0.5, 0.5, 1.0]);

        let node = Resize::new();
        let mut params = HashMap::new();
        params.insert("width".to_string(), ParamValue::Int(8));
        params.insert("height".to_string(), ParamValue::Int(6));
        params.insert("filter".to_string(), ParamValue::Int(0));

        let output = eval_image_node(&node, input, params);

        assert_eq!(output.width, 8);
        assert_eq!(output.height, 6);
        let expected_format = Format::from_dimensions(8, 6);
        assert_eq!(output.format, expected_format);
        let expected_dw = RectI::from_dimensions(8, 6);
        assert_eq!(output.data_window, expected_dw);
    }

    #[test]
    fn test_resize_fit_within_preserves_wide_aspect_ratio() {
        let input = make_test_image(400, 200, [0.5, 0.5, 0.5, 1.0]);

        let node = Resize::new();
        let mut params = HashMap::new();
        params.insert("mode".to_string(), ParamValue::Int(1));
        params.insert("width".to_string(), ParamValue::Int(100));
        params.insert("height".to_string(), ParamValue::Int(100));
        params.insert("allow_upscale".to_string(), ParamValue::Bool(false));
        params.insert("filter".to_string(), ParamValue::Int(0));

        let output = eval_image_node(&node, input, params);

        assert_eq!(output.width, 100);
        assert_eq!(output.height, 50);
        assert_eq!(output.data_window, RectI::from_dimensions(100, 50));
    }

    #[test]
    fn test_resize_fit_within_preserves_tall_aspect_ratio() {
        let input = make_test_image(200, 400, [0.5, 0.5, 0.5, 1.0]);

        let node = Resize::new();
        let mut params = HashMap::new();
        params.insert("mode".to_string(), ParamValue::Int(1));
        params.insert("width".to_string(), ParamValue::Int(100));
        params.insert("height".to_string(), ParamValue::Int(100));
        params.insert("allow_upscale".to_string(), ParamValue::Bool(false));
        params.insert("filter".to_string(), ParamValue::Int(0));

        let output = eval_image_node(&node, input, params);

        assert_eq!(output.width, 50);
        assert_eq!(output.height, 100);
        assert_eq!(output.data_window, RectI::from_dimensions(50, 100));
    }

    #[test]
    fn test_resize_fit_within_does_not_upscale_by_default() {
        let input = make_test_image(40, 20, [0.5, 0.5, 0.5, 1.0]);

        let node = Resize::new();
        let mut params = HashMap::new();
        params.insert("mode".to_string(), ParamValue::Int(1));
        params.insert("width".to_string(), ParamValue::Int(100));
        params.insert("height".to_string(), ParamValue::Int(100));
        params.insert("allow_upscale".to_string(), ParamValue::Bool(false));
        params.insert("filter".to_string(), ParamValue::Int(0));

        let output = eval_image_node(&node, input, params);

        assert_eq!(output.width, 40);
        assert_eq!(output.height, 20);
        assert_eq!(output.data_window, RectI::from_dimensions(40, 20));
    }

    #[test]
    fn test_resize_fit_within_can_upscale() {
        let input = make_test_image(40, 20, [0.5, 0.5, 0.5, 1.0]);

        let node = Resize::new();
        let mut params = HashMap::new();
        params.insert("mode".to_string(), ParamValue::Int(1));
        params.insert("width".to_string(), ParamValue::Int(100));
        params.insert("height".to_string(), ParamValue::Int(100));
        params.insert("allow_upscale".to_string(), ParamValue::Bool(true));
        params.insert("filter".to_string(), ParamValue::Int(0));

        let output = eval_image_node(&node, input, params);

        assert_eq!(output.width, 100);
        assert_eq!(output.height, 50);
        assert_eq!(output.data_window, RectI::from_dimensions(100, 50));
    }

    #[test]
    fn test_flip_preserves_format_and_data_window() {
        let input = make_offset_image([1.0, 0.0, 1.0, 1.0]);

        let node = Flip::new();
        let mut params = HashMap::new();
        params.insert("horizontal".to_string(), ParamValue::Bool(true));
        params.insert("vertical".to_string(), ParamValue::Bool(false));

        let output = eval_image_node(&node, input.clone(), params);

        assert_eq!(output.format, input.format);
        assert_eq!(output.data_window, input.data_window);
        assert_eq!(output.width, input.width);
        assert_eq!(output.height, input.height);
    }

    // ── Channel node tests ───────────────────────────────────────────────

    #[test]
    fn test_separate_rgba_roundtrip() {
        let input = Image::from_f32_data(
            2,
            2,
            vec![
                0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.0, 0.1, 1.0, 0.0, 1.0, 0.0, 0.5,
            ],
        )
        .unwrap();
        let sep = SeparateRgba::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(input.clone()));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &HashMap::new(),
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(sep.evaluate(&ctx)).unwrap();
        let red = match result.get("red").unwrap() {
            Value::Image(img) => img.clone(),
            _ => panic!("expected image"),
        };
        let green = match result.get("green").unwrap() {
            Value::Image(img) => img.clone(),
            _ => panic!("expected image"),
        };
        let blue = match result.get("blue").unwrap() {
            Value::Image(img) => img.clone(),
            _ => panic!("expected image"),
        };
        let alpha = match result.get("alpha").unwrap() {
            Value::Image(img) => img.clone(),
            _ => panic!("expected image"),
        };
        // Each channel output should be grayscale with the channel value
        assert!(approx_eq(red.get_pixel_f32(0, 0)[0], 0.1), "red ch pixel 0");
        assert!(
            approx_eq(green.get_pixel_f32(0, 0)[0], 0.2),
            "green ch pixel 0"
        );
        assert!(
            approx_eq(blue.get_pixel_f32(0, 0)[0], 0.3),
            "blue ch pixel 0"
        );
        assert!(
            approx_eq(alpha.get_pixel_f32(0, 0)[0], 0.4),
            "alpha ch pixel 0"
        );
        assert!(approx_eq(red.get_pixel_f32(1, 0)[0], 0.5), "red ch pixel 1");
        // All channel outputs should have alpha = 1.0
        assert!(
            approx_eq(red.get_pixel_f32(0, 0)[3], 1.0),
            "red output alpha"
        );
        // Format should propagate
        assert_eq!(red.format, input.format);
        assert_eq!(red.data_window, input.data_window);
    }

    #[test]
    fn test_separate_combine_rgba_roundtrip() {
        // Separate then Combine should reconstruct the original channels
        let input = Image::from_f32_data(
            2,
            2,
            vec![
                0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.0, 0.1, 1.0, 0.0, 1.0, 0.0, 0.5,
            ],
        )
        .unwrap();
        // Step 1: Separate
        let sep = SeparateRgba::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(input.clone()));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &HashMap::new(),
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let sep_result = block_on(sep.evaluate(&ctx)).unwrap();
        let red = sep_result.get("red").unwrap().clone();
        let green = sep_result.get("green").unwrap().clone();
        let blue = sep_result.get("blue").unwrap().clone();
        let alpha = sep_result.get("alpha").unwrap().clone();
        // Step 2: Combine
        let comb = CombineRgba::new();
        let mut comb_inputs = HashMap::new();
        comb_inputs.insert("red".to_string(), red);
        comb_inputs.insert("green".to_string(), green);
        comb_inputs.insert("blue".to_string(), blue);
        comb_inputs.insert("alpha".to_string(), alpha);
        let ctx2 = EvalContext {
            inputs: comb_inputs,
            extra_inputs: HashMap::new(),
            params: &HashMap::new(),
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let comb_result = block_on(comb.evaluate(&ctx2)).unwrap();
        let output = match comb_result.get("image").unwrap() {
            Value::Image(img) => img.clone(),
            _ => panic!("expected image"),
        };
        // Should match original pixel values
        for y in 0..2u32 {
            for x in 0..2u32 {
                let orig = input.get_pixel_f32(x, y);
                let out = output.get_pixel_f32(x, y);
                for c in 0..4 {
                    assert!(
                        (orig[c] - out[c]).abs() < 0.01,
                        "pixel ({},{}) channel {}: orig={}, got={}",
                        x,
                        y,
                        c,
                        orig[c],
                        out[c]
                    );
                }
            }
        }
    }

    /// Naive direct-convolution Gaussian blur as a reference implementation.
    /// Slow (O(w*h*r^2)) but obviously correct. Works in premultiplied space
    /// to handle alpha edges properly, then converts back to straight alpha.
    fn reference_gaussian_blur(img: &Image, sigma: f32) -> Image {
        let w = img.width as usize;
        let h = img.height as usize;
        let radius = (sigma * 3.0).ceil() as i32;
        let mut kernel = Vec::new();
        let mut sum = 0.0f64;
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                let d2 = (dx * dx + dy * dy) as f64;
                let g = (-d2 / (2.0 * sigma as f64 * sigma as f64)).exp();
                kernel.push((dx, dy, g));
                sum += g;
            }
        }
        for entry in kernel.iter_mut() {
            entry.2 /= sum;
        }

        let src = &img.data;
        let mut out = vec![0.0f32; w * h * 4];

        for y in 0..h {
            for x in 0..w {
                let mut acc_r = 0.0f64;
                let mut acc_g = 0.0f64;
                let mut acc_b = 0.0f64;
                let mut acc_a = 0.0f64;

                for &(dx, dy, weight) in &kernel {
                    let sx = (x as i32 + dx).clamp(0, w as i32 - 1) as usize;
                    let sy = (y as i32 + dy).clamp(0, h as i32 - 1) as usize;
                    let idx = (sy * w + sx) * 4;
                    let a = src[idx + 3] as f64;
                    acc_r += src[idx] as f64 * a * weight;
                    acc_g += src[idx + 1] as f64 * a * weight;
                    acc_b += src[idx + 2] as f64 * a * weight;
                    acc_a += a * weight;
                }

                let oi = (y * w + x) * 4;
                if acc_a > 1e-10 {
                    out[oi] = (acc_r / acc_a) as f32;
                    out[oi + 1] = (acc_g / acc_a) as f32;
                    out[oi + 2] = (acc_b / acc_a) as f32;
                } else {
                    out[oi] = 0.0;
                    out[oi + 1] = 0.0;
                    out[oi + 2] = 0.0;
                }
                out[oi + 3] = acc_a as f32;
            }
        }

        Image::from_f32_data(img.width, img.height, out).unwrap()
    }

    #[test]
    fn test_gaussian_blur_vs_reference() {
        let w = 64u32;
        let h = 64u32;
        let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];

        // Left half: opaque white. Right half: transparent black.
        for y in 0..h as usize {
            for x in 0..w as usize {
                let i = (y * w as usize + x) * 4;
                if x < 32 {
                    data[i] = 1.0;
                    data[i + 1] = 1.0;
                    data[i + 2] = 1.0;
                    data[i + 3] = 1.0;
                }
            }
        }

        let input = Image::from_f32_data(w, h, data).unwrap();

        for sigma in [0.5f64, 1.0, 1.5, 2.0, 3.0, 5.0, 7.0, 10.0] {
            let node = GaussianBlur::new();
            let mut params = HashMap::new();
            params.insert("sigma".to_string(), ParamValue::Float(sigma));
            let actual = eval_image_node(&node, input.clone(), params);
            let expected = reference_gaussian_blur(&input, sigma as f32);

            let mut max_rgb_diff: f32 = 0.0;
            let mut max_a_diff: f32 = 0.0;
            let mut worst_pixel = (0, 0);

            for y in 0..h as usize {
                for x in 0..w as usize {
                    let ai = (y * w as usize + x) * 4;
                    let a = &actual.data;
                    let e = &expected.data;

                    // Only compare RGB where alpha is significant — at near-zero
                    // alpha, RGB values are invisible and unpremultiply amplifies
                    // noise.
                    let alpha = a[ai + 3].max(e[ai + 3]);
                    if alpha > 0.05 {
                        for c in 0..3 {
                            let diff = (a[ai + c] - e[ai + c]).abs();
                            if diff > max_rgb_diff {
                                max_rgb_diff = diff;
                                worst_pixel = (x, y);
                            }
                        }
                    }
                    let ad = (a[ai + 3] - e[ai + 3]).abs();
                    if ad > max_a_diff {
                        max_a_diff = ad;
                    }
                }
            }

            // RGB should match very closely — the premultiply sandwich
            // ensures correct color blending regardless of approximation method.
            assert!(
                max_rgb_diff < 0.01,
                "sigma={}: RGB diff too large: {:.4} at pixel ({},{}) \
                 actual=[{:.3},{:.3},{:.3},{:.3}] expected=[{:.3},{:.3},{:.3},{:.3}]",
                sigma,
                max_rgb_diff,
                worst_pixel.0,
                worst_pixel.1,
                actual.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4],
                actual.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4 + 1],
                actual.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4 + 2],
                actual.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4 + 3],
                expected.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4],
                expected.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4 + 1],
                expected.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4 + 2],
                expected.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4 + 3],
            );

            // Alpha tolerance is generous because 3-pass box blur is an
            // approximation of a true Gaussian — divergence up to ~0.27 is
            // expected at very small sigma where the box radius is tiny.
            assert!(
                max_a_diff < 0.30,
                "sigma={sigma}: Alpha diff too large: {max_a_diff:.4}",
            );
        }
    }

    #[test]
    fn test_gaussian_blur_no_dark_halo() {
        let w = 16u32;
        let h = 16u32;
        let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];

        // Left half: opaque white. Right half: transparent black.
        for y in 0..h as usize {
            for x in 0..w as usize {
                let i = (y * w as usize + x) * 4;
                if x < 8 {
                    data[i] = 1.0;
                    data[i + 1] = 1.0;
                    data[i + 2] = 1.0;
                    data[i + 3] = 1.0;
                }
            }
        }

        let input = Image::from_f32_data(w, h, data).unwrap();
        let node = GaussianBlur::new();
        let mut params = HashMap::new();
        params.insert("sigma".to_string(), ParamValue::Float(3.0));
        let output = eval_image_node(&node, input, params);

        // Check pixels near the alpha edge (x=7..9, middle row).
        // With correct blurring, any pixel with partial alpha should
        // have RGB close to white (1.0), not darkened by transparent
        // black bleeding in.
        let y = 8;
        for x in 5..11 {
            let px = output.get_rgba(x, y);
            if px[3] > 0.01 {
                assert!(
                    px[0] > 0.8 && px[1] > 0.8 && px[2] > 0.8,
                    "Dark halo at ({},{}): rgba=[{:.3},{:.3},{:.3},{:.3}] — \
                     RGB should be close to 1.0 for pixels with alpha > 0",
                    x,
                    y,
                    px[0],
                    px[1],
                    px[2],
                    px[3]
                );
            }
        }
    }

    #[test]
    fn test_text_renders() {
        let node = Text::new();
        let mut params = HashMap::new();
        params.insert("text".to_string(), ParamValue::String("Hi".to_string()));
        params.insert("font_size".to_string(), ParamValue::Float(48.0));
        params.insert("color".to_string(), ParamValue::Color([1.0, 1.0, 1.0, 1.0]));
        params.insert("width".to_string(), ParamValue::Int(128));
        params.insert("height".to_string(), ParamValue::Int(64));
        params.insert("align".to_string(), ParamValue::Int(1));
        let inputs = HashMap::new();
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();
        let img = match result.get("image").unwrap() {
            Value::Image(img) => img,
            _ => panic!("Expected Image output"),
        };
        assert_eq!(img.width, 128);
        assert_eq!(img.height, 64);
        let has_content = img.data.iter().any(|&v| v > 0.0);
        assert!(has_content, "Text node should render visible pixels");
    }

    #[test]
    fn test_dot_passthrough() {
        let input = Image::from_f32_data(
            2,
            2,
            vec![
                1.0, 0.5, 0.25, 1.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.5, 0.5, 0.5, 0.1, 0.2, 0.3, 0.4,
            ],
        )
        .unwrap();
        let node = Dot::new();
        let output = eval_image_node(&node, input.clone(), HashMap::new());
        assert_eq!(output.data, input.data);
    }

    // ── EdgeBlur tests ───────────────────────────────────────────────────

    #[test]
    fn test_edge_blur_no_edges() {
        // Fully opaque image with no alpha edges → should be unchanged
        let input = make_test_image(4, 4, [0.5, 0.3, 0.7, 1.0]);
        let node = EdgeBlur::new();
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Float(3.0));
        params.insert("edge_threshold".to_string(), ParamValue::Float(0.01));

        let output = eval_image_node(&node, input.clone(), params);
        // All alpha values are 1.0 → no edges → output ≈ input
        for i in 0..16 {
            let idx = i * 4;
            for c in 0..4 {
                assert!(
                    (output.data[idx + c] - input.data[idx + c]).abs() < 0.02,
                    "pixel {} channel {} should be unchanged: {} vs {}",
                    i,
                    c,
                    output.data[idx + c],
                    input.data[idx + c]
                );
            }
        }
    }

    #[test]
    fn test_edge_blur_with_edge() {
        // Create image with sharp alpha edge: left half opaque, right half transparent
        let w = 8u32;
        let h = 4u32;
        let mut data = vec![0.0f32; (w * h) as usize * 4];
        for y in 0..h as usize {
            for x in 0..w as usize {
                let idx = (y * w as usize + x) * 4;
                if x < 4 {
                    data[idx] = 1.0;
                    data[idx + 1] = 1.0;
                    data[idx + 2] = 1.0;
                    data[idx + 3] = 1.0;
                }
                // right half stays 0,0,0,0
            }
        }
        let input = Image::from_f32_data(w, h, data).unwrap();
        let node = EdgeBlur::new();
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Float(2.0));
        params.insert("edge_threshold".to_string(), ParamValue::Float(0.01));

        let output = eval_image_node(&node, input.clone(), params);

        // Interior pixels (x=0) should be nearly unchanged
        let interior = output.get_pixel_f32(0, 2);
        assert!(
            interior[3] > 0.9,
            "Interior alpha should stay high: {}",
            interior[3]
        );

        // The edge pixel (x=3, adjacent to transparent) should be blurred
        let edge = output.get_pixel_f32(3, 2);
        let orig_edge = input.get_pixel_f32(3, 2);
        // Edge region should show some blur effect (alpha slightly reduced)
        // or at minimum, the node should run without error
        assert!(
            edge[3] <= orig_edge[3] + 0.01,
            "Edge alpha should not increase beyond original"
        );
    }

    // ── MatteExpand tests ────────────────────────────────────────────────

    #[test]
    fn test_matte_expand_grows_alpha() {
        // Single opaque pixel in center of 3x3, rest transparent
        let mut data = vec![0.0f32; 9 * 4];
        // Center pixel (1,1) = opaque white
        let center = (3 + 1) * 4;
        data[center] = 1.0;
        data[center + 1] = 1.0;
        data[center + 2] = 1.0;
        data[center + 3] = 1.0;

        let input = Image::from_f32_data(3, 3, data).unwrap();
        let node = MatteExpand::new();
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(1));

        let output = eval_image_node(&node, input, params);

        // Center should still be opaque
        let c = output.get_pixel_f32(1, 1);
        assert!(approx_eq(c[3], 1.0), "center alpha: {}", c[3]);

        // Neighbors should now also be opaque (dilated by 1)
        let top = output.get_pixel_f32(1, 0);
        let bot = output.get_pixel_f32(1, 2);
        let left = output.get_pixel_f32(0, 1);
        let right = output.get_pixel_f32(2, 1);
        assert!(approx_eq(top[3], 1.0), "top alpha after expand: {}", top[3]);
        assert!(approx_eq(bot[3], 1.0), "bot alpha after expand: {}", bot[3]);
        assert!(
            approx_eq(left[3], 1.0),
            "left alpha after expand: {}",
            left[3]
        );
        assert!(
            approx_eq(right[3], 1.0),
            "right alpha after expand: {}",
            right[3]
        );
    }

    #[test]
    fn test_matte_expand_preserves_rgb() {
        let data = vec![1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0];
        let input = Image::from_f32_data(2, 1, data).unwrap();
        let node = MatteExpand::new();
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(1));

        let output = eval_image_node(&node, input, params);
        let px0 = output.get_pixel_f32(0, 0);
        // RGB preserved, alpha expanded
        assert!(approx_eq(px0[0], 1.0), "R preserved: {}", px0[0]);
        assert!(approx_eq(px0[1], 0.0), "G preserved: {}", px0[1]);
        assert!(approx_eq(px0[2], 0.0), "B preserved: {}", px0[2]);
        assert!(approx_eq(px0[3], 1.0), "A expanded: {}", px0[3]);
    }

    // ── MatteShrink tests ────────────────────────────────────────────────

    #[test]
    fn test_matte_shrink_erodes_alpha() {
        // 3x3 fully opaque, shrink by 1 → only center should remain
        let data = vec![1.0f32; 9 * 4]; // all pixels [1,1,1,1]
        let input = Image::from_f32_data(3, 3, data).unwrap();
        let node = MatteShrink::new();
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(1));

        let output = eval_image_node(&node, input, params);

        let c = output.get_pixel_f32(1, 1);
        assert!(approx_eq(c[3], 1.0), "center alpha: {}", c[3]);
    }

    #[test]
    fn test_matte_shrink_erodes_edge() {
        // 3x3 where edge is opaque but one corner is transparent
        let mut data = vec![1.0f32; 9 * 4];
        // Make top-left corner transparent
        data[0] = 1.0;
        data[1] = 1.0;
        data[2] = 1.0;
        data[3] = 0.0;

        let input = Image::from_f32_data(3, 3, data).unwrap();
        let node = MatteShrink::new();
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(1));

        let output = eval_image_node(&node, input, params);

        let px01 = output.get_pixel_f32(0, 1);
        assert!(
            approx_eq(px01[3], 0.0),
            "neighbor of transparent should erode: {}",
            px01[3]
        );

        let px10 = output.get_pixel_f32(1, 0);
        assert!(
            approx_eq(px10[3], 0.0),
            "neighbor of transparent should erode: {}",
            px10[3]
        );

        // Separable H→V min propagation: (0,0)=0 → H pass zeros row 0 → V pass zeros (1,1)
        let px11 = output.get_pixel_f32(1, 1);
        assert!(
            approx_eq(px11[3], 0.0),
            "center should erode due to separable pass: {}",
            px11[3]
        );
    }

    #[test]
    fn test_matte_shrink_preserves_rgb() {
        let data = vec![0.8, 0.3, 0.5, 1.0, 0.2, 0.7, 0.1, 0.0];
        let input = Image::from_f32_data(2, 1, data).unwrap();
        let node = MatteShrink::new();
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(1));

        let output = eval_image_node(&node, input, params);
        // RGB should always be preserved
        let px0 = output.get_pixel_f32(0, 0);
        assert!(approx_eq(px0[0], 0.8), "R preserved: {}", px0[0]);
        assert!(approx_eq(px0[1], 0.3), "G preserved: {}", px0[1]);
        assert!(approx_eq(px0[2], 0.5), "B preserved: {}", px0[2]);
        // Alpha should be eroded (neighbor has alpha=0.0)
        assert!(approx_eq(px0[3], 0.0), "A eroded: {}", px0[3]);
    }

    #[test]
    fn test_directional_blur_zero_length_identity() {
        let input = Image::from_f32_data(4, 4, vec![[0.5f32, 0.3, 0.7, 1.0]; 16].concat()).unwrap();
        let node = DirectionalBlur::new();
        let mut params = HashMap::new();
        params.insert("length".to_string(), ParamValue::Float(0.0));
        params.insert("angle".to_string(), ParamValue::Float(0.0));

        let output = eval_image_node(&node, input.clone(), params);
        for y in 0..4u32 {
            for x in 0..4u32 {
                let orig = input.get_pixel_f32(x, y);
                let out = output.get_pixel_f32(x, y);
                for c in 0..4 {
                    assert!(
                        approx_eq(orig[c], out[c]),
                        "zero-length directional blur should be identity at ({},{}) ch {}: {} vs {}",
                        x, y, c, orig[c], out[c]
                    );
                }
            }
        }
    }

    #[test]
    fn test_directional_blur_horizontal() {
        let w = 64u32;
        let h = 1u32;
        let mut data = vec![0.0f32; (w as usize) * 4];
        let mid = (w / 2) as usize;
        data[mid * 4] = 1.0;
        data[mid * 4 + 1] = 1.0;
        data[mid * 4 + 2] = 1.0;
        data[mid * 4 + 3] = 1.0;

        let input = Image::from_f32_data(w, h, data).unwrap();
        let node = DirectionalBlur::new();
        let mut params = HashMap::new();
        params.insert("length".to_string(), ParamValue::Float(6.0));
        params.insert("angle".to_string(), ParamValue::Float(0.0));

        let output = eval_image_node(&node, input, params);

        let center = output.get_pixel_f32(mid as u32, 0);
        assert!(center[0] > 0.0, "center should have some brightness");

        let spread_left = output.get_pixel_f32((mid - 2) as u32, 0);
        let spread_right = output.get_pixel_f32((mid + 2) as u32, 0);
        assert!(
            spread_left[0] > 0.0 && spread_right[0] > 0.0,
            "blur should spread horizontally: left={}, right={}",
            spread_left[0],
            spread_right[0]
        );

        let far_edge = output.get_pixel_f32(0, 0);
        assert!(
            far_edge[0] < center[0],
            "far edge should be less bright than center: far={}, center={}",
            far_edge[0],
            center[0]
        );
    }

    #[test]
    fn test_directional_blur_format_propagation() {
        let input = make_offset_image([0.5, 0.5, 0.5, 1.0]);
        let node = DirectionalBlur::new();
        let mut params = HashMap::new();
        params.insert("length".to_string(), ParamValue::Float(5.0));
        params.insert("angle".to_string(), ParamValue::Float(45.0));

        let output = eval_image_node(&node, input.clone(), params);
        assert_eq!(output.format, input.format);
        assert_eq!(output.data_window, input.data_window);
        assert_eq!(output.color_space, input.color_space);
    }

    #[test]
    fn test_directional_blur_no_dark_halo() {
        let w = 16u32;
        let h = 16u32;
        let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];
        for y in 0..h as usize {
            for x in 0..w as usize {
                let i = (y * w as usize + x) * 4;
                if x < 8 {
                    data[i] = 1.0;
                    data[i + 1] = 1.0;
                    data[i + 2] = 1.0;
                    data[i + 3] = 1.0;
                }
            }
        }
        let input = Image::from_f32_data(w, h, data).unwrap();
        let node = DirectionalBlur::new();
        let mut params = HashMap::new();
        params.insert("length".to_string(), ParamValue::Float(8.0));
        params.insert("angle".to_string(), ParamValue::Float(0.0));

        let output = eval_image_node(&node, input, params);

        let y = 8;
        for x in 5..11 {
            let px = output.get_rgba(x, y);
            if px[3] > 0.01 {
                assert!(
                    px[0] > 0.8 && px[1] > 0.8 && px[2] > 0.8,
                    "Dark halo at ({},{}): rgba=[{:.3},{:.3},{:.3},{:.3}]",
                    x,
                    y,
                    px[0],
                    px[1],
                    px[2],
                    px[3]
                );
            }
        }
    }

    #[test]
    fn test_radial_blur_zero_strength_identity() {
        let input = Image::from_f32_data(4, 4, vec![[0.5f32, 0.3, 0.7, 1.0]; 16].concat()).unwrap();
        let node = RadialBlur::new();
        let mut params = HashMap::new();
        params.insert("strength".to_string(), ParamValue::Float(0.0));
        params.insert("center_x".to_string(), ParamValue::Float(0.5));
        params.insert("center_y".to_string(), ParamValue::Float(0.5));

        let output = eval_image_node(&node, input.clone(), params);
        for y in 0..4u32 {
            for x in 0..4u32 {
                let orig = input.get_pixel_f32(x, y);
                let out = output.get_pixel_f32(x, y);
                for c in 0..4 {
                    assert!(
                        approx_eq(orig[c], out[c]),
                        "zero-strength radial blur should be identity at ({},{}) ch {}: {} vs {}",
                        x,
                        y,
                        c,
                        orig[c],
                        out[c]
                    );
                }
            }
        }
    }

    #[test]
    fn test_radial_blur_spreads_from_center() {
        let w = 32u32;
        let h = 32u32;
        let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];
        // Create a ring of bright pixels away from center — radial blur
        // samples inward toward center, so outer pixels will pick up
        // brightness from this ring.
        for y in 0..h as usize {
            for x in 0..w as usize {
                let dx = x as f32 - 15.5;
                let dy = y as f32 - 15.5;
                let dist = (dx * dx + dy * dy).sqrt();
                if dist > 6.0 && dist < 10.0 {
                    let i = (y * w as usize + x) * 4;
                    data[i] = 1.0;
                    data[i + 1] = 1.0;
                    data[i + 2] = 1.0;
                    data[i + 3] = 1.0;
                }
            }
        }
        let input = Image::from_f32_data(w, h, data).unwrap();
        let node = RadialBlur::new();
        let mut params = HashMap::new();
        params.insert("strength".to_string(), ParamValue::Float(0.5));
        params.insert("center_x".to_string(), ParamValue::Float(0.5));
        params.insert("center_y".to_string(), ParamValue::Float(0.5));

        let output = eval_image_node(&node, input.clone(), params);

        // Pixels outside the ring should pick up brightness from inward samples
        let outer = output.get_pixel_f32(28, 16);
        let orig_outer = input.get_pixel_f32(28, 16);
        assert!(
            outer[0] > orig_outer[0],
            "outer pixel should gain brightness from radial sampling: {} vs original {}",
            outer[0],
            orig_outer[0]
        );
    }

    #[test]
    fn test_radial_blur_format_propagation() {
        let input = make_offset_image([0.5, 0.5, 0.5, 1.0]);
        let node = RadialBlur::new();
        let mut params = HashMap::new();
        params.insert("strength".to_string(), ParamValue::Float(0.3));
        params.insert("center_x".to_string(), ParamValue::Float(0.5));
        params.insert("center_y".to_string(), ParamValue::Float(0.5));

        let output = eval_image_node(&node, input.clone(), params);
        assert_eq!(output.format, input.format);
        assert_eq!(output.data_window, input.data_window);
        assert_eq!(output.color_space, input.color_space);
    }

    #[test]
    fn test_radial_blur_no_dark_halo() {
        let w = 16u32;
        let h = 16u32;
        let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];
        for y in 0..h as usize {
            for x in 0..w as usize {
                let i = (y * w as usize + x) * 4;
                if x < 8 {
                    data[i] = 1.0;
                    data[i + 1] = 1.0;
                    data[i + 2] = 1.0;
                    data[i + 3] = 1.0;
                }
            }
        }
        let input = Image::from_f32_data(w, h, data).unwrap();
        let node = RadialBlur::new();
        let mut params = HashMap::new();
        params.insert("strength".to_string(), ParamValue::Float(0.5));
        params.insert("center_x".to_string(), ParamValue::Float(0.25));
        params.insert("center_y".to_string(), ParamValue::Float(0.5));

        let output = eval_image_node(&node, input, params);

        let y = 8;
        for x in 5..11 {
            let px = output.get_rgba(x, y);
            if px[3] > 0.01 {
                assert!(
                    px[0] > 0.8 && px[1] > 0.8 && px[2] > 0.8,
                    "Dark halo at ({},{}): rgba=[{:.3},{:.3},{:.3},{:.3}]",
                    x,
                    y,
                    px[0],
                    px[1],
                    px[2],
                    px[3]
                );
            }
        }
    }

    #[test]
    fn test_corner_pin_identity() {
        let input = make_test_image(4, 4, [0.5, 0.3, 0.7, 1.0]);
        let node = CornerPin::new();
        let mut params = HashMap::new();
        params.insert("tl_x".to_string(), ParamValue::Float(0.0));
        params.insert("tl_y".to_string(), ParamValue::Float(0.0));
        params.insert("tr_x".to_string(), ParamValue::Float(1.0));
        params.insert("tr_y".to_string(), ParamValue::Float(0.0));
        params.insert("br_x".to_string(), ParamValue::Float(1.0));
        params.insert("br_y".to_string(), ParamValue::Float(1.0));
        params.insert("bl_x".to_string(), ParamValue::Float(0.0));
        params.insert("bl_y".to_string(), ParamValue::Float(1.0));
        params.insert("filter".to_string(), ParamValue::Int(1));

        let output = eval_image_node(&node, input.clone(), params);

        assert_eq!(output.width, input.width);
        assert_eq!(output.height, input.height);
        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(px, [0.5, 0.3, 0.7, 1.0], "corner_pin identity");
    }

    #[test]
    fn test_corner_pin_output_size_matches_input() {
        let input = make_test_image(8, 6, [1.0, 0.0, 0.0, 1.0]);
        let node = CornerPin::new();
        let mut params = HashMap::new();
        params.insert("tl_x".to_string(), ParamValue::Float(0.1));
        params.insert("tl_y".to_string(), ParamValue::Float(0.1));
        params.insert("tr_x".to_string(), ParamValue::Float(0.9));
        params.insert("tr_y".to_string(), ParamValue::Float(0.05));
        params.insert("br_x".to_string(), ParamValue::Float(0.95));
        params.insert("br_y".to_string(), ParamValue::Float(0.95));
        params.insert("bl_x".to_string(), ParamValue::Float(0.05));
        params.insert("bl_y".to_string(), ParamValue::Float(0.9));
        params.insert("filter".to_string(), ParamValue::Int(1));

        let output = eval_image_node(&node, input.clone(), params);

        assert_eq!(output.width, input.width, "output width must match input");
        assert_eq!(
            output.height, input.height,
            "output height must match input"
        );
        assert_eq!(
            output.data_window, input.data_window,
            "data_window must match input"
        );
    }

    #[test]
    fn test_corner_pin_warps_pixels() {
        let mut data = vec![0.0f32; 4 * 4 * 4];
        for pixel in data.chunks_exact_mut(4) {
            pixel.copy_from_slice(&[1.0, 1.0, 1.0, 1.0]);
        }
        let input = Image::from_f32_data(4, 4, data).unwrap();
        let node = CornerPin::new();
        let mut params = HashMap::new();
        params.insert("tl_x".to_string(), ParamValue::Float(0.25));
        params.insert("tl_y".to_string(), ParamValue::Float(0.25));
        params.insert("tr_x".to_string(), ParamValue::Float(0.75));
        params.insert("tr_y".to_string(), ParamValue::Float(0.25));
        params.insert("br_x".to_string(), ParamValue::Float(0.75));
        params.insert("br_y".to_string(), ParamValue::Float(0.75));
        params.insert("bl_x".to_string(), ParamValue::Float(0.25));
        params.insert("bl_y".to_string(), ParamValue::Float(0.75));
        params.insert("filter".to_string(), ParamValue::Int(0));

        let output = eval_image_node(&node, input, params);

        let center = output.get_pixel_f32(2, 2);
        assert!(center[3] > 0.0, "center should have content after warp");

        let corner = output.get_pixel_f32(0, 0);
        assert!(
            corner[3] < 0.01,
            "corner should be transparent after inward warp: alpha={}",
            corner[3]
        );
    }

    #[test]
    fn test_stmap_identity_uv() {
        let input = make_test_image(4, 4, [0.8, 0.2, 0.4, 1.0]);
        let mut uv_data = vec![0.0f32; 4 * 4 * 4];
        for y in 0..4u32 {
            for x in 0..4u32 {
                let idx = (y * 4 + x) as usize * 4;
                uv_data[idx] = x as f32 / 3.0;
                uv_data[idx + 1] = y as f32 / 3.0;
                uv_data[idx + 2] = 0.0;
                uv_data[idx + 3] = 1.0;
            }
        }
        let uv_map = Image::from_f32_data(4, 4, uv_data).unwrap();

        let node = STMap::new();
        let mut params = HashMap::new();
        params.insert("filter".to_string(), ParamValue::Int(1));
        let output = eval_two_input_node(&node, "image", input, "uv", uv_map, params);

        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(px, [0.8, 0.2, 0.4, 1.0], "stmap identity uv (0,0)");
        let px2 = output.get_pixel_f32(3, 3);
        assert_color_approx(px2, [0.8, 0.2, 0.4, 1.0], "stmap identity uv (3,3)");
    }

    #[test]
    fn test_stmap_output_size_matches_uv() {
        let input = make_test_image(8, 8, [1.0, 0.0, 0.0, 1.0]);
        let uv_map = make_test_image(4, 6, [0.5, 0.5, 0.0, 1.0]);

        let node = STMap::new();
        let mut params = HashMap::new();
        params.insert("filter".to_string(), ParamValue::Int(1));
        let output = eval_two_input_node(&node, "image", input, "uv", uv_map, params);

        assert_eq!(output.width, 4, "output width should match uv map");
        assert_eq!(output.height, 6, "output height should match uv map");
    }

    #[test]
    fn test_stmap_out_of_bounds_uv() {
        let input = make_test_image(4, 4, [1.0, 0.5, 0.0, 1.0]);
        let uv_map = Image::from_f32_data(1, 1, vec![2.0, 2.0, 0.0, 1.0]).unwrap();

        let node = STMap::new();
        let mut params = HashMap::new();
        params.insert("filter".to_string(), ParamValue::Int(0));
        let output = eval_two_input_node(&node, "image", input, "uv", uv_map, params);

        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(px, [0.0, 0.0, 0.0, 0.0], "out of bounds uv should be black");
    }

    #[test]
    fn test_uv_map_corners() {
        let node = UVMap::new();
        let mut params = HashMap::new();
        params.insert("width".to_string(), ParamValue::Int(4));
        params.insert("height".to_string(), ParamValue::Int(4));

        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs: HashMap::new(),
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();
        let img = match result.get("image").unwrap() {
            Value::Image(img) => img.clone(),
            _ => panic!("expected image"),
        };

        assert_eq!(img.width, 4);
        assert_eq!(img.height, 4);

        let tl = img.get_pixel_f32(0, 0);
        assert_color_approx(tl, [0.0, 0.0, 0.0, 1.0], "uv top-left");

        let tr = img.get_pixel_f32(3, 0);
        assert_color_approx(tr, [1.0, 0.0, 0.0, 1.0], "uv top-right");

        let bl = img.get_pixel_f32(0, 3);
        assert_color_approx(bl, [0.0, 1.0, 0.0, 1.0], "uv bottom-left");

        let br = img.get_pixel_f32(3, 3);
        assert_color_approx(br, [1.0, 1.0, 0.0, 1.0], "uv bottom-right");
    }

    #[test]
    fn test_uv_map_feeds_stmap_identity() {
        let input = make_test_image(4, 4, [0.8, 0.2, 0.4, 1.0]);

        let uv_node = UVMap::new();
        let mut uv_params = HashMap::new();
        uv_params.insert("width".to_string(), ParamValue::Int(4));
        uv_params.insert("height".to_string(), ParamValue::Int(4));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs: HashMap::new(),
            extra_inputs: HashMap::new(),
            params: &uv_params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let uv_result = block_on(uv_node.evaluate(&ctx)).unwrap();
        let uv_img = match uv_result.get("image").unwrap() {
            Value::Image(img) => img.clone(),
            _ => panic!("expected image"),
        };

        let st_node = STMap::new();
        let mut st_params = HashMap::new();
        st_params.insert("filter".to_string(), ParamValue::Int(1));
        let output = eval_two_input_node(&st_node, "image", input.clone(), "uv", uv_img, st_params);

        for y in 0..4u32 {
            for x in 0..4u32 {
                let orig = input.get_pixel_f32(x, y);
                let out = output.get_pixel_f32(x, y);
                for c in 0..4 {
                    assert!(
                        (orig[c] - out[c]).abs() < 0.01,
                        "pixel ({},{}) ch {}: orig={}, got={}",
                        x,
                        y,
                        c,
                        orig[c],
                        out[c]
                    );
                }
            }
        }
    }

    fn eval_no_input_node(
        node: &dyn Node,
        params: HashMap<String, ParamValue>,
    ) -> HashMap<String, Value> {
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs: HashMap::new(),
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 42 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        block_on(node.evaluate(&ctx)).unwrap()
    }

    #[test]
    fn test_project_info_outputs() {
        let node = ProjectInfo::new();
        let result = eval_no_input_node(&node, HashMap::new());

        let w = match result.get("width").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };
        let h = match result.get("height").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };
        let pa = match result.get("pixel_aspect").unwrap() {
            Value::Float(v) => *v,
            other => panic!("expected Float, got {:?}", other.value_type()),
        };
        let frame = match result.get("frame").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };

        assert_eq!(w, 1920, "project width");
        assert_eq!(h, 1080, "project height");
        assert!(approx_eq(pa, 1.0), "pixel aspect: {pa}");
        assert_eq!(frame, 42, "frame number");
    }

    #[test]
    fn test_image_info_outputs() {
        let input = make_offset_image([0.5, 0.5, 0.5, 1.0]);
        let node = ImageInfo::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(input.clone()));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &HashMap::new(),
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();

        let w = match result.get("width").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };
        let h = match result.get("height").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };
        let aspect = match result.get("aspect_ratio").unwrap() {
            Value::Float(v) => *v,
            other => panic!("expected Float, got {:?}", other.value_type()),
        };
        let px_count = match result.get("pixel_count").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };
        let dw_x = match result.get("dw_x").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };
        let dw_y = match result.get("dw_y").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };

        assert_eq!(w, 4, "image width");
        assert_eq!(h, 4, "image height");
        assert!(approx_eq(aspect, 1.0), "aspect ratio: {aspect}");
        assert_eq!(px_count, 16, "pixel count");
        assert_eq!(dw_x, 100, "data window x offset");
        assert_eq!(dw_y, 100, "data window y offset");
    }

    // ── Preview-scale helpers ────────────────────────────────────────────────

    /// Evaluate a node with a single image input at the given preview scale.
    fn eval_image_node_scaled(
        node: &dyn Node,
        input: Image,
        params: HashMap<String, ParamValue>,
        preview_scale: f32,
    ) -> Image {
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(input));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();
        match result.get("image").unwrap() {
            Value::Image(img) => img.clone(),
            other => panic!("expected Value::Image, got {:?}", other.value_type()),
        }
    }

    /// Horizontal gradient image: R = G = B = x / (w-1), A = 1.0.
    fn make_gradient_image(w: u32, h: u32) -> Image {
        let data: Vec<f32> = (0..h)
            .flat_map(|_y| {
                (0..w).flat_map(|x| {
                    let v = x as f32 / (w as f32 - 1.0).max(1.0);
                    [v, v, v, 1.0f32]
                })
            })
            .collect();
        Image::from_f32_data(w, h, data).unwrap()
    }

    /// Max absolute pixel difference between two same-size images.
    fn max_pixel_diff(a: &Image, b: &Image) -> f32 {
        assert_eq!(a.width, b.width);
        assert_eq!(a.height, b.height);
        a.data
            .iter()
            .zip(b.data.iter())
            .map(|(x, y)| (x - y).abs())
            .fold(0.0f32, f32::max)
    }

    // ── GaussianBlur preview-scale tests ────────────────────────────────────

    #[test]
    fn test_gaussian_blur_uniform_unchanged_at_preview_scale() {
        let node = GaussianBlur::new();
        let img = make_test_image(100, 100, [0.4, 0.6, 0.2, 1.0]);
        let mut params = HashMap::new();
        params.insert("sigma".to_string(), ParamValue::Float(15.0));
        let result = eval_image_node_scaled(&node, img, params, 0.5);
        let center = &result.data[((50 * 100 + 50) * 4)..((50 * 100 + 50) * 4 + 4)];
        assert!(
            approx_eq(center[0], 0.4) && approx_eq(center[1], 0.6) && approx_eq(center[2], 0.2),
            "blur of uniform image should be unchanged, got {:?}",
            center
        );
    }

    #[test]
    fn test_gaussian_blur_zero_sigma_passthrough_at_preview_scale() {
        let node = GaussianBlur::new();
        let img = make_gradient_image(50, 50);
        let mut params = HashMap::new();
        params.insert("sigma".to_string(), ParamValue::Float(0.0));

        let result_full = eval_image_node_scaled(&node, img.clone(), params.clone(), 1.0);
        let result_preview = eval_image_node_scaled(&node, img.clone(), params, 0.5);
        assert_eq!(
            max_pixel_diff(&result_full, &img),
            0.0,
            "zero sigma full-res should be identity"
        );
        assert_eq!(
            max_pixel_diff(&result_preview, &img),
            0.0,
            "zero sigma preview should be identity"
        );
    }

    #[test]
    fn test_gaussian_blur_preview_scale_matches_fullres() {
        // blur(full) downscaled ≈ downscale(full) then blur at half sigma
        let node = GaussianBlur::new();
        let full_img = make_gradient_image(200, 100);
        let mut params = HashMap::new();
        params.insert("sigma".to_string(), ParamValue::Float(20.0));

        let full_blurred = eval_image_node_scaled(&node, full_img.clone(), params.clone(), 1.0);
        let full_blurred_downscaled =
            crate::transform::resize_nearest(&full_blurred, 100, 50).unwrap();

        let preview_img = crate::transform::resize_nearest(&full_img, 100, 50).unwrap();
        let preview_blurred = eval_image_node_scaled(&node, preview_img, params, 0.5);

        let diff = max_pixel_diff(&full_blurred_downscaled, &preview_blurred);
        assert!(
            diff < 0.07,
            "preview blur should approximate full-res blur (diff={diff:.4})"
        );
    }

    // ── Dilate/Erode/Median radius-scaling tests ─────────────────────────────

    #[test]
    fn test_dilate_radius_scales_with_preview() {
        // Single white pixel at center; Dilate with radius=4 at full-res should expand more
        // than Dilate with radius=4 at 0.5x scale (which uses radius=2 internally).
        let node = Dilate::new();
        let size = 100u32;
        let cx = (size / 2) as usize;
        let cy = (size / 2) as usize;
        let mut data = vec![0.0f32; (size * size * 4) as usize];
        let idx = (cy * size as usize + cx) * 4;
        data[idx] = 1.0;
        data[idx + 1] = 1.0;
        data[idx + 2] = 1.0;
        data[idx + 3] = 1.0;
        let img = Image::from_f32_data(size, size, data).unwrap();

        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(4));

        let full = eval_image_node_scaled(&node, img.clone(), params.clone(), 1.0);
        let preview = eval_image_node_scaled(&node, img, params, 0.5);

        // At distance 3 from center: full-res (radius=4) should be white, preview (radius=2) black
        let check_pixel = |result: &Image, dx: i32, dy: i32| -> bool {
            let x = (cx as i32 + dx) as usize;
            let y = (cy as i32 + dy) as usize;
            let idx = (y * size as usize + x) * 4;
            result.data[idx] > 0.5
        };
        assert!(
            check_pixel(&full, 3, 0),
            "full-res dilate radius=4 should reach 3px away"
        );
        assert!(
            !check_pixel(&preview, 3, 0),
            "preview dilate scaled radius=2 should not reach 3px"
        );
    }

    #[test]
    fn test_erode_radius_scales_with_preview() {
        // White 10x10 center on a black 30x30 background. Erode shrinks the white region
        // inward: radius=4 shrinks by 4px each side, radius=2 (preview 0.5x) by 2px.
        // Pixel (13,13) is 3px inside the white region boundary (which starts at x=10).
        // After erode radius=4: shrinks to (14,14)..(15,15) -> pixel (13,13) is black.
        // After erode radius=2: shrinks to (12,12)..(17,17) -> pixel (13,13) is white.
        let node = Erode::new();
        let size = 30u32;
        let mut data = vec![0.0f32; (size * size * 4) as usize];
        for y in 10u32..20 {
            for x in 10u32..20 {
                let idx = ((y * size + x) * 4) as usize;
                data[idx] = 1.0;
                data[idx + 1] = 1.0;
                data[idx + 2] = 1.0;
                data[idx + 3] = 1.0;
            }
        }
        let img = Image::from_f32_data(size, size, data).unwrap();

        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(4));

        let full = eval_image_node_scaled(&node, img.clone(), params.clone(), 1.0);
        let preview = eval_image_node_scaled(&node, img, params, 0.5);

        let px_full = full.data[(13 * size as usize + 13) * 4];
        let px_preview = preview.data[(13 * size as usize + 13) * 4];
        assert!(
            px_full < 0.5,
            "full-res erode radius=4 should erode 3px from edge"
        );
        assert!(
            px_preview > 0.5,
            "preview erode radius=2 should not reach 3px from edge"
        );
    }

    #[test]
    fn test_median_radius_scales_with_preview() {
        // Median on a uniform image should be unchanged at any scale.
        let node = Median::new();
        let img = make_test_image(40, 40, [0.5, 0.3, 0.7, 1.0]);
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(3));

        let result_full = eval_image_node_scaled(&node, img.clone(), params.clone(), 1.0);
        let result_preview = eval_image_node_scaled(&node, img.clone(), params, 0.5);

        assert!(
            approx_eq(result_full.data[0], 0.5),
            "median full uniform unchanged"
        );
        assert!(
            approx_eq(result_preview.data[0], 0.5),
            "median preview uniform unchanged"
        );
    }

    // ── Directional blur ─────────────────────────────────────────────────────

    #[test]
    fn test_directional_blur_preview_scale_matches_fullres() {
        let node = DirectionalBlur::new();
        let full_img = make_gradient_image(200, 100);
        let mut params = HashMap::new();
        params.insert("length".to_string(), ParamValue::Float(30.0));
        params.insert("angle".to_string(), ParamValue::Float(0.0));

        let full_blurred = eval_image_node_scaled(&node, full_img.clone(), params.clone(), 1.0);
        let full_blurred_downscaled =
            crate::transform::resize_nearest(&full_blurred, 100, 50).unwrap();

        let preview_img = crate::transform::resize_nearest(&full_img, 100, 50).unwrap();
        let preview_blurred = eval_image_node_scaled(&node, preview_img, params, 0.5);

        let diff = max_pixel_diff(&full_blurred_downscaled, &preview_blurred);
        assert!(
            diff < 0.1,
            "preview directional blur should approximate full-res (diff={diff:.4})"
        );
    }

    // ── Sharpen ──────────────────────────────────────────────────────────────

    #[test]
    fn test_sharpen_uniform_unchanged_at_preview_scale() {
        let node = Sharpen::new();
        let img = make_test_image(60, 60, [0.5, 0.5, 0.5, 1.0]);
        let mut params = HashMap::new();
        params.insert("amount".to_string(), ParamValue::Float(1.0));
        params.insert("radius".to_string(), ParamValue::Float(5.0));
        let result = eval_image_node_scaled(&node, img, params, 0.5);
        assert!(
            approx_eq(result.data[0], 0.5),
            "sharpen of uniform should be unchanged"
        );
    }

    // ── Glow ────────────────────────────────────────────────────────────────

    #[test]
    fn test_glow_below_threshold_passthrough() {
        // Dark image below threshold should pass through unchanged at any preview scale.
        let node = Glow::new();
        let img = make_test_image(40, 40, [0.1, 0.1, 0.1, 1.0]);
        let mut params = HashMap::new();
        params.insert("threshold".to_string(), ParamValue::Float(0.8));
        params.insert("radius".to_string(), ParamValue::Float(20.0));
        params.insert("intensity".to_string(), ParamValue::Float(1.0));

        let result_full = eval_image_node_scaled(&node, img.clone(), params.clone(), 1.0);
        let result_preview = eval_image_node_scaled(&node, img, params, 0.5);

        assert!(
            approx_eq(result_full.data[0], 0.1),
            "glow below threshold full"
        );
        assert!(
            approx_eq(result_preview.data[0], 0.1),
            "glow below threshold preview"
        );
    }
}
