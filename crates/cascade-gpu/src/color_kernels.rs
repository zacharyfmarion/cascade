use crate::manifest::{KernelManifest, ManifestParam, ManifestPort};

pub fn builtin_invert_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::invert".to_string(),
        display_name: "Invert".to_string(),
        category: "Color".to_string(),
        description: "Invert colors".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
            ..Default::default()
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
            ..Default::default()
        }],
        params: vec![],
        kernel: r#"
    return vec4(1.0 - color.r, 1.0 - color.g, 1.0 - color.b, color.a);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_brightness_contrast_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::brightness_contrast".to_string(),
        display_name: "Brightness / Contrast".to_string(),
        category: "Color".to_string(),
        description: "Adjust brightness and contrast".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
            ..Default::default()
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
            ..Default::default()
        }],
        params: vec![
            ManifestParam {
                key: "brightness".to_string(),
                label: "Brightness".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "contrast".to_string(),
                label: "Contrast".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    float b = brightness;
    float c = 1.0 + contrast;
    vec3 v = (color.rgb - 0.5) * c + 0.5 + b;
    return vec4(clamp(v, 0.0, 1.0), color.a);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_hue_saturation_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::hue_saturation".to_string(),
        display_name: "Hue / Saturation / Lightness".to_string(),
        category: "Color".to_string(),
        description: "Adjust hue, saturation, and lightness".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
            ..Default::default()
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
            ..Default::default()
        }],
        params: vec![
            ManifestParam {
                key: "hue".to_string(),
                label: "Hue".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "saturation".to_string(),
                label: "Saturation".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "lightness".to_string(),
                label: "Lightness".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    float r = color.r;
    float g = color.g;
    float b = color.b;

    float maxc = max(r, max(g, b));
    float minc = min(r, min(g, b));
    float l = (maxc + minc) * 0.5;
    float delta = maxc - minc;

    float h = 0.0;
    float s = 0.0;
    if (delta != 0.0) {
        s = delta / (1.0 - abs(2.0 * l - 1.0));
        if (maxc == r) {
            h = mod((g - b) / delta, 6.0);
        } else if (maxc == g) {
            h = ((b - r) / delta) + 2.0;
        } else {
            h = ((r - g) / delta) + 4.0;
        }
        h *= 60.0;
        if (h < 0.0) {
            h += 360.0;
        }
    }

    float hue_shift = hue * 180.0;
    h = mod(h + hue_shift, 360.0);
    if (h < 0.0) {
        h += 360.0;
    }
    s = clamp(s * (1.0 + saturation), 0.0, 1.0);
    float l_adj = clamp(l + lightness, 0.0, 1.0);

    if (s == 0.0) {
        return vec4(l_adj, l_adj, l_adj, color.a);
    }

    float c = (1.0 - abs(2.0 * l_adj - 1.0)) * s;
    float h_prime = h / 60.0;
    float x = c * (1.0 - abs(mod(h_prime, 2.0) - 1.0));
    vec3 rgb1;
    if (h_prime >= 0.0 && h_prime < 1.0) {
        rgb1 = vec3(c, x, 0.0);
    } else if (h_prime >= 1.0 && h_prime < 2.0) {
        rgb1 = vec3(x, c, 0.0);
    } else if (h_prime >= 2.0 && h_prime < 3.0) {
        rgb1 = vec3(0.0, c, x);
    } else if (h_prime >= 3.0 && h_prime < 4.0) {
        rgb1 = vec3(0.0, x, c);
    } else if (h_prime >= 4.0 && h_prime < 5.0) {
        rgb1 = vec3(x, 0.0, c);
    } else {
        rgb1 = vec3(c, 0.0, x);
    }
    float m = l_adj - c * 0.5;
    vec3 rgb = rgb1 + vec3(m);
    return vec4(rgb, color.a);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_gamma_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::gamma".to_string(),
        display_name: "Gamma".to_string(),
        category: "Color".to_string(),
        description: "Adjust gamma".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
            ..Default::default()
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
            ..Default::default()
        }],
        params: vec![ManifestParam {
            key: "gamma".to_string(),
            label: "Gamma".to_string(),
            ty: "Float".to_string(),
            default: serde_json::json!(1.0),
            min: Some(0.01),
            max: Some(10.0),
            step: Some(0.01),
            ui: Some("Slider".to_string()),
            options: vec![],
        }],
        kernel: r#"
    float g = 1.0 / gamma;
    return vec4(pow(color.rgb, vec3(g)), color.a);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_threshold_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::threshold".to_string(),
        display_name: "Threshold".to_string(),
        category: "Color".to_string(),
        description: "Threshold image".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
            ..Default::default()
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
            ..Default::default()
        }],
        params: vec![ManifestParam {
            key: "threshold".to_string(),
            label: "Threshold".to_string(),
            ty: "Float".to_string(),
            default: serde_json::json!(0.5),
            min: Some(0.0),
            max: Some(1.0),
            step: Some(0.01),
            ui: Some("Slider".to_string()),
            options: vec![],
        }],
        kernel: r#"
    float l = luminance(color);
    float v = l >= threshold ? 1.0 : 0.0;
    return vec4(v, v, v, color.a);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_posterize_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::posterize".to_string(),
        display_name: "Posterize".to_string(),
        category: "Color".to_string(),
        description: "Posterize image".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
            ..Default::default()
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
            ..Default::default()
        }],
        params: vec![ManifestParam {
            key: "levels".to_string(),
            label: "Levels".to_string(),
            ty: "Int".to_string(),
            default: serde_json::json!(8),
            min: Some(2.0),
            max: Some(256.0),
            step: Some(1.0),
            ui: Some("NumberInput".to_string()),
            options: vec![],
        }],
        kernel: r#"
    float ml = float(levels) - 1.0;
    vec3 v = floor(color.rgb * ml + 0.5) / ml;
    return vec4(v, color.a);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_clamp_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::clamp".to_string(),
        display_name: "Clamp".to_string(),
        category: "Color".to_string(),
        description: "Clamp RGB values".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
            ..Default::default()
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
            ..Default::default()
        }],
        params: vec![
            ManifestParam {
                key: "min_val".to_string(),
                label: "Min".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "max_val".to_string(),
                label: "Max".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    return vec4(clamp(color.rgb, vec3(min_val), vec3(max_val)), color.a);
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
    fn test_invert_manifest_transpiles() {
        assert_manifest_transpiles(builtin_invert_manifest());
    }

    #[test]
    fn test_brightness_contrast_manifest_transpiles() {
        assert_manifest_transpiles(builtin_brightness_contrast_manifest());
    }

    #[test]
    fn test_hue_saturation_manifest_transpiles() {
        assert_manifest_transpiles(builtin_hue_saturation_manifest());
    }

    #[test]
    fn test_gamma_manifest_transpiles() {
        assert_manifest_transpiles(builtin_gamma_manifest());
    }

    #[test]
    fn test_threshold_manifest_transpiles() {
        assert_manifest_transpiles(builtin_threshold_manifest());
    }

    #[test]
    fn test_posterize_manifest_transpiles() {
        assert_manifest_transpiles(builtin_posterize_manifest());
    }

    #[test]
    fn test_clamp_manifest_transpiles() {
        assert_manifest_transpiles(builtin_clamp_manifest());
    }
}
