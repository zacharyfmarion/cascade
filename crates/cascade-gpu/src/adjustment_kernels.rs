use crate::manifest::{KernelManifest, ManifestParam, ManifestPort};

fn image_input() -> ManifestPort {
    ManifestPort {
        name: "image".to_string(),
        label: "Image".to_string(),
        ty: "Image".to_string(),
        optional: false,
        ..Default::default()
    }
}

fn image_output() -> ManifestPort {
    ManifestPort {
        name: "image".to_string(),
        label: "Image".to_string(),
        ty: "Image".to_string(),
        optional: false,
        ..Default::default()
    }
}

fn slider_param(
    key: &str,
    label: &str,
    default: f64,
    min: f64,
    max: f64,
    step: f64,
) -> ManifestParam {
    ManifestParam {
        key: key.to_string(),
        label: label.to_string(),
        ty: "Float".to_string(),
        default: serde_json::Value::from(default),
        min: Some(min),
        max: Some(max),
        step: Some(step),
        ui: Some("Slider".to_string()),
        options: vec![],
    }
}

pub fn builtin_white_balance_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::white_balance".to_string(),
        display_name: "White Balance".to_string(),
        category: "Color".to_string(),
        description: "Temperature and tint adjustment".to_string(),
        inputs: vec![image_input()],
        outputs: vec![image_output()],
        params: vec![
            slider_param("temperature", "Temperature", 0.0, -100.0, 100.0, 1.0),
            slider_param("tint", "Tint", 0.0, -100.0, 100.0, 1.0),
        ],
        kernel: r#"
    float temp = clamp(temperature / 100.0, -1.0, 1.0);
    float tint_amount = clamp(tint / 100.0, -1.0, 1.0);
    float temp_scale = temp * 0.25;
    float tint_scale = tint_amount * 0.18;
    vec3 gains = max(
        vec3(
            1.0 + temp_scale + tint_scale * 0.25,
            1.0 - tint_scale,
            1.0 - temp_scale + tint_scale * 0.25
        ),
        vec3(0.0)
    );
    return vec4(color.rgb * gains, color.a);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_exposure_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::exposure".to_string(),
        display_name: "Exposure".to_string(),
        category: "Color".to_string(),
        description: "Adjust exposure in stops".to_string(),
        inputs: vec![image_input()],
        outputs: vec![image_output()],
        params: vec![slider_param("exposure", "Exposure", 0.0, -5.0, 5.0, 0.01)],
        kernel: r#"
    float scale = pow(2.0, exposure);
    return vec4(color.rgb * scale, color.a);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_contrast_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::contrast".to_string(),
        display_name: "Contrast".to_string(),
        category: "Color".to_string(),
        description: "Adjust contrast around middle gray".to_string(),
        inputs: vec![image_input()],
        outputs: vec![image_output()],
        params: vec![slider_param(
            "contrast", "Contrast", 0.0, -100.0, 100.0, 1.0,
        )],
        kernel: r#"
    float contrast_stops = clamp(contrast / 50.0, -2.0, 2.0);
    float factor = pow(2.0, contrast_stops);
    vec3 pivot = vec3(0.18);
    return vec4(pivot + (color.rgb - pivot) * factor, color.a);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_luma_adjust_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::luma_adjust".to_string(),
        display_name: "Luma Adjust".to_string(),
        category: "Color".to_string(),
        description: "Adjust shadows, highlights, blacks, or whites by luminance zone".to_string(),
        inputs: vec![image_input()],
        outputs: vec![image_output()],
        params: vec![
            ManifestParam {
                key: "mode".to_string(),
                label: "Mode".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(0),
                min: Some(0.0),
                max: Some(3.0),
                step: Some(1.0),
                ui: Some("Dropdown".to_string()),
                options: vec![
                    "Shadows".to_string(),
                    "Highlights".to_string(),
                    "Blacks".to_string(),
                    "Whites".to_string(),
                ],
            },
            slider_param("amount", "Amount", 0.0, -100.0, 100.0, 1.0),
        ],
        kernel: r#"
    float lum = clamp(luminance(color), 0.0, 1.0);
    float weight = 0.0;
    if (mode == 0) {
        weight = (1.0 - lum) * (1.0 - lum);
    } else if (mode == 1) {
        weight = lum * lum;
    } else if (mode == 2) {
        weight = 1.0 - smoothstep(0.0, 0.45, lum);
    } else if (mode == 3) {
        weight = smoothstep(0.55, 1.0, lum);
    }

    float adjustment = clamp(amount / 100.0, -1.0, 1.0) * weight;
    vec3 adjusted = color.rgb;
    if (adjustment >= 0.0) {
        adjusted = color.rgb + (vec3(1.0) - color.rgb) * adjustment;
    } else {
        adjusted = color.rgb + color.rgb * adjustment;
    }
    return vec4(adjusted, color.a);
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
        let glsl = manifest.build_glsl().expect("GLSL should build");
        let wgsl = glsl_to_wgsl(&glsl).expect("GLSL should transpile to WGSL");
        assert!(wgsl.contains("fn main"));
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn adjustment_manifests_transpile() {
        assert_manifest_transpiles(builtin_white_balance_manifest());
        assert_manifest_transpiles(builtin_exposure_manifest());
        assert_manifest_transpiles(builtin_contrast_manifest());
        assert_manifest_transpiles(builtin_luma_adjust_manifest());
    }

    #[test]
    fn adjustment_manifests_expose_one_mask_input() {
        let manifests = [
            builtin_white_balance_manifest(),
            builtin_exposure_manifest(),
            builtin_contrast_manifest(),
            builtin_luma_adjust_manifest(),
        ];

        for manifest in manifests {
            let spec = manifest.to_node_spec().expect("Spec should build");
            let mask_inputs = spec
                .inputs
                .iter()
                .filter(|input| input.name == "mask")
                .count();
            assert_eq!(mask_inputs, 1, "{} should expose one mask input", spec.id);
        }
    }
}
