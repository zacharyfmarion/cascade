use cascade_core::types::{NodeSpec, ParamDefault, ParamSpec, PortSpec, UiHint, ValueType};
use serde::{Deserialize, Serialize};

use crate::template::{build_kernel_template, KernelParam, ParamType};

#[derive(Deserialize, Serialize, Clone)]
pub struct KernelManifest {
    pub id: String,
    pub display_name: String,
    pub category: String,
    pub description: String,
    pub inputs: Vec<ManifestPort>,
    pub outputs: Vec<ManifestPort>,
    pub params: Vec<ManifestParam>,
    pub kernel: String,
    #[serde(default = "default_true")]
    pub supports_mask: bool,
    /// Param keys whose values are in pixel units. The GPU kernel executor multiplies these
    /// by `ctx.preview_scale` before writing the uniform buffer so preview renders match
    /// full-res commits proportionally.
    #[serde(default)]
    pub pixel_space_params: Vec<String>,
}

fn default_true() -> bool {
    true
}

impl Default for KernelManifest {
    fn default() -> Self {
        Self {
            id: String::new(),
            display_name: String::new(),
            category: String::new(),
            description: String::new(),
            inputs: Vec::new(),
            outputs: Vec::new(),
            params: Vec::new(),
            kernel: String::new(),
            supports_mask: true,
            pixel_space_params: Vec::new(),
        }
    }
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ManifestPort {
    pub name: String,
    pub label: String,
    pub ty: String,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ManifestParam {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub default: serde_json::Value,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub ui: Option<String>,
    #[serde(default)]
    pub options: Vec<String>,
}

impl KernelManifest {
    pub fn to_node_spec(&self) -> Result<NodeSpec, String> {
        let mut inputs = self
            .inputs
            .iter()
            .map(|port| {
                let ty = parse_value_type(&port.ty)?;
                Ok(PortSpec {
                    name: port.name.clone(),
                    label: port.label.clone(),
                    ty,
                    ..Default::default()
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        if self.supports_mask {
            inputs.push(PortSpec {
                name: "mask".to_string(),
                label: "Mask".to_string(),
                ty: ValueType::Mask,
                ..Default::default()
            });
        }

        let outputs = self
            .outputs
            .iter()
            .map(|port| {
                let ty = parse_value_type(&port.ty)?;
                Ok(PortSpec {
                    name: port.name.clone(),
                    label: port.label.clone(),
                    ty,
                    ..Default::default()
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        let params = self
            .params
            .iter()
            .map(|param| {
                let ty = parse_value_type(&param.ty)?;
                let default = parse_param_default(&param.default, &ty)?;
                let ui_hint = parse_ui_hint(param.ui.as_deref(), &ty, &param.options);
                Ok(ParamSpec {
                    key: param.key.clone(),
                    label: param.label.clone(),
                    ty,
                    default,
                    min: param.min,
                    max: param.max,
                    step: param.step,
                    ui_hint,
                    promotable: true,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        Ok(NodeSpec {
            id: self.id.clone(),
            display_name: self.display_name.clone(),
            category: self.category.clone(),
            description: self.description.clone(),
            inputs,
            outputs,
            params,
        })
    }

    pub fn build_glsl(&self) -> Result<String, String> {
        let image_inputs: Vec<String> = self
            .inputs
            .iter()
            .filter(|port| matches_image_type(&port.ty))
            .map(|port| port.name.clone())
            .collect();

        if image_inputs.is_empty() {
            return Err("Kernel manifest requires at least one image input".to_string());
        }

        let params = self
            .params
            .iter()
            .map(|param| {
                let ty = parse_param_type(&param.ty)?;
                Ok(KernelParam {
                    name: param.key.clone(),
                    ty,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        let mut scalar_inputs = self
            .inputs
            .iter()
            .filter(|port| matches_scalar_type(&port.ty))
            .map(|port| {
                let ty = parse_param_type(&port.ty)?;
                Ok(KernelParam {
                    name: port.name.clone(),
                    ty,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        for port in self
            .inputs
            .iter()
            .filter(|port| port.optional && matches_image_type(&port.ty))
        {
            scalar_inputs.push(KernelParam {
                name: format!("has_{}", port.name),
                ty: ParamType::Int,
            });
        }

        if self.supports_mask {
            scalar_inputs.push(KernelParam {
                name: "has_mask".to_string(),
                ty: ParamType::Int,
            });
        }

        let mut extra_images = image_inputs.into_iter().skip(1).collect::<Vec<_>>();
        if self.supports_mask {
            extra_images.push("mask".to_string());
        }
        Ok(build_kernel_template(
            &self.kernel,
            &params,
            &extra_images,
            &scalar_inputs,
            self.supports_mask,
        ))
    }
}

pub fn builtin_pixelate_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::pixelate".to_string(),
        display_name: "Pixelate".to_string(),
        category: "Filter".to_string(),
        description: "Pixelate an image by snapping pixels to block centers".to_string(),
        inputs: vec![
            ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
            },
            ManifestPort {
                name: "palette".to_string(),
                label: "Palette".to_string(),
                ty: "Image".to_string(),
                optional: true,
            },
        ],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        params: vec![
            ManifestParam {
                key: "pixel_size".to_string(),
                label: "Pixel Size".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(4),
                min: Some(1.0),
                max: Some(128.0),
                step: Some(1.0),
                ui: Some("NumberInput".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "algorithm".to_string(),
                label: "Algorithm".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(1.0),
                ui: Some("Dropdown".to_string()),
                options: vec!["Two Nearest".to_string(), "Threshold Offset".to_string()],
            },
            ManifestParam {
                key: "matrix_size".to_string(),
                label: "Matrix Size".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(8),
                min: Some(2.0),
                max: Some(8.0),
                step: Some(1.0),
                ui: Some("NumberInput".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "dither_amount".to_string(),
                label: "Dither Amount".to_string(),
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
    ivec2 dims = imageSize(u_input);
    int block = max(pixel_size, 1);
    ivec2 block_origin = (pixel / block) * block + block / 2;
    block_origin = clamp(block_origin, ivec2(0), dims - 1);
    vec4 pixelated = imageLoad(u_input, block_origin);
    
    if (has_palette == 0) {
        return pixelated;
    }

    // Bayer dithering using virtual pixel coordinates
    ivec2 vpixel = pixel / block;

    // Bayer matrices for different sizes
    const int bayer2[4] = int[4](0, 2, 3, 1);
    const int bayer4[16] = int[16](
        0, 8, 2, 10,
        12, 4, 14, 6,
        3, 11, 1, 9,
        15, 7, 13, 5
    );

    int ms = clamp(matrix_size, 2, 8);
    float threshold;
    if (ms <= 2) {
        int idx = (vpixel.y % 2) * 2 + (vpixel.x % 2);
        threshold = float(bayer2[idx]) / 4.0;
    } else if (ms <= 4) {
        int idx = (vpixel.y % 4) * 4 + (vpixel.x % 4);
        threshold = float(bayer4[idx]) / 16.0;
    } else {
        threshold = bayer8(vpixel.x, vpixel.y);
    }

    ivec2 pal_dims = imageSize(u_palette);
    int pal_count = max(pal_dims.x, 1);

    if (algorithm == 0) {
        float best_dist1 = 1e10;
        float best_dist2 = 1e10;
        vec3 best_col1 = vec3(0.0);
        vec3 best_col2 = vec3(0.0);

        for (int i = 0; i < pal_count; i++) {
            vec4 pal_color = imageLoad(u_palette, ivec2(i, 0));
            vec3 diff = pixelated.rgb - pal_color.rgb;
            float dist = dot(diff, diff);
            if (dist < best_dist1) {
                best_dist2 = best_dist1;
                best_col2 = best_col1;
                best_dist1 = dist;
                best_col1 = pal_color.rgb;
            } else if (dist < best_dist2) {
                best_dist2 = dist;
                best_col2 = pal_color.rgb;
            }
        }

        float total_dist = best_dist1 + best_dist2;
        float ratio = (total_dist > 0.0001) ? best_dist1 / total_dist : 0.0;
        ratio = mix(round(ratio), ratio, dither_amount);
        vec3 result = (threshold < ratio) ? best_col2 : best_col1;
        return vec4(result, pixelated.a);
    } else {
        float spread = dither_amount * 0.5;
        float offset = (threshold - 0.5) * spread;
        vec3 adjusted = clamp(pixelated.rgb + offset, 0.0, 1.0);

        float best_dist = 1e10;
        vec3 best_col = vec3(0.0);
        for (int i = 0; i < pal_count; i++) {
            vec4 pal_color = imageLoad(u_palette, ivec2(i, 0));
            vec3 diff = adjusted - pal_color.rgb;
            float dist = dot(diff, diff);
            if (dist < best_dist) {
                best_dist = dist;
                best_col = pal_color.rgb;
            }
        }
        return vec4(best_col, pixelated.a);
    }
        "#
        .trim()
        .to_string(),
        supports_mask: false,
        pixel_space_params: vec!["pixel_size".to_string()],
    }
}

pub fn gpu_script_passthrough_manifest(type_id: &str) -> KernelManifest {
    KernelManifest {
        id: type_id.to_string(),
        display_name: "GPU Script".to_string(),
        category: "GPU".to_string(),
        description: "Custom GPU shader node".to_string(),
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
        params: vec![],
        kernel: "return color;".to_string(),
        supports_mask: true,
        pixel_space_params: vec![],
    }
}

fn parse_value_type(value: &str) -> Result<ValueType, String> {
    match value {
        "Image" => Ok(ValueType::Image),
        "Mask" => Ok(ValueType::Mask),
        "Float" => Ok(ValueType::Float),
        "Int" => Ok(ValueType::Int),
        "Bool" => Ok(ValueType::Bool),
        "Color" => Ok(ValueType::Color),
        other => Err(format!("Unsupported value type: {other}")),
    }
}

pub(crate) fn matches_image_type(value: &str) -> bool {
    matches!(value, "Image" | "Mask")
}

fn matches_scalar_type(value: &str) -> bool {
    matches!(value, "Float" | "Int" | "Bool")
}

fn parse_param_type(value: &str) -> Result<ParamType, String> {
    match value {
        "Float" => Ok(ParamType::Float),
        "Int" => Ok(ParamType::Int),
        "Bool" => Ok(ParamType::Bool),
        other => Err(format!("Unsupported param type: {other}")),
    }
}

fn parse_param_default(
    default: &serde_json::Value,
    ty: &ValueType,
) -> Result<ParamDefault, String> {
    match ty {
        ValueType::Float => default
            .as_f64()
            .map(ParamDefault::Float)
            .ok_or_else(|| "Expected float default".to_string()),
        ValueType::Int => default
            .as_i64()
            .map(ParamDefault::Int)
            .ok_or_else(|| "Expected int default".to_string()),
        ValueType::Bool => default
            .as_bool()
            .map(ParamDefault::Bool)
            .ok_or_else(|| "Expected bool default".to_string()),
        ValueType::Color => default
            .as_array()
            .and_then(|arr| {
                if arr.len() == 4 {
                    Some([
                        arr[0].as_f64()?,
                        arr[1].as_f64()?,
                        arr[2].as_f64()?,
                        arr[3].as_f64()?,
                    ])
                } else {
                    None
                }
            })
            .map(ParamDefault::Color)
            .ok_or_else(|| "Expected color default".to_string()),
        _ => Err("Unsupported param default type".to_string()),
    }
}

fn parse_ui_hint(ui: Option<&str>, ty: &ValueType, options: &[String]) -> UiHint {
    match ui {
        Some("Slider") => UiHint::Slider,
        Some("NumberInput") => UiHint::NumberInput,
        Some("Checkbox") => UiHint::Checkbox,
        Some("ColorPicker") => UiHint::ColorPicker,
        Some("Dropdown") => UiHint::Dropdown(options.to_vec()),
        Some("FilePicker") => UiHint::FilePicker,
        Some("Hidden") => UiHint::Hidden,
        _ => match ty {
            ValueType::Float => UiHint::Slider,
            ValueType::Int => UiHint::NumberInput,
            ValueType::Bool => UiHint::Checkbox,
            ValueType::Color => UiHint::ColorPicker,
            _ => UiHint::Hidden,
        },
    }
}
