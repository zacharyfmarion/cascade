use half::f16;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};

// ── Geometry primitives ──────────────────────────────────────────────

/// Integer 2D point in pixel index space.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct IVec2 {
    pub x: i32,
    pub y: i32,
}

impl IVec2 {
    pub const ZERO: Self = Self { x: 0, y: 0 };

    pub const fn new(x: i32, y: i32) -> Self {
        Self { x, y }
    }
}

/// Half-open pixel rectangle: x in [min.x, max.x), y in [min.y, max.y).
/// Empty when min.x >= max.x or min.y >= max.y.
/// Coordinates can be negative (data extending left/above origin).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RectI {
    pub min: IVec2,
    pub max: IVec2,
}

impl RectI {
    pub const EMPTY: Self = Self {
        min: IVec2 { x: 0, y: 0 },
        max: IVec2 { x: 0, y: 0 },
    };

    /// Convenience: `(0,0)→(w,h)` for legacy / simple images.
    pub fn from_dimensions(w: u32, h: u32) -> Self {
        Self {
            min: IVec2::ZERO,
            max: IVec2::new(w as i32, h as i32),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.min.x >= self.max.x || self.min.y >= self.max.y
    }

    /// Width of the rectangle (can be 0 or negative if empty).
    pub fn width(&self) -> i32 {
        self.max.x - self.min.x
    }

    /// Height of the rectangle (can be 0 or negative if empty).
    pub fn height(&self) -> i32 {
        self.max.y - self.min.y
    }

    /// Safe pixel count for allocation. Returns `Err` on overflow.
    pub fn area_checked(&self) -> Result<usize, crate::error::CompositorError> {
        let w = self.width().max(0) as u64;
        let h = self.height().max(0) as u64;
        let pixels = w
            .checked_mul(h)
            .ok_or_else(|| crate::error::CompositorError::Other("Data window too large".into()))?;
        usize::try_from(pixels)
            .map_err(|_| crate::error::CompositorError::Other("Data window too large".into()))
    }

    /// Check whether `(x, y)` is inside this half-open rectangle.
    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.min.x && x < self.max.x && y >= self.min.y && y < self.max.y
    }

    /// Smallest rectangle covering both `self` and `other`.
    /// If either is empty, returns the other.
    pub fn union(self, other: Self) -> Self {
        if self.is_empty() {
            return other;
        }
        if other.is_empty() {
            return self;
        }
        Self {
            min: IVec2::new(self.min.x.min(other.min.x), self.min.y.min(other.min.y)),
            max: IVec2::new(self.max.x.max(other.max.x), self.max.y.max(other.max.y)),
        }
    }

    /// Overlap region (may be empty).
    pub fn intersect(self, other: Self) -> Self {
        let result = Self {
            min: IVec2::new(self.min.x.max(other.min.x), self.min.y.max(other.min.y)),
            max: IVec2::new(self.max.x.min(other.max.x), self.max.y.min(other.max.y)),
        };
        if result.is_empty() {
            Self::EMPTY
        } else {
            result
        }
    }

    /// Grow by `px` pixels on all sides (saturating).
    pub fn expand(self, px: i32) -> Self {
        Self {
            min: IVec2::new(self.min.x.saturating_sub(px), self.min.y.saturating_sub(px)),
            max: IVec2::new(self.max.x.saturating_add(px), self.max.y.saturating_add(px)),
        }
    }

    /// Shift origin.
    pub fn translate(self, dx: i32, dy: i32) -> Self {
        Self {
            min: IVec2::new(self.min.x.saturating_add(dx), self.min.y.saturating_add(dy)),
            max: IVec2::new(self.max.x.saturating_add(dx), self.max.y.saturating_add(dy)),
        }
    }

    /// Width clamped to >= 0, as `u32`.
    pub fn width_u32(&self) -> u32 {
        self.width().max(0) as u32
    }

    /// Height clamped to >= 0, as `u32`.
    pub fn height_u32(&self) -> u32 {
        self.height().max(0) as u32
    }
}

