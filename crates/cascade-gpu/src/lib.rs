pub mod blend_kernels;
pub mod color_kernels;
pub mod color_kernels_advanced;
pub mod context;
pub mod kernel_node;
pub mod kuwahara;
pub mod manifest;
pub mod matte_kernels;
pub mod template;
pub mod transform_kernels;
pub mod transpile;
pub mod utility_kernels;

use std::sync::Arc;

use cascade_core::node::NodeRegistry;

use crate::kernel_node::GpuKernelNode;
use crate::kuwahara::GpuKuwaharaNode;
use crate::manifest::builtin_pixelate_manifest;

use crate::blend_kernels::{
    builtin_alpha_over_manifest, builtin_blend_manifest, builtin_channel_shuffle_manifest,
    builtin_copy_channels_manifest, builtin_image_math_manifest, builtin_key_mix_manifest,
    builtin_merge_manifest,
};
use crate::color_kernels::{
    builtin_brightness_contrast_manifest, builtin_clamp_manifest, builtin_gamma_manifest,
    builtin_hue_saturation_manifest, builtin_invert_manifest, builtin_posterize_manifest,
    builtin_threshold_manifest, builtin_white_balance_manifest,
};
use crate::color_kernels_advanced::{
    builtin_color_balance_manifest, builtin_grade_manifest, builtin_gradient_map_manifest,
    builtin_levels_manifest, builtin_tone_map_manifest, builtin_vibrance_manifest,
};
use crate::matte_kernels::{
    builtin_chroma_key_manifest, builtin_despill_manifest, builtin_difference_matte_manifest,
    builtin_extract_channel_manifest, builtin_luminance_key_manifest, builtin_premultiply_manifest,
    builtin_set_alpha_manifest, builtin_unpremultiply_manifest,
};
use crate::transform_kernels::{builtin_gpu_rotate_manifest, builtin_gpu_transform_2d_manifest};
use crate::utility_kernels::{
    builtin_edge_detect_manifest, builtin_gpu_two_color_map_manifest,
    builtin_lens_distortion_manifest, builtin_map_range_manifest, builtin_vignette_manifest,
};

pub use crate::context::GpuContext;
pub use crate::manifest::{
    gpu_script_passthrough_manifest, KernelManifest, ManifestParam, ManifestPort,
};

fn register_kernel_node(
    registry: &mut NodeRegistry,
    context: &Arc<GpuContext>,
    manifest: KernelManifest,
) {
    let ctx = context.clone();
    let id = manifest.id.clone();
    registry.register(&id, move || {
        let m = manifest.clone();
        // SAFETY: manifest was validated by the caller before reaching this factory.
        // NodeRegistry::register requires infallible Fn() -> Arc<dyn Node>.
        Arc::new(
            GpuKernelNode::from_manifest(m, ctx.clone())
                .expect("GPU node factory: manifest was pre-validated"),
        )
    });
}

