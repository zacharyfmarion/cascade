use crate::manifest::{KernelManifest, ManifestParam, ManifestPort};

pub fn builtin_gpu_rotate_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::rotate".to_string(),
        display_name: "Rotate".to_string(),
        category: "Transform".to_string(),
        description: "Rotate image by resampling within the same buffer".to_string(),
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
                key: "angle".to_string(),
                label: "Angle".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-360.0),
                max: Some(360.0),
                step: Some(0.1),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "filter".to_string(),
                label: "Filter".to_string(),
                ty: "Int".to_string(),
                default: serde_json::json!(1),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(1.0),
                ui: Some("Dropdown".to_string()),
                options: vec!["Nearest".to_string(), "Bilinear".to_string()],
            },
        ],
        kernel: r#"
    ivec2 img_size = imageSize(u_input);
    vec2 center = (vec2(img_size) - vec2(1.0)) * 0.5;
    float rad = radians(angle);
    float cos_a = cos(rad);
    float sin_a = sin(rad);

    vec2 d = vec2(pixel) - center;
    vec2 src = vec2(d.x * cos_a + d.y * sin_a, -d.x * sin_a + d.y * cos_a) + center;

    if (filter == 0) {
        ivec2 nearest = ivec2(round(src));
        nearest = clamp(nearest, ivec2(0), img_size - 1);
        return imageLoad(u_input, nearest);
    }

    // Bilinear sampling helper
    vec2 f = fract(src);
    ivec2 p = ivec2(floor(src));
    ivec2 p00 = clamp(p, ivec2(0), img_size - 1);
    ivec2 p10 = clamp(p + ivec2(1, 0), ivec2(0), img_size - 1);
    ivec2 p01 = clamp(p + ivec2(0, 1), ivec2(0), img_size - 1);
    ivec2 p11 = clamp(p + ivec2(1, 1), ivec2(0), img_size - 1);
    vec4 c00 = imageLoad(u_input, p00);
    vec4 c10 = imageLoad(u_input, p10);
    vec4 c01 = imageLoad(u_input, p01);
    vec4 c11 = imageLoad(u_input, p11);
    vec4 result = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
    return result;
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_gpu_transform_2d_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::transform_2d".to_string(),
        display_name: "Transform 2D".to_string(),
        category: "Transform".to_string(),
        description: "Translate, rotate, and scale within the same buffer".to_string(),
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
                key: "translate_x".to_string(),
                label: "Translate X".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1000.0),
                max: Some(1000.0),
                step: Some(1.0),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "translate_y".to_string(),
                label: "Translate Y".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1000.0),
                max: Some(1000.0),
                step: Some(1.0),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "rotate".to_string(),
                label: "Rotate".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-360.0),
                max: Some(360.0),
                step: Some(0.1),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "scale_x".to_string(),
                label: "Scale X".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.01),
                max: Some(10.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "scale_y".to_string(),
                label: "Scale Y".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.01),
                max: Some(10.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "filter".to_string(),
                label: "Filter".to_string(),
                ty: "Int".to_string(),
                default: serde_json::json!(1),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(1.0),
                ui: Some("Dropdown".to_string()),
                options: vec!["Nearest".to_string(), "Bilinear".to_string()],
            },
        ],
        kernel: r#"
    ivec2 img_size = imageSize(u_input);
    vec2 center = (vec2(img_size) - vec2(1.0)) * 0.5;

    float rad = radians(rotate);
    float cos_a = cos(rad);
    float sin_a = sin(rad);
    float inv_sx = 1.0 / max(scale_x, 0.0001);
    float inv_sy = 1.0 / max(scale_y, 0.0001);

    vec2 d = vec2(pixel) - center - vec2(translate_x, translate_y);
    vec2 rotated = vec2(d.x * cos_a + d.y * sin_a, -d.x * sin_a + d.y * cos_a);
    vec2 src = vec2(rotated.x * inv_sx, rotated.y * inv_sy) + center;

    if (filter == 0) {
        ivec2 nearest = ivec2(round(src));
        if (nearest.x < 0 || nearest.y < 0 || nearest.x >= img_size.x || nearest.y >= img_size.y) {
            return vec4(0.0);
        }
        return imageLoad(u_input, nearest);
    }

    // Bilinear sampling helper
    vec2 f = fract(src);
    ivec2 p = ivec2(floor(src));
    ivec2 p00 = p;
    ivec2 p10 = p + ivec2(1, 0);
    ivec2 p01 = p + ivec2(0, 1);
    ivec2 p11 = p + ivec2(1, 1);
    vec4 c00 = vec4(0.0);
    vec4 c10 = vec4(0.0);
    vec4 c01 = vec4(0.0);
    vec4 c11 = vec4(0.0);
    if (p00.x >= 0 && p00.y >= 0 && p00.x < img_size.x && p00.y < img_size.y) {
        c00 = imageLoad(u_input, p00);
    }
    if (p10.x >= 0 && p10.y >= 0 && p10.x < img_size.x && p10.y < img_size.y) {
        c10 = imageLoad(u_input, p10);
    }
    if (p01.x >= 0 && p01.y >= 0 && p01.x < img_size.x && p01.y < img_size.y) {
        c01 = imageLoad(u_input, p01);
    }
    if (p11.x >= 0 && p11.y >= 0 && p11.x < img_size.x && p11.y < img_size.y) {
        c11 = imageLoad(u_input, p11);
    }
    vec4 result = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
    return result;
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

    fn assert_manifest_transpiles(manifest: KernelManifest) {
        let glsl = manifest.build_glsl().expect("glsl build failed");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_rotate_manifest_transpiles() {
        assert_manifest_transpiles(builtin_gpu_rotate_manifest());
    }

    #[test]
    fn test_transform_2d_manifest_transpiles() {
        assert_manifest_transpiles(builtin_gpu_transform_2d_manifest());
    }
}