// ── Format types ─────────────────────────────────────────────────────

/// Pixel aspect ratio as a rational number.
/// 1:1 for square pixels (most common).
/// Anamorphic footage uses non-square (e.g., 2:1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PixelAspectRatio {
    pub num: u32, // >= 1
    pub den: u32, // >= 1
}

impl Default for PixelAspectRatio {
    fn default() -> Self {
        Self { num: 1, den: 1 }
    }
}

impl PixelAspectRatio {
    pub fn is_square(&self) -> bool {
        self.num == self.den
    }

    pub fn as_f32(&self) -> f32 {
        self.num as f32 / self.den as f32
    }
}

/// A named output format (display window + pixel aspect).
/// This is the "canvas" the viewer displays.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Format {
    pub display_window: RectI,
    pub pixel_aspect: PixelAspectRatio,
}

impl Format {
    /// Common constructor: 1920×1080 square pixels, origin at (0,0).
    pub fn hd() -> Self {
        Self {
            display_window: RectI::from_dimensions(1920, 1080),
            pixel_aspect: PixelAspectRatio::default(),
        }
    }

    /// Arbitrary resolution with square pixels.
    pub fn from_dimensions(w: u32, h: u32) -> Self {
        Self {
            display_window: RectI::from_dimensions(w, h),
            pixel_aspect: PixelAspectRatio::default(),
        }
    }

    pub fn width(&self) -> u32 {
        self.display_window.width().max(0) as u32
    }

    pub fn height(&self) -> u32 {
        self.display_window.height().max(0) as u32
    }
}

impl Default for Format {
    fn default() -> Self {
        Self::hd()
    }
}

// ── Color space ──────────────────────────────────────────────────────

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
    /// Backward-compatible data width. Always equals `data_window.width_u32()`.
    pub width: u32,
    /// Backward-compatible data height. Always equals `data_window.height_u32()`.
    pub height: u32,
    pub data: Arc<Vec<f32>>,
    pub color_space: ColorSpaceId,
    /// The display format this image belongs to (the "canvas").
    pub format: Format,
    /// The region that actually contains pixel data.
    /// May differ from `format.display_window`.
    pub data_window: RectI,
}

impl Image {
    pub fn new(width: u32, height: u32) -> Self {
        let len = (width as usize) * (height as usize) * 4;
        let dw = RectI::from_dimensions(width, height);
        Self {
            width,
            height,
            data: Arc::new(vec![0.0f32; len]),
            color_space: ColorSpaceId::default_working(),
            format: Format::from_dimensions(width, height),
            data_window: dw,
        }
    }

    pub fn from_f32_data(width: u32, height: u32, data: Vec<f32>) -> Self {
        assert_eq!(data.len(), (width as usize) * (height as usize) * 4);
        let dw = RectI::from_dimensions(width, height);
        Self {
            width,
            height,
            data: Arc::new(data),
            color_space: ColorSpaceId::default_working(),
            format: Format::from_dimensions(width, height),
            data_window: dw,
        }
    }

    pub fn from_f32_data_with_space(
        width: u32,
        height: u32,
        data: Vec<f32>,
        color_space: ColorSpaceId,
    ) -> Self {
        assert_eq!(data.len(), (width as usize) * (height as usize) * 4);
        let dw = RectI::from_dimensions(width, height);
        Self {
            width,
            height,
            data: Arc::new(data),
            color_space,
            format: Format::from_dimensions(width, height),
            data_window: dw,
        }
    }

    /// Full constructor with explicit format and data window.
    pub fn new_with_domain(
        format: Format,
        data_window: RectI,
        data: Vec<f32>,
        color_space: ColorSpaceId,
    ) -> Self {
        let w = data_window.width_u32();
        let h = data_window.height_u32();
        assert_eq!(data.len(), (w as usize) * (h as usize) * 4);
        Self {
            width: w,
            height: h,
            data: Arc::new(data),
            color_space,
            format,
            data_window,
        }
    }

