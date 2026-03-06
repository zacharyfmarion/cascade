use crate::manifest::{KernelManifest, ManifestParam, ManifestPort};

pub fn builtin_map_range_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::map_range".to_string(),
        display_name: "Map Range".to_string(),
        category: "Utility".to_string(),
        description: "Map values from one range to another".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        params: vec![
            ManifestParam {
                key: "from_min".to_string(),
                label: "From Min".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "from_max".to_string(),
                label: "From Max".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "to_min".to_string(),
                label: "To Min".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "to_max".to_string(),
                label: "To Max".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "do_clamp".to_string(),
                label: "Clamp".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(1.0),
                ui: Some("Checkbox".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    vec3 t = (color.rgb - vec3(from_min)) / (from_max - from_min);
    if (do_clamp != 0) {
        t = clamp(t, vec3(0.0), vec3(1.0));
    }
    vec3 result = vec3(to_min) + t * (to_max - to_min);
    return vec4(result, color.a);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_vignette_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::vignette".to_string(),
        display_name: "Vignette".to_string(),
        category: "Filter".to_string(),
        description: "Apply vignette effect".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        params: vec![
            ManifestParam {
                key: "intensity".to_string(),
                label: "Intensity".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.5),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "radius".to_string(),
                label: "Radius".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(1.0),
                min: Some(0.0),
                max: Some(2.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "softness".to_string(),
                label: "Softness".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.5),
                min: Some(0.01),
                max: Some(2.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    float amount = clamp(intensity, 0.0, 1.0);
    float soft = clamp(softness, 0.01, 2.0);
    float rad = clamp(radius, 0.0, 2.0);
    vec2 delta = (uv - vec2(0.5)) * 2.0;
    float dist = length(delta);
    float falloff = smoothstep(rad, rad + soft, dist);
    float factor = 1.0 - amount * falloff;
    return vec4(color.rgb * factor, color.a);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_gpu_two_color_map_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::two_color_map".to_string(),
        display_name: "Two Color Map".to_string(),
        category: "Color".to_string(),
        description: "Map luminance through a two-point color map".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        params: vec![
            ManifestParam {
                key: "low_r".to_string(),
                label: "Low R".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "low_g".to_string(),
                label: "Low G".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "low_b".to_string(),
                label: "Low B".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "high_r".to_string(),
                label: "High R".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "high_g".to_string(),
                label: "High G".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "high_b".to_string(),
                label: "High B".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    float l = luminance(color);
    vec3 low = vec3(low_r, low_g, low_b);
    vec3 high = vec3(high_r, high_g, high_b);
    vec3 result = mix(low, high, l);
    return vec4(result, color.a);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_edge_detect_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::edge_detect".to_string(),
        display_name: "Edge Detect".to_string(),
        category: "Filter".to_string(),
        description: "Detect edges using Sobel convolution".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        params: vec![ManifestParam {
            key: "strength".to_string(),
            label: "Strength".to_string(),
            ty: "Float".to_string(),
            default: serde_json::Value::from(1.0),
            min: Some(0.0),
            max: Some(10.0),
            step: Some(0.01),
            ui: Some("Slider".to_string()),
            options: vec![],
        }],
        kernel: r#"
    ivec2 dims = imageSize(u_input);
    ivec2 max_coord = dims - 1;
    float l00 = luminance(imageLoad(u_input, clamp(pixel + ivec2(-1, -1), ivec2(0), max_coord)));
    float l10 = luminance(imageLoad(u_input, clamp(pixel + ivec2(0, -1), ivec2(0), max_coord)));
    float l20 = luminance(imageLoad(u_input, clamp(pixel + ivec2(1, -1), ivec2(0), max_coord)));
    float l01 = luminance(imageLoad(u_input, clamp(pixel + ivec2(-1, 0), ivec2(0), max_coord)));
    float l21 = luminance(imageLoad(u_input, clamp(pixel + ivec2(1, 0), ivec2(0), max_coord)));
    float l02 = luminance(imageLoad(u_input, clamp(pixel + ivec2(-1, 1), ivec2(0), max_coord)));
    float l12 = luminance(imageLoad(u_input, clamp(pixel + ivec2(0, 1), ivec2(0), max_coord)));
    float l22 = luminance(imageLoad(u_input, clamp(pixel + ivec2(1, 1), ivec2(0), max_coord)));
    float gx = (-1.0 * l00 + 1.0 * l20) + (-2.0 * l01 + 2.0 * l21) + (-1.0 * l02 + 1.0 * l22);
    float gy = (-1.0 * l00 - 2.0 * l10 - 1.0 * l20) + (1.0 * l02 + 2.0 * l12 + 1.0 * l22);
    float mag = sqrt(gx * gx + gy * gy) * strength;
    return vec4(vec3(mag), 1.0);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_lens_distortion_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::lens_distortion".to_string(),
        display_name: "Lens Distortion".to_string(),
        category: "Filter".to_string(),
        description: "Apply barrel or pincushion lens distortion".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        params: vec![
            ManifestParam {
                key: "distortion".to_string(),
                label: "Distortion".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "dispersion".to_string(),
                label: "Dispersion".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "scale".to_string(),
                label: "Scale".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(1.0),
                min: Some(0.5),
                max: Some(2.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    ivec2 dims = imageSize(u_input);
    vec2 center = (vec2(dims) - 1.0) * 0.5;
    vec2 delta = vec2(pixel) - center;
    vec2 scaled_delta = delta / scale;
    float max_r = length(center);
    float r = max_r > 0.0 ? length(scaled_delta) / max_r : 0.0;
    float r2 = r * r;
    float base = 1.0 + distortion * r2;
    float ca = dispersion * 0.02;
    float factor_r = base * (1.0 + ca);
    float factor_g = base;
    float factor_b = base * (1.0 - ca);
    ivec2 max_coord = dims - 1;

    vec2 src_r = center + scaled_delta * factor_r;
    vec2 src_g = center + scaled_delta * factor_g;
    vec2 src_b = center + scaled_delta * factor_b;

    ivec2 coord_r = clamp(ivec2(round(src_r)), ivec2(0), max_coord);
    ivec2 coord_g = clamp(ivec2(round(src_g)), ivec2(0), max_coord);
    ivec2 coord_b = clamp(ivec2(round(src_b)), ivec2(0), max_coord);

    float out_r = imageLoad(u_input, coord_r).r;
    float out_g = imageLoad(u_input, coord_g).g;
    float out_b = imageLoad(u_input, coord_b).b;
    float out_a = imageLoad(u_input, coord_g).a;
    return vec4(out_r, out_g, out_b, out_a);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transpile::glsl_to_wgsl;

    #[test]
    fn test_map_range_manifest_glsl() {
        let manifest = builtin_map_range_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("process"));
        assert!(glsl.contains("from_min"));
        let wgsl = glsl_to_wgsl(&glsl).expect("GLSL should transpile");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_vignette_manifest_glsl() {
        let manifest = builtin_vignette_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("smoothstep"));
        assert!(glsl.contains("intensity"));
        let wgsl = glsl_to_wgsl(&glsl).expect("GLSL should transpile");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_two_color_map_manifest_glsl() {
        let manifest = builtin_gpu_two_color_map_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("low_r"));
        assert!(glsl.contains("high_b"));
        let wgsl = glsl_to_wgsl(&glsl).expect("GLSL should transpile");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_edge_detect_manifest_glsl() {
        let manifest = builtin_edge_detect_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("l00"));
        assert!(glsl.contains("strength"));
        let wgsl = glsl_to_wgsl(&glsl).expect("GLSL should transpile");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_lens_distortion_manifest_glsl() {
        let manifest = builtin_lens_distortion_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("distortion"));
        assert!(glsl.contains("dispersion"));
        let wgsl = glsl_to_wgsl(&glsl).expect("GLSL should transpile");
        assert!(!wgsl.is_empty());
    }
}
