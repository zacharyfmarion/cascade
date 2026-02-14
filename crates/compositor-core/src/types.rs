use half::f16;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};

/// Identifier for a color space. Open-ended (string-backed) to support
/// arbitrary OCIO config-defined spaces. Use the constants for well-known spaces.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ColorSpaceId(pub String);

impl ColorSpaceId {
    pub const SRGB: &str = "sRGB";
    pub const LINEAR_SRGB: &str = "Linear sRGB";
    pub const ACESCG: &str = "ACEScg";

    pub fn new(name: &str) -> Self {
        Self(name.to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn default_working() -> Self {
        Self::new(Self::LINEAR_SRGB)
    }
}

impl std::fmt::Display for ColorSpaceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub data: Arc<Vec<f32>>,
    /// The color space these pixel values are encoded in.
    pub color_space: ColorSpaceId,
}

impl Image {
    pub fn new(width: u32, height: u32) -> Self {
        let len = (width as usize) * (height as usize) * 4;
        Self {
            width,
            height,
            data: Arc::new(vec![0.0f32; len]),
            color_space: ColorSpaceId::default_working(),
        }
    }

    pub fn from_f32_data(width: u32, height: u32, data: Vec<f32>) -> Self {
        assert_eq!(data.len(), (width as usize) * (height as usize) * 4);
        Self {
            width,
            height,
            data: Arc::new(data),
            color_space: ColorSpaceId::default_working(),
        }
    }

    /// Create an image with an explicit color space.
    pub fn from_f32_data_with_space(
        width: u32,
        height: u32,
        data: Vec<f32>,
        color_space: ColorSpaceId,
    ) -> Self {
        assert_eq!(data.len(), (width as usize) * (height as usize) * 4);
        Self {
            width,
            height,
            data: Arc::new(data),
            color_space,
        }
    }

    /// Convert from f16 data (used at I/O boundaries like GPU readback)
    pub fn from_f16_data(width: u32, height: u32, data: Vec<f16>) -> Self {
        let f32_data: Vec<f32> = data.iter().map(|v| v.to_f32()).collect();
        Self::from_f32_data(width, height, f32_data)
    }

    pub fn pixel_count(&self) -> usize {
        (self.width as usize) * (self.height as usize)
    }

    pub fn get_pixel_f32(&self, x: u32, y: u32) -> [f32; 4] {
        let idx = ((y as usize) * (self.width as usize) + (x as usize)) * 4;
        [
            self.data[idx],
            self.data[idx + 1],
            self.data[idx + 2],
            self.data[idx + 3],
        ]
    }

    /// Pack pixel data as f16 bytes for GPU upload
    pub fn to_f16_bytes(&self) -> Vec<u8> {
        let mut raw = Vec::with_capacity(self.data.len() * 2);
        for &v in self.data.iter() {
            raw.extend_from_slice(&f16::from_f32(v).to_bits().to_le_bytes());
        }
        raw
    }

    pub fn to_rgba8_srgb(&self) -> Vec<u8> {
        let lut = linear_to_srgb_lut();
        let pixel_count = self.pixel_count();
        let mut out = vec![0u8; pixel_count * 4];
        out.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, rgba_out)| {
                let idx = i * 4;
                for c in 0..3 {
                    let linear = self.data[idx + c].clamp(0.0, 1.0);
                    let lut_idx = (linear * 4095.0) as usize;
                    rgba_out[c] = lut[lut_idx.min(4095)];
                }
                let a = self.data[idx + 3].clamp(0.0, 1.0);
                rgba_out[3] = (a * 255.0 + 0.5) as u8;
            });
        out
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum ValueType {
    Image,
    Mask,
    Float,
    Int,
    Bool,
    Color,
}

#[derive(Debug, Clone)]
pub enum Value {
    Image(Image),
    Mask(Image),
    Float(f32),
    Int(i32),
    Bool(bool),
    Color([f32; 4]),
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColorStop {
    pub position: f64,
    pub color: [f64; 4],
}

impl Value {
    pub fn value_type(&self) -> ValueType {
        match self {
            Value::Image(_) => ValueType::Image,
            Value::Mask(_) => ValueType::Mask,
            Value::Float(_) => ValueType::Float,
            Value::Int(_) => ValueType::Int,
            Value::Bool(_) => ValueType::Bool,
            Value::Color(_) => ValueType::Color,
            Value::None => ValueType::Float,
        }
    }

    pub fn as_image(&self) -> Option<&Image> {
        match self {
            Value::Image(img) => Some(img),
            _ => None,
        }
    }

    pub fn as_float(&self) -> Option<f32> {
        match self {
            Value::Float(v) => Some(*v),
            _ => None,
        }
    }

    pub fn as_int(&self) -> Option<i32> {
        match self {
            Value::Int(v) => Some(*v),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(v) => Some(*v),
            _ => None,
        }
    }

    pub fn as_color(&self) -> Option<[f32; 4]> {
        match self {
            Value::Color(c) => Some(*c),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum UiHint {
    Slider,
    NumberInput,
    Checkbox,
    ColorPicker,
    Dropdown(Vec<String>),
    FilePicker,
    ColorRamp,
    Hidden,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParamSpec {
    pub key: String,
    pub label: String,
    pub ty: ValueType,
    pub default: ParamDefault,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub ui_hint: UiHint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ParamDefault {
    Float(f64),
    Int(i64),
    Bool(bool),
    Color([f64; 4]),
    ColorRamp(Vec<ColorStop>),
    String(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortSpec {
    pub name: String,
    pub label: String,
    pub ty: ValueType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSpec {
    pub id: String,
    pub display_name: String,
    pub category: String,
    pub description: String,
    pub inputs: Vec<PortSpec>,
    pub outputs: Vec<PortSpec>,
    pub params: Vec<ParamSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ParamValue {
    Float(f64),
    Int(i64),
    Bool(bool),
    Color([f64; 4]),
    ColorRamp(Vec<ColorStop>),
    String(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct FrameTime {
    pub frame: u64,
}

fn linear_to_srgb_lut() -> &'static [u8; 4096] {
    static LUT: OnceLock<[u8; 4096]> = OnceLock::new();
    LUT.get_or_init(|| {
        let mut table = [0u8; 4096];
        for i in 0..4096 {
            let linear = i as f32 / 4095.0;
            let srgb = if linear <= 0.0031308 {
                linear * 12.92
            } else {
                1.055 * linear.powf(1.0 / 2.4) - 0.055
            };
            table[i] = (srgb * 255.0 + 0.5) as u8;
        }
        table
    })
}