    pub fn from_f16_data(width: u32, height: u32, data: Vec<f16>) -> Self {
        let f32_data: Vec<f32> = data.iter().map(|v| v.to_f32()).collect();
        Self::from_f32_data(width, height, f32_data)
    }

    pub fn pixel_count(&self) -> usize {
        (self.width as usize) * (self.height as usize)
    }

    /// Data dimensions (NOT format dimensions).
    pub fn data_width(&self) -> u32 {
        self.data_window.width_u32()
    }

    /// Data dimensions (NOT format dimensions).
    pub fn data_height(&self) -> u32 {
        self.data_window.height_u32()
    }

    /// Is data_window empty (no pixel data)?
    pub fn is_empty(&self) -> bool {
        self.data_window.is_empty()
    }

    /// Convert global pixel coordinates to index into `self.data`.
    /// Returns `None` if `(x, y)` is outside data_window.
    pub fn index_of(&self, x: i32, y: i32) -> Option<usize> {
        if !self.data_window.contains(x, y) {
            return None;
        }
        let lx = (x - self.data_window.min.x) as usize;
        let ly = (y - self.data_window.min.y) as usize;
        Some((ly * self.width as usize + lx) * 4)
    }

    /// Sample pixel at global coords. Returns transparent black outside data_window.
    pub fn get_rgba(&self, x: i32, y: i32) -> [f32; 4] {
        match self.index_of(x, y) {
            Some(idx) => [
                self.data[idx],
                self.data[idx + 1],
                self.data[idx + 2],
                self.data[idx + 3],
            ],
            None => [0.0, 0.0, 0.0, 0.0],
        }
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

/// Transform applied to field coordinates before sampling.
#[derive(Debug, Clone)]
pub struct FieldTransform {
    pub scale: [f32; 2],
    pub offset: [f32; 2],
    pub rotation: f32, // radians
}

impl Default for FieldTransform {
    fn default() -> Self {
        Self {
            scale: [1.0, 1.0],
            offset: [0.0, 0.0],
            rotation: 0.0,
        }
    }
}

impl FieldTransform {
    /// Transforms UV coords: offset → rotate (around center) → scale.
    pub fn apply(&self, u: f32, v: f32) -> (f32, f32) {
        let u = u - self.offset[0];
        let v = v - self.offset[1];

        let (u, v) = if self.rotation.abs() > f32::EPSILON {
            let cu = u - 0.5;
            let cv = v - 0.5;
            let cos_r = self.rotation.cos();
            let sin_r = self.rotation.sin();
            (cu * cos_r - cv * sin_r + 0.5, cu * sin_r + cv * cos_r + 0.5)
        } else {
            (u, v)
        };

        (u * self.scale[0], v * self.scale[1])
    }
}

/// A resolution-independent procedural pattern.
/// Maps normalized (u, v) coordinates in [0,1] to RGBA color values.
#[derive(Clone)]
pub struct Field {
    pub sample_fn: Arc<dyn Fn(f32, f32) -> [f32; 4] + Send + Sync>,
    pub transform: FieldTransform,
}

impl std::fmt::Debug for Field {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Field")
            .field("transform", &self.transform)
            .finish()
    }
}

impl Field {
    pub fn new<F>(sample_fn: F) -> Self
    where
        F: Fn(f32, f32) -> [f32; 4] + Send + Sync + 'static,
    {
        Self {
            sample_fn: Arc::new(sample_fn),
            transform: FieldTransform::default(),
        }
    }

    pub fn with_transform<F>(sample_fn: F, transform: FieldTransform) -> Self
    where
        F: Fn(f32, f32) -> [f32; 4] + Send + Sync + 'static,
    {
        Self {
            sample_fn: Arc::new(sample_fn),
            transform,
        }
    }

    /// Sample the field at the given UV coordinates, applying the transform.
    pub fn sample(&self, u: f32, v: f32) -> [f32; 4] {
        let (tu, tv) = self.transform.apply(u, v);
        (self.sample_fn)(tu, tv)
    }