pub fn register_gpu_nodes(registry: &mut NodeRegistry, context: Arc<GpuContext>) {
    let ctx = context.clone();
    registry.register("gpu_kernel::pixelate", move || {
        let manifest = builtin_pixelate_manifest();
        // SAFETY: builtin manifest is known-valid at compile time.
        Arc::new(
            GpuKernelNode::from_manifest(manifest, ctx.clone())
                .expect("GPU node factory: builtin manifest"),
        )
    });

    let ctx = context.clone();
    registry.register("kuwahara", move || {
        Arc::new(GpuKuwaharaNode::new(ctx.clone()))
    });

    // --- Color kernels (simple) ---
    register_kernel_node(registry, &context, builtin_invert_manifest());
    register_kernel_node(registry, &context, builtin_brightness_contrast_manifest());
    register_kernel_node(registry, &context, builtin_hue_saturation_manifest());
    register_kernel_node(registry, &context, builtin_gamma_manifest());
    register_kernel_node(registry, &context, builtin_threshold_manifest());
    register_kernel_node(registry, &context, builtin_posterize_manifest());
    register_kernel_node(registry, &context, builtin_white_balance_manifest());
    register_kernel_node(registry, &context, builtin_clamp_manifest());

    // --- Color kernels (advanced) ---
    register_kernel_node(registry, &context, builtin_levels_manifest());
    register_kernel_node(registry, &context, builtin_vibrance_manifest());
    register_kernel_node(registry, &context, builtin_tone_map_manifest());
    register_kernel_node(registry, &context, builtin_grade_manifest());
    register_kernel_node(registry, &context, builtin_gradient_map_manifest());
    register_kernel_node(registry, &context, builtin_color_balance_manifest());

    // --- Matte kernels ---
    register_kernel_node(registry, &context, builtin_premultiply_manifest());
    register_kernel_node(registry, &context, builtin_unpremultiply_manifest());
    register_kernel_node(registry, &context, builtin_chroma_key_manifest());
    register_kernel_node(registry, &context, builtin_despill_manifest());
    register_kernel_node(registry, &context, builtin_luminance_key_manifest());
    register_kernel_node(registry, &context, builtin_difference_matte_manifest());
    register_kernel_node(registry, &context, builtin_set_alpha_manifest());
    register_kernel_node(registry, &context, builtin_extract_channel_manifest());

    // --- Blend/composite kernels ---
    register_kernel_node(registry, &context, builtin_blend_manifest());
    register_kernel_node(registry, &context, builtin_alpha_over_manifest());
    register_kernel_node(registry, &context, builtin_merge_manifest());
    register_kernel_node(registry, &context, builtin_key_mix_manifest());
    register_kernel_node(registry, &context, builtin_image_math_manifest());
    register_kernel_node(registry, &context, builtin_channel_shuffle_manifest());
    register_kernel_node(registry, &context, builtin_copy_channels_manifest());

    // --- Utility/filter kernels ---
    register_kernel_node(registry, &context, builtin_map_range_manifest());
    register_kernel_node(registry, &context, builtin_vignette_manifest());
    register_kernel_node(registry, &context, builtin_gpu_two_color_map_manifest());
    register_kernel_node(registry, &context, builtin_edge_detect_manifest());
    register_kernel_node(registry, &context, builtin_lens_distortion_manifest());

    // --- Transform kernels ---
    register_kernel_node(registry, &context, builtin_gpu_rotate_manifest());
    register_kernel_node(registry, &context, builtin_gpu_transform_2d_manifest());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::builtin_pixelate_manifest;
    use crate::transpile::glsl_to_wgsl;
    use cascade_core::node::{EvalContext, Node};
    use cascade_core::types::{
        Format, FrameTime, Image, ParamDefault, ParamValue, UiHint, Value, ValueType,
    };
    use std::collections::HashMap;

    fn make_column_test_image() -> Image {
        let mut data = Vec::new();
        let columns = [
            [1.0, 0.0, 0.0, 1.0],
            [0.0, 1.0, 0.0, 1.0],
            [0.0, 0.0, 1.0, 1.0],
            [1.0, 1.0, 1.0, 1.0],
        ];

        for _ in 0..4u32 {
            for color in columns {
                data.extend_from_slice(&color);
            }
        }

        Image::from_f32_data(4, 4, data).expect("column test image")
    }

    fn eval_transform_2d(translate_x: f64, translate_y: f64, filter: i64) -> Option<Image> {
        let ctx = match GpuContext::new() {
            Ok(ctx) => Arc::new(ctx),
            Err(e) => {
                println!("GPU not available, skipping: {e}");
                return None;
            }
        };

        let manifest = builtin_gpu_transform_2d_manifest();
        let node = kernel_node::GpuKernelNode::from_manifest(manifest, ctx)
            .expect("Should create Transform 2D node");

        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(make_column_test_image()));

        let mut params = HashMap::new();
        params.insert("translate_x".to_string(), ParamValue::Float(translate_x));
        params.insert("translate_y".to_string(), ParamValue::Float(translate_y));
        params.insert("rotate".to_string(), ParamValue::Float(0.0));
        params.insert("scale_x".to_string(), ParamValue::Float(1.0));
        params.insert("scale_y".to_string(), ParamValue::Float(1.0));
        params.insert("filter".to_string(), ParamValue::Int(filter));

        let cm = cascade_core::color::BuiltinColorManagement::new();
        let format = Format::from_dimensions(4, 4);
        let eval_ctx = EvalContext {
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

        let result =
            pollster::block_on(node.evaluate(&eval_ctx)).expect("Transform 2D evaluation failed");
        match result.get("image").expect("Transform 2D output") {
            Value::Image(image) => Some(image.clone()),
            other => panic!("Expected image output, got {:?}", other.value_type()),
        }
    }

    #[test]
    fn test_pixelate_glsl_builds() {
        let manifest = builtin_pixelate_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        assert!(glsl.contains("u_palette"));
        assert!(glsl.contains("has_palette"));
    }

    #[test]
    fn test_pixelate_transpile_to_wgsl() {
        let manifest = builtin_pixelate_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        let wgsl = glsl_to_wgsl(&glsl).expect("GLSL should transpile to WGSL");
        assert!(wgsl.contains("fn main"));
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_pixelate_node_spec() {
        let manifest = builtin_pixelate_manifest();
        let spec = manifest.to_node_spec().expect("Spec should build");
        assert_eq!(spec.id, "gpu_kernel::pixelate");
        assert_eq!(spec.inputs.len(), 2);
        assert_eq!(spec.outputs.len(), 1);
        assert_eq!(spec.params.len(), 4);
        assert_eq!(spec.params[0].key, "pixel_size");
    }

    #[test]
    fn test_manifest_scalar_inputs_expose_control_metadata() {
        let manifest = KernelManifest {
            id: "gpu_script::controls".to_string(),
            display_name: "GPU Script".to_string(),
            category: "GPU".to_string(),
            description: "test".to_string(),
            inputs: vec![
                manifest::ManifestPort {
                    name: "image".to_string(),
                    label: "Image".to_string(),
                    ty: "Image".to_string(),
                    optional: false,
                    ..Default::default()
                },
                manifest::ManifestPort {
                    name: "amount".to_string(),
                    label: "Amount".to_string(),
                    ty: "Float".to_string(),
                    default: Some(serde_json::Value::from(0.75)),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui: Some("Slider".to_string()),
                    ..Default::default()
                },
            ],
            outputs: vec![manifest::ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
                ..Default::default()
            }],
            params: vec![],
            kernel: "return color * amount;".to_string(),
            supports_mask: false,
            ..KernelManifest::default()
        };

        let spec = manifest.to_node_spec().expect("Spec should build");
        let image = spec
            .inputs
            .iter()
            .find(|input| input.name == "image")
            .unwrap();
        assert_eq!(image.ty, ValueType::Image);
        assert!(image.default.is_none());
        assert!(image.min.is_none());
        assert!(image.ui_hint.is_none());

        let amount = spec
            .inputs
            .iter()
            .find(|input| input.name == "amount")
            .unwrap();
        assert_eq!(amount.ty, ValueType::Float);
        assert!(matches!(amount.default, Some(ParamDefault::Float(value)) if value == 0.75));
        assert_eq!(amount.min, Some(0.0));
        assert_eq!(amount.max, Some(1.0));
        assert_eq!(amount.step, Some(0.01));
        assert!(matches!(amount.ui_hint, Some(UiHint::Slider)));
        assert!(spec.params.is_empty());
    }

    #[test]
    fn test_simple_kernel_transpile() {
        let manifest = KernelManifest {
            id: "invert_gpu".to_string(),
            display_name: "Invert GPU".to_string(),
            category: "GPU".to_string(),
            description: "Simple invert".to_string(),
            inputs: vec![manifest::ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
                ..Default::default()
            }],
            outputs: vec![manifest::ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
                ..Default::default()
            }],
            params: vec![manifest::ManifestParam {
                key: "strength".to_string(),
                label: "Strength".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            }],
            kernel: "return vec4(mix(color.rgb, vec3(1.0) - color.rgb, strength), color.a);"
                .to_string(),
            ..KernelManifest::default()
        };

        let glsl = manifest.build_glsl().expect("GLSL should build");
        let wgsl = glsl_to_wgsl(&glsl).expect("Should transpile to WGSL");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_gpu_context_init() {
        use cascade_core::node::Node;

        match GpuContext::new() {
            Ok(ctx) => {
                let manifest = KernelManifest {
                    id: "test_passthrough".to_string(),
                    display_name: "Test".to_string(),
                    category: "GPU".to_string(),
                    description: "test".to_string(),
                    inputs: vec![manifest::ManifestPort {
                        name: "image".to_string(),
                        label: "Image".to_string(),
                        ty: "Image".to_string(),
                        optional: false,
                        ..Default::default()
                    }],
                    outputs: vec![manifest::ManifestPort {
                        name: "image".to_string(),
                        label: "Image".to_string(),
                        ty: "Image".to_string(),
                        optional: false,
                        ..Default::default()
                    }],
                    params: vec![],
                    kernel: "return color;".to_string(),
                    ..KernelManifest::default()
                };

                let node = kernel_node::GpuKernelNode::from_manifest(manifest, Arc::new(ctx))
                    .expect("Should create GPU kernel node");
                let spec = node.spec();
                assert_eq!(spec.id, "test_passthrough");
            }
            Err(e) => {
                println!("GPU not available (expected in CI): {e}");
            }
        }
    }

    #[test]
    fn test_gpu_passthrough_execution() {
        let ctx = match GpuContext::new() {
            Ok(ctx) => Arc::new(ctx),
            Err(e) => {
                println!("GPU not available, skipping: {e}");
                return;
            }
        };

        let manifest = KernelManifest {
            id: "test_pass".to_string(),
            display_name: "Test".to_string(),
            category: "GPU".to_string(),
            description: "test".to_string(),
            inputs: vec![manifest::ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
                ..Default::default()
            }],
            outputs: vec![manifest::ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
                ..Default::default()
            }],
            params: vec![],
            kernel: "return color;".to_string(),
            ..KernelManifest::default()
        };

        let node =
            kernel_node::GpuKernelNode::from_manifest(manifest, ctx).expect("Should create node");

        let mut data = Vec::new();
        for y in 0..4u32 {
            for x in 0..4u32 {
                let r = (x as f32) / 3.0;
                let g = (y as f32) / 3.0;
                let b = 0.5f32;
                let a = 1.0f32;
                data.extend_from_slice(&[r, g, b, a]);
            }
        }
        let image = cascade_core::types::Image::from_f32_data(4, 4, data).unwrap();

        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image.clone()));
        let params = HashMap::new();

        let cm = cascade_core::color::BuiltinColorManagement::new();
        let format = Format::hd();
        let eval_ctx = EvalContext {
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

        let result = pollster::block_on(node.evaluate(&eval_ctx)).expect("Evaluate should succeed");
        let output = result.get("image").expect("Should have image output");
        match output {
            Value::Image(out_img) => {
                assert_eq!(out_img.width, 4);
                assert_eq!(out_img.height, 4);
                let px = out_img.get_pixel_f32(0, 0);
                assert!(
                    (px[2] - 0.5).abs() < 0.01,
                    "Blue should be ~0.5, got {}",
                    px[2]
                );
                assert!(
                    (px[3] - 1.0).abs() < 0.01,
                    "Alpha should be ~1.0, got {}",
                    px[3]
                );
                let px = out_img.get_pixel_f32(3, 3);
                assert!(
                    (px[0] - 1.0).abs() < 0.01,
                    "Red should be ~1.0, got {}",
                    px[0]
                );
                assert!(
                    (px[1] - 1.0).abs() < 0.01,
                    "Green should be ~1.0, got {}",
                    px[1]
                );
            }
            _ => panic!("Expected image output"),
        }
    }

    #[test]
    fn test_pixelate_kernel_e2e() {
        let ctx = match GpuContext::new() {
            Ok(ctx) => Arc::new(ctx),
            Err(e) => {
                println!("GPU not available, skipping: {e}");
                return;
            }
        };

        let manifest = builtin_pixelate_manifest();
        let node = kernel_node::GpuKernelNode::from_manifest(manifest, ctx)
            .expect("Should create pixelate node");

        let mut img_data = Vec::new();
        for y in 0..8u32 {
            for x in 0..8u32 {
                let r = (x as f32) / 7.0;
                let g = (y as f32) / 7.0;
                let b = 0.3f32;
                let a = 1.0f32;
                img_data.extend_from_slice(&[r, g, b, a]);
            }
        }
        let image = cascade_core::types::Image::from_f32_data(8, 8, img_data).unwrap();

        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("pixel_size".to_string(), ParamValue::Int(4));

        let cm = cascade_core::color::BuiltinColorManagement::new();
        let format = Format::hd();
        let eval_ctx = EvalContext {
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

        let result = pollster::block_on(node.evaluate(&eval_ctx)).expect("Pixelate should succeed");
        let output = result.get("image").expect("Should have image output");
        match output {
            Value::Image(out_img) => {
                assert_eq!(out_img.width, 8);
                assert_eq!(out_img.height, 8);
                let px = out_img.get_pixel_f32(0, 0);
                assert!(px[3] > 0.9, "Alpha should be preserved");
            }
            _ => panic!("Expected image output"),
        }
    }

    #[test]
    fn test_pixelate_with_optional_palette_missing() {
        let ctx = match GpuContext::new() {
            Ok(ctx) => Arc::new(ctx),
            Err(e) => {
                println!("GPU not available, skipping: {e}");
                return;
            }
        };

        let manifest = builtin_pixelate_manifest();
        let node = kernel_node::GpuKernelNode::from_manifest(manifest, ctx)
            .expect("Should create pixelate node");

        let mut img_data = Vec::new();
        for y in 0..8u32 {
            for x in 0..8u32 {
                let r = (x as f32) / 7.0;
                let g = (y as f32) / 7.0;
                let b = 0.3f32;
                let a = 1.0f32;
                img_data.extend_from_slice(&[r, g, b, a]);
            }
        }
        let image = cascade_core::types::Image::from_f32_data(8, 8, img_data).unwrap();

        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("pixel_size".to_string(), ParamValue::Int(2));

        let cm = cascade_core::color::BuiltinColorManagement::new();
        let format = Format::hd();
        let eval_ctx = EvalContext {
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

        let result = pollster::block_on(node.evaluate(&eval_ctx))
            .expect("Pixelate should succeed without palette");
        let output = result.get("image").expect("Should have image output");
        match output {
            Value::Image(out_img) => {
                assert_eq!(out_img.width, 8);
                assert_eq!(out_img.height, 8);
                let px00 = out_img.get_pixel_f32(0, 0);
                let px10 = out_img.get_pixel_f32(1, 0);
                assert!((px00[0] - px10[0]).abs() < 0.001, "Block should match");
                assert!((px00[1] - px10[1]).abs() < 0.001, "Block should match");
                assert!(px00[3] > 0.9, "Alpha should be preserved");
            }
            _ => panic!("Expected image output"),
        }
    }

    #[test]
    fn test_transform_2d_translate_left_exposes_transparent_right_edge() {
        let Some(out_img) = eval_transform_2d(-1.0, 0.0, 0) else {
            return;
        };

        assert_eq!(out_img.get_pixel_f32(0, 0), [0.0, 1.0, 0.0, 1.0]);
        assert_eq!(out_img.get_pixel_f32(1, 0), [0.0, 0.0, 1.0, 1.0]);
        assert_eq!(out_img.get_pixel_f32(2, 0), [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(out_img.get_pixel_f32(3, 0), [0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn test_transform_2d_translate_right_exposes_transparent_left_edge() {
        let Some(out_img) = eval_transform_2d(1.0, 0.0, 0) else {
            return;
        };

        assert_eq!(out_img.get_pixel_f32(0, 0), [0.0, 0.0, 0.0, 0.0]);
        assert_eq!(out_img.get_pixel_f32(1, 0), [1.0, 0.0, 0.0, 1.0]);
        assert_eq!(out_img.get_pixel_f32(2, 0), [0.0, 1.0, 0.0, 1.0]);
        assert_eq!(out_img.get_pixel_f32(3, 0), [0.0, 0.0, 1.0, 1.0]);
    }

    #[test]
    fn test_transform_2d_bilinear_translation_fades_into_transparent_edge() {
        let Some(out_img) = eval_transform_2d(-0.5, 0.0, 1) else {
            return;
        };
        let edge = out_img.get_pixel_f32(3, 0);

        assert!(
            (edge[0] - 0.5).abs() < 0.01,
            "expected half-strength white at edge, got red={}",
            edge[0]
        );
        assert!(
            (edge[1] - 0.5).abs() < 0.01,
            "expected half-strength white at edge, got green={}",
            edge[1]
        );
        assert!(
            (edge[2] - 0.5).abs() < 0.01,
            "expected half-strength white at edge, got blue={}",
            edge[2]
        );
        assert!(
            (edge[3] - 0.5).abs() < 0.01,
            "expected half alpha at edge, got alpha={}",
            edge[3]
        );
    }

    // ── Mask support tests ─────────────────────────────────────────

    fn simple_manifest(supports_mask: bool) -> KernelManifest {
        KernelManifest {
            id: "test_mask".to_string(),
            display_name: "Test".to_string(),
            category: "Color".to_string(),
            description: "test".to_string(),
            inputs: vec![manifest::ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
                ..Default::default()
            }],
            outputs: vec![manifest::ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
                ..Default::default()
            }],
            params: vec![],
            kernel: "return color;".to_string(),
            supports_mask,
            pixel_space_params: vec![],
        }
    }

    #[test]
    fn test_mask_support_adds_mask_input_port() {
        let manifest = simple_manifest(true);
        let spec = manifest.to_node_spec().unwrap();
        let mask_port = spec.inputs.iter().find(|p| p.name == "mask");
        assert!(
            mask_port.is_some(),
            "supports_mask=true should add mask input port"
        );
        let mask_port = mask_port.unwrap();
        assert_eq!(mask_port.ty, cascade_core::types::ValueType::Mask);
        assert_eq!(mask_port.label, "Mask");
    }

    #[test]
    fn test_mask_support_false_no_mask_port() {
        let manifest = simple_manifest(false);
        let spec = manifest.to_node_spec().unwrap();
        let mask_port = spec.inputs.iter().find(|p| p.name == "mask");
        assert!(
            mask_port.is_none(),
            "supports_mask=false should not add mask input port"
        );
    }

    #[test]
    fn test_mask_support_glsl_contains_mask_code() {
        let manifest = simple_manifest(true);
        let glsl = manifest.build_glsl().unwrap();
        assert!(
            glsl.contains("has_mask"),
            "GLSL should contain has_mask scalar"
        );
        assert!(
            glsl.contains("u_mask"),
            "GLSL should contain u_mask image binding"
        );
        assert!(
            glsl.contains("mix(color, result, mask_val)"),
            "GLSL should contain mask blend"
        );
    }

    #[test]
    fn test_mask_support_false_glsl_no_mask_code() {
        let manifest = simple_manifest(false);
        let glsl = manifest.build_glsl().unwrap();
        assert!(
            !glsl.contains("has_mask"),
            "GLSL should not contain has_mask"
        );
        assert!(!glsl.contains("u_mask"), "GLSL should not contain u_mask");
        assert!(
            !glsl.contains("mask_val"),
            "GLSL should not contain mask blend code"
        );
    }

    #[test]
    fn test_mask_support_default_is_true() {
        let manifest = KernelManifest::default();
        assert!(
            manifest.supports_mask,
            "Default supports_mask should be true"
        );
    }

    #[test]
    fn test_mask_support_serde_default_true() {
        // JSON without supports_mask field should default to true
        let json = r#"{
            "id": "test",
            "display_name": "Test",
            "category": "GPU",
            "description": "test",
            "inputs": [{"name": "image", "label": "Image", "ty": "Image"}],
            "outputs": [{"name": "image", "label": "Image", "ty": "Image"}],
            "params": [],
            "kernel": "return color;"
        }"#;
        let manifest: KernelManifest = serde_json::from_str(json).unwrap();
        assert!(
            manifest.supports_mask,
            "Missing supports_mask should default to true"
        );
    }

    #[test]
    fn test_mask_support_serde_explicit_false() {
        let json = r#"{
            "id": "test",
            "display_name": "Test",
            "category": "GPU",
            "description": "test",
            "inputs": [{"name": "image", "label": "Image", "ty": "Image"}],
            "outputs": [{"name": "image", "label": "Image", "ty": "Image"}],
            "params": [],
            "kernel": "return color;",
            "supports_mask": false
        }"#;
        let manifest: KernelManifest = serde_json::from_str(json).unwrap();
        assert!(
            !manifest.supports_mask,
            "Explicit supports_mask=false should be false"
        );
        let spec = manifest.to_node_spec().unwrap();
        assert!(
            spec.inputs.iter().all(|p| p.name != "mask"),
            "No mask port when false"
        );
    }

    #[test]
    fn test_mask_support_optional_inputs_include_mask() {
        let ctx = match GpuContext::new() {
            Ok(ctx) => Arc::new(ctx),
            Err(e) => {
                println!("GPU not available, skipping: {e}");
                return;
            }
        };
        use cascade_core::node::Node;
        let manifest = simple_manifest(true);
        let node = kernel_node::GpuKernelNode::from_manifest(manifest, ctx).unwrap();
        let spec = node.spec();
        // Mask should be in the inputs as optional
        let mask_port = spec.inputs.iter().find(|p| p.name == "mask");
        assert!(mask_port.is_some(), "Node spec should include mask port");
    }

    #[test]
    fn test_mask_support_false_optional_inputs_no_mask() {
        let ctx = match GpuContext::new() {
            Ok(ctx) => Arc::new(ctx),
            Err(e) => {
                println!("GPU not available, skipping: {e}");
                return;
            }
        };
        use cascade_core::node::Node;
        let manifest = simple_manifest(false);
        let node = kernel_node::GpuKernelNode::from_manifest(manifest, ctx).unwrap();
        let spec = node.spec();
        let mask_port = spec.inputs.iter().find(|p| p.name == "mask");
        assert!(mask_port.is_none(), "No mask port when supports_mask=false");
    }

    #[test]
    fn test_premultiply_no_mask_support() {
        // Premultiply is a node where masking doesn't make sense
        let manifest = matte_kernels::builtin_premultiply_manifest();
        assert!(
            !manifest.supports_mask,
            "Premultiply should have supports_mask=false"
        );
        let spec = manifest.to_node_spec().unwrap();
        assert!(
            spec.inputs.iter().all(|p| p.name != "mask"),
            "Premultiply should not have mask port"
        );
    }

    #[test]
    fn test_invert_has_mask_support() {
        // Invert is a typical node that should support masking
        let manifest = color_kernels::builtin_invert_manifest();
        assert!(
            manifest.supports_mask,
            "Invert should have supports_mask=true"
        );
        let spec = manifest.to_node_spec().unwrap();
        assert!(
            spec.inputs.iter().any(|p| p.name == "mask"),
            "Invert should have mask port"
        );
    }
}