    pub fn rasterize(&self, width: u32, height: u32) -> Image {
        let format = Format::from_dimensions(width, height);
        let data_window = RectI::from_dimensions(width, height);
        self.rasterize_to_domain(format, data_window)
    }

    pub fn rasterize_to_domain(&self, format: Format, data_window: RectI) -> Image {
        let dw_w = data_window.width_u32();
        let dw_h = data_window.height_u32();
        let pixel_count = (dw_w as usize) * (dw_h as usize);
        let mut data = vec![0.0f32; pixel_count * 4];

        let disp = &format.display_window;
        let disp_w = disp.width() as f32;
        let disp_h = disp.height() as f32;
        let inv_w = if disp_w > 0.0 { 1.0 / disp_w } else { 0.0 };
        let inv_h = if disp_h > 0.0 { 1.0 / disp_h } else { 0.0 };
        let disp_min_x = disp.min.x as f32;
        let disp_min_y = disp.min.y as f32;
        let dw_min_x = data_window.min.x;
        let dw_min_y = data_window.min.y;
        let w = dw_w as usize;

        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let local_x = (i % w) as i32;
                let local_y = (i / w) as i32;
                let global_x = dw_min_x + local_x;
                let global_y = dw_min_y + local_y;
                let u = (global_x as f32 + 0.5 - disp_min_x) * inv_w;
                let v = (global_y as f32 + 0.5 - disp_min_y) * inv_h;
                let color = self.sample(u, v);
                out[0] = color[0];
                out[1] = color[1];
                out[2] = color[2];
                out[3] = color[3];
            });

        Image::new_with_domain(format, data_window, data, ColorSpaceId::default_working())
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
    Field,
}

#[derive(Debug, Clone)]
pub enum Value {
    Image(Image),
    Mask(Image),
    Float(f32),
    Int(i32),
    Bool(bool),
    Color([f32; 4]),
    Field(Field),
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
            Value::Field(_) => ValueType::Field,
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

    pub fn as_field(&self) -> Option<&Field> {
        match self {
            Value::Field(f) => Some(f),
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
    ColorPalette,
    Hidden,
    TextArea,
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
    #[serde(default = "default_true")]
    pub promotable: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ParamDefault {
    Float(f64),
    Int(i64),
    Bool(bool),
    Color([f64; 4]),
    ColorRamp(Vec<ColorStop>),
    ColorPalette(Vec<[f64; 4]>),
    String(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortSpec {
    pub name: String,
    pub label: String,
    pub ty: ValueType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<ParamDefault>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_hint: Option<UiHint>,
}

impl Default for PortSpec {
    fn default() -> Self {
        Self {
            name: String::new(),
            label: String::new(),
            ty: ValueType::Image,
            default: None,
            min: None,
            max: None,
            step: None,
            ui_hint: None,
        }
    }
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

impl NodeSpec {
    pub fn all_inputs(&self) -> Vec<PortSpec> {
        let mut all = self.inputs.clone();
        for param in &self.params {
            if !Self::is_connectable_param(param) {
                continue;
            }
            if all.iter().any(|p| p.name == param.key) {
                continue;
            }
            all.push(PortSpec {
                name: param.key.clone(),
                label: param.label.clone(),
                ty: param.ty.clone(),
                default: Some(param.default.clone()),
                min: param.min,
                max: param.max,
                step: param.step,
                ui_hint: Some(param.ui_hint.clone()),
            });
        }
        all
    }

    pub fn is_connectable_param(param: &ParamSpec) -> bool {
        param.promotable
            && matches!(
                param.ty,
                ValueType::Float | ValueType::Int | ValueType::Bool | ValueType::Color
            )
            && matches!(
                param.ui_hint,
                UiHint::Slider | UiHint::NumberInput | UiHint::Checkbox | UiHint::ColorPicker
            )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ParamValue {
    Float(f64),
    Int(i64),
    Bool(bool),
    Color([f64; 4]),
    ColorRamp(Vec<ColorStop>),
    ColorPalette(Vec<[f64; 4]>),
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
