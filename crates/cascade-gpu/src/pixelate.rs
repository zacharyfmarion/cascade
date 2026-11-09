//! Pixelate node: a faithful port of the [zac.is-a.dev/pixelate](https://zac.is-a.dev/pixelate/)
//! algorithm.
//!
//! Reference: <https://github.com/zacharyfmarion/pixelate> at `efe80c9`
//! (`src/workers/imageProcessor.worker.ts` for processing and `src/lib/processing/palette.ts` for
//! palette extraction). The reference works on 8-bit, sRGB-encoded, straight-alpha RGBA
//! (canvas `ImageData`):
//!
//! 1. **Pixelate**: tile the image from its top-left corner into `pixel_size` squares (edge blocks
//!    are partial) and replace every block with the per-channel `Math.round` average of its
//!    pixels, alpha included.
//! 2. **Palette** (only when one is connected): map each block through a 32×32×32 lookup table
//!    whose buckets hold the palette color nearest to the bucket center under the weighted
//!    distance `2·dR² + 4·dG² + 3·dB²`. With dithering, a Bayer offset
//!    `(bayer[cell] / n² − 0.5) · strength · 64`, indexed by *block* coordinates, is added to R, G
//!    and B before the lookup. Alpha passes through unchanged.
//!
//! The reference's look depends on doing that averaging, dithering and color matching on 8-bit
//! sRGB codes, so this node is an intentional, display-referred exception to "never process
//! pixels in sRGB": it re-encodes its linear input to the same codes Load Image decoded, runs the
//! reference math exactly (integers on the GPU, `f64` wherever JavaScript uses doubles), and
//! decodes the resulting codes back to linear.
//!
//! The one deliberate deviation: the reference derives block coordinates with
//! `(x * (1 / blockSize)) | 0`, which floating-point rounding pushes into the previous block for
//! a few pixels at block sizes 49, 98, 103 and 107 (a one-pixel dither seam). This port uses exact
//! integer division.
//!
//! Work split:
//! - CPU: palette extraction and the dither bucket table (the LUT bucket every channel value lands
//!   in for each Bayer cell, computed with JavaScript's double arithmetic).
//! - GPU pass 1: build the 32,768-entry nearest-color LUT (skipped without a palette).
//! - GPU pass 2: one invocation per block averages its pixels, dithers, and looks up the LUT,
//!   writing final RGBA codes into a block-sized `rgba8uint` texture.
//! - CPU: read back only that block texture and expand it to full resolution, decoding codes to
//!   the exact linear values Load Image produces for them.

use std::any::Any;
use std::collections::HashMap;
use std::hash::Hasher;
use std::num::NonZeroU64;
use std::ops::RangeInclusive;
use std::sync::{Arc, OnceLock};

use ahash::{AHashMap, AHashSet, AHasher};
use cascade_core::error::CascadeError;
use cascade_core::node::{EvalContext, Node, NodeFuture};
use cascade_core::types::{
    ColorSpaceId, Image, NodeSpec, ParamDefault, ParamSpec, PortSpec, UiHint, Value, ValueType,
};
use rayon::prelude::*;

use crate::context::{CachedPipeline, GpuContext};
use crate::kernel_node::{align_to, create_storage_texture, upload_image};
use crate::transpile::glsl_to_wgsl;

pub const PIXELATE_NODE_ID: &str = "gpu_kernel::pixelate";

/// Largest accepted block edge. Keeps the shader's per-block sums (≤ 2 · 255 · 128² + 128²)
/// comfortably inside `i32`.
const MAX_PIXEL_SIZE: i64 = 128;
/// Bayer matrix edge for each `dither_matrix` dropdown option, in option order.
const DITHER_MATRIX_SIZES: [usize; 3] = [2, 4, 8];
const DITHER_MATRIX_OPTIONS: [&str; 3] = ["2x2", "4x4", "8x8"];
/// Reference `extractPaletteFromStrip` defaults.
const MAX_PALETTE_COLORS: usize = 256;
const MIN_PALETTE_COLOR_DIFFERENCE: i32 = 10;
const PALETTE_ALPHA_THRESHOLD: u8 = 128;
/// 32 levels per channel (`code >> 3`), as in the reference color LUT.
const LUT_ENTRIES: u32 = 32 * 32 * 32;
const LUT_WORKGROUP_SIZE: u32 = 64;
const BLOCK_WORKGROUP_SIZE: u32 = 16;
/// Entries per Bayer cell in the dither bucket table: one per 8-bit channel value.
const DITHER_TABLE_STRIDE: usize = 256;
/// `Params` uniform block: `dims`, `config`, then 256 `ivec4` palette colors.
const UNIFORM_WORDS: usize = 4 + 4 + MAX_PALETTE_COLORS * 4;

// Reference Bayer matrices (row-major, indexed `(y % n) * n + (x % n)`).
const BAYER_2X2: [u8; 4] = [0, 2, 3, 1];
#[rustfmt::skip]
const BAYER_4X4: [u8; 16] = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5,
];
#[rustfmt::skip]
const BAYER_8X8: [u8; 64] = [
    0, 32, 8, 40, 2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37,
    63, 31, 55, 23, 61, 29, 53, 21,
];

pub struct GpuPixelateNode {
    spec: NodeSpec,
    context: Arc<GpuContext>,
    shaders: Result<PixelateShaders, String>,
}

impl GpuPixelateNode {
    pub fn new(context: Arc<GpuContext>) -> Self {
        Self {
            spec: pixelate_spec(),
            context,
            shaders: build_shaders(),
        }
    }

    fn pipeline(
        &self,
        key: u64,
        label: &str,
        wgsl_source: &str,
        entries: &[wgpu::BindGroupLayoutEntry],
    ) -> CachedPipeline {
        if let Some(cached) = self.context.get_pipeline(key) {
            return cached;
        }

        let device = &self.context.device;
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(label),
            source: wgpu::ShaderSource::Wgsl(wgsl_source.into()),
        });
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(label),
            entries,
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(label),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some(label),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });

        let cached = CachedPipeline {
            pipeline: Arc::new(pipeline),
            bind_group_layout: Arc::new(bind_group_layout),
        };
        self.context.insert_pipeline(key, cached.clone());
        cached
    }

    /// Run both GPU passes and return the final RGBA codes of every block, row-major.
    async fn render_block_codes(
        &self,
        shaders: &PixelateShaders,
        image: &Image,
        grid: &BlockGrid,
        uniforms: &[u8],
        dither_table: &[u32],
        has_palette: bool,
    ) -> Result<Vec<u8>, CascadeError> {
        let device = &self.context.device;
        let queue = &self.context.queue;
        let limits = device.limits();
        let max_dimension = limits.max_texture_dimension_2d;
        if image.width > max_dimension || image.height > max_dimension {
            return Err(CascadeError::ImageTooLarge {
                width: image.width,
                height: image.height,
                max: max_dimension,
            });
        }
        let padded_bytes_per_row = align_to(grid.columns * 4, wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let readback_size = u64::from(padded_bytes_per_row) * u64::from(grid.rows);
        if readback_size > limits.max_buffer_size {
            return Err(CascadeError::Other(format!(
                "Pixelate readback of {readback_size} bytes exceeds the GPU buffer limit of {} bytes",
                limits.max_buffer_size
            )));
        }

        let input_texture = create_storage_texture(
            device,
            image.width,
            image.height,
            wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_DST,
        );
        upload_image(queue, &input_texture, image)?;
        let input_view = input_texture.create_view(&wgpu::TextureViewDescriptor::default());

        let block_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Pixelate Blocks"),
            size: wgpu::Extent3d {
                width: grid.columns,
                height: grid.rows,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Uint,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let block_view = block_texture.create_view(&wgpu::TextureViewDescriptor::default());

        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Pixelate Params"),
            size: uniforms.len() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&uniform_buffer, 0, uniforms);
        let uniform_binding = wgpu::BindingResource::Buffer(wgpu::BufferBinding {
            buffer: &uniform_buffer,
            offset: 0,
            size: NonZeroU64::new(uniforms.len() as u64),
        });

        let lut_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Pixelate LUT"),
            size: u64::from(LUT_ENTRIES) * 4,
            usage: wgpu::BufferUsages::STORAGE,
            mapped_at_creation: false,
        });
        let dither_bytes: Vec<u8> = dither_table
            .iter()
            .flat_map(|bucket| bucket.to_le_bytes())
            .collect();
        let dither_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Pixelate Dither Buckets"),
            size: dither_bytes.len() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&dither_buffer, 0, &dither_bytes);

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Pixelate Encoder"),
        });

        if has_palette {
            let pipeline = self.pipeline(
                shaders.lut_key,
                "Pixelate LUT Pipeline",
                &shaders.lut_wgsl,
                &[uniform_layout_entry(0), storage_buffer_layout_entry(1)],
            );
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Pixelate LUT BindGroup"),
                layout: &pipeline.bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: uniform_binding.clone(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: lut_buffer.as_entire_binding(),
                    },
                ],
            });
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Pixelate LUT Pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&pipeline.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups(LUT_ENTRIES.div_ceil(LUT_WORKGROUP_SIZE), 1, 1);
        }

        {
            let pipeline = self.pipeline(
                shaders.block_key,
                "Pixelate Block Pipeline",
                &shaders.block_wgsl,
                &[
                    uniform_layout_entry(0),
                    storage_buffer_layout_entry(1),
                    storage_texture_layout_entry(
                        2,
                        wgpu::StorageTextureAccess::ReadOnly,
                        wgpu::TextureFormat::Rgba16Float,
                    ),
                    storage_texture_layout_entry(
                        3,
                        wgpu::StorageTextureAccess::WriteOnly,
                        wgpu::TextureFormat::Rgba8Uint,
                    ),
                    storage_buffer_layout_entry(4),
                ],
            );
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Pixelate Block BindGroup"),
                layout: &pipeline.bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: uniform_binding,
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: lut_buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::TextureView(&input_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: wgpu::BindingResource::TextureView(&block_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 4,
                        resource: dither_buffer.as_entire_binding(),
                    },
                ],
            });
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Pixelate Block Pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&pipeline.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups(
                grid.columns.div_ceil(BLOCK_WORKGROUP_SIZE),
                grid.rows.div_ceil(BLOCK_WORKGROUP_SIZE),
                1,
            );
        }

        let readback = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Pixelate Readback"),
            size: readback_size,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &block_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &readback,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(grid.rows),
                },
            },
            wgpu::Extent3d {
                width: grid.columns,
                height: grid.rows,
                depth_or_array_layers: 1,
            },
        );
        queue.submit(Some(encoder.finish()));

        let slice = readback.slice(..);
        let (sender, receiver) = flume::bounded(1);
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });
        device.poll(wgpu::Maintain::Wait);
        receiver
            .recv_async()
            .await
            .map_err(|e| CascadeError::Other(format!("Pixelate readback receive error: {e}")))?
            .map_err(|e| CascadeError::Other(format!("Pixelate readback map error: {e:?}")))?;

        let row_bytes = grid.columns as usize * 4;
        let mut codes = Vec::with_capacity(row_bytes * grid.rows as usize);
        {
            let mapped = slice.get_mapped_range();
            for row in mapped.chunks_exact(padded_bytes_per_row as usize) {
                codes.extend_from_slice(&row[..row_bytes]);
            }
        }
        readback.unmap();
        Ok(codes)
    }
}

impl Node for GpuPixelateNode {
    fn spec(&self) -> NodeSpec {
        self.spec.clone()
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let settings = PixelateSettings::from_context(ctx)?;
            let palette = ctx
                .get_optional_input_image("palette")
                .map(extract_palette)
                .unwrap_or_default();

            let output = if image.width == 0 || image.height == 0 {
                image.clone()
            } else {
                let shaders = self
                    .shaders
                    .as_ref()
                    .map_err(|err| CascadeError::Other(err.clone()))?;
                let encoding = ChannelEncoding::of(image);
                let grid = BlockGrid::new(image.width, image.height, settings.pixel_size);
                let uniforms = uniform_bytes(&grid, &settings, &palette, encoding);
                let dither_table = dither_buckets(settings.matrix_size, settings.strength);
                let block_codes = self
                    .render_block_codes(
                        shaders,
                        image,
                        &grid,
                        &uniforms,
                        &dither_table,
                        !palette.is_empty(),
                    )
                    .await?;
                let data = expand_blocks(&block_codes, &grid, encoding)?;
                Image::new_with_domain(
                    image.format.clone(),
                    image.data_window,
                    data,
                    image.color_space.clone(),
                )?
            };

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

fn pixelate_spec() -> NodeSpec {
    NodeSpec {
        id: PIXELATE_NODE_ID.to_string(),
        display_name: "Pixelate".to_string(),
        category: "Filter".to_string(),
        description: "Average the image into square blocks, then optionally snap each block to \
                      the connected palette with ordered (Bayer) dithering"
            .to_string(),
        inputs: vec![
            PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            },
            PortSpec {
                name: "palette".to_string(),
                label: "Palette".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            },
        ],
        outputs: vec![PortSpec {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: ValueType::Image,
            ..Default::default()
        }],
        params: vec![
            ParamSpec {
                key: "pixel_size".to_string(),
                label: "Pixel Size".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(8),
                min: Some(1.0),
                max: Some(MAX_PIXEL_SIZE as f64),
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
                promotable: true,
            },
            ParamSpec {
                key: "dither_matrix".to_string(),
                label: "Dither Matrix".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(1),
                min: Some(0.0),
                max: Some((DITHER_MATRIX_SIZES.len() - 1) as f64),
                step: Some(1.0),
                ui_hint: UiHint::Dropdown(
                    DITHER_MATRIX_OPTIONS
                        .iter()
                        .map(|option| option.to_string())
                        .collect(),
                ),
                promotable: true,
            },
            ParamSpec {
                key: "dither_strength".to_string(),
                label: "Dither Strength".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(0.5),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.05),
                ui_hint: UiHint::Slider,
                promotable: true,
            },
        ],
    }
}

struct PixelateSettings {
    /// Block edge in pixels at the current preview scale.
    pixel_size: u32,
    /// Bayer matrix edge: 2, 4 or 8.
    matrix_size: usize,
    /// Reference dithering strength in [0, 1]; 0 is plain nearest-color quantization.
    strength: f64,
}

impl PixelateSettings {
    fn from_context(ctx: &EvalContext) -> Result<Self, CascadeError> {
        let requested = ctx.get_param_int("pixel_size")?;
        // Same rounding as `KernelManifest::pixel_space_params`, so previews stay proportional.
        let scaled = if ctx.preview_scale < 1.0 {
            ((requested as f32 * ctx.preview_scale).round() as i64).max(1)
        } else {
            requested
        };
        let matrix_index = ctx
            .get_param_int("dither_matrix")?
            .clamp(0, DITHER_MATRIX_SIZES.len() as i64 - 1) as usize;
        Ok(Self {
            pixel_size: scaled.clamp(1, MAX_PIXEL_SIZE) as u32,
            matrix_size: DITHER_MATRIX_SIZES[matrix_index],
            strength: normalize_strength(ctx.get_param_float("dither_strength")?),
        })
    }
}

/// Clamp to [0, 1] and round to 3 decimals, as the reference slider does
/// (`Math.round(stepped * 1000) / 1000`). Cascade's slider snaps with `round(v / step) * step`,
/// so 15% arrives as `0.15000000000000002`; normalizing hands the dither math the same double
/// (`0.15`) the reference uses.
fn normalize_strength(strength: f64) -> f64 {
    (strength.clamp(0.0, 1.0) * 1000.0).round() / 1000.0
}

/// Block tiling of an image, anchored at its top-left pixel.
struct BlockGrid {
    width: u32,
    height: u32,
    block: u32,
    columns: u32,
    rows: u32,
}

impl BlockGrid {
    fn new(width: u32, height: u32, block: u32) -> Self {
        Self {
            width,
            height,
            block,
            columns: width.div_ceil(block),
            rows: height.div_ceil(block),
        }
    }
}

/// How an image's stored channel values map to 8-bit sRGB codes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ChannelEncoding {
    /// Linear-light sRGB/Rec.709 (the working space Load Image and Color Palette produce).
    Linear,
    /// Already sRGB-encoded values (images tagged with the `sRGB` color space).
    Srgb,
}

impl ChannelEncoding {
    fn of(image: &Image) -> Self {
        if image.color_space.as_str() == ColorSpaceId::SRGB {
            Self::Srgb
        } else {
            Self::Linear
        }
    }

    fn encode(self, value: f32) -> u8 {
        match self {
            Self::Linear => linear_to_srgb_code(value),
            Self::Srgb => unit_to_code(value),
        }
    }

    fn decode(self, code: u8) -> f32 {
        match self {
            Self::Linear => srgb_code_to_linear(code),
            Self::Srgb => f32::from(code) / 255.0,
        }
    }
}

/// Quantize a `[0, 1]` value to an 8-bit code, rounding halves up like `Math.round`.
fn unit_to_code(value: f32) -> u8 {
    (f64::from(value).clamp(0.0, 1.0) * 255.0 + 0.5).floor() as u8
}

/// Encode a linear-light value with the sRGB transfer function as an 8-bit code.
fn linear_to_srgb_code(value: f32) -> u8 {
    let linear = f64::from(value).clamp(0.0, 1.0);
    let encoded = if linear <= 0.003_130_8 {
        linear * 12.92
    } else {
        1.055 * linear.powf(1.0 / 2.4) - 0.055
    };
    (encoded.clamp(0.0, 1.0) * 255.0 + 0.5).floor() as u8
}

/// Decode an 8-bit sRGB code to linear light. Uses the same `f32` formula as Load Image's
/// decode table, so output codes round-trip bit-identically through the rest of the graph.
fn srgb_code_to_linear(code: u8) -> f32 {
    static TABLE: OnceLock<[f32; 256]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [0.0f32; 256];
        for (index, entry) in table.iter_mut().enumerate() {
            let value = index as f32 / 255.0;
            *entry = if value <= 0.04045 {
                value / 12.92
            } else {
                ((value + 0.055) / 1.055).powf(2.4)
            };
        }
        table
    })[usize::from(code)]
}

/// Extract a palette from a strip image exactly like the reference `extractPaletteFromStrip`:
/// scan row-major, skip pixels with alpha < 128, keep unique colors in first-seen order, drop
/// colors closer than 10 (Euclidean, in 8-bit sRGB) to an already-kept color, then sample evenly
/// down to 256 colors.
fn extract_palette(image: &Image) -> Vec<[u8; 3]> {
    let encoding = ChannelEncoding::of(image);
    let mut seen = AHashSet::new();
    let mut unique = Vec::new();
    for pixel in image.data.chunks_exact(4) {
        if unit_to_code(pixel[3]) < PALETTE_ALPHA_THRESHOLD {
            continue;
        }
        let color = [
            encoding.encode(pixel[0]),
            encoding.encode(pixel[1]),
            encoding.encode(pixel[2]),
        ];
        if seen.insert(color) {
            unique.push(color);
        }
    }
    sample_colors(deduplicate_colors(&unique), MAX_PALETTE_COLORS)
}

/// Reference `deduplicateColors`: keep a color unless an already-kept color is closer than
/// `MIN_PALETTE_COLOR_DIFFERENCE`. Kept colors are bucketed into cells of that size, so each check
/// only scans the 27 surrounding cells (a match within the radius differs by at most one cell per
/// axis). That gives the reference's result without its quadratic scan on large palette images.
fn deduplicate_colors(colors: &[[u8; 3]]) -> Vec<[u8; 3]> {
    const CELL: usize = MIN_PALETTE_COLOR_DIFFERENCE as usize;
    const CELLS_PER_AXIS: usize = 255 / CELL + 1;
    let min_distance_sq = MIN_PALETTE_COLOR_DIFFERENCE * MIN_PALETTE_COLOR_DIFFERENCE;
    let cell_index = |r: usize, g: usize, b: usize| (r * CELLS_PER_AXIS + g) * CELLS_PER_AXIS + b;
    let neighbors = |cell: usize| -> RangeInclusive<usize> {
        cell.saturating_sub(1)..=(cell + 1).min(CELLS_PER_AXIS - 1)
    };

    let mut cells: AHashMap<usize, Vec<[u8; 3]>> = AHashMap::new();
    let mut kept = Vec::new();
    for &color in colors {
        let [r, g, b] = color.map(|channel| usize::from(channel) / CELL);
        let is_duplicate = neighbors(r).any(|nr| {
            neighbors(g).any(|ng| {
                neighbors(b).any(|nb| {
                    cells.get(&cell_index(nr, ng, nb)).is_some_and(|bucket| {
                        bucket
                            .iter()
                            .any(|&existing| color_distance_sq(existing, color) < min_distance_sq)
                    })
                })
            })
        });
        if !is_duplicate {
            cells.entry(cell_index(r, g, b)).or_default().push(color);
            kept.push(color);
        }
    }
    kept
}

fn color_distance_sq(a: [u8; 3], b: [u8; 3]) -> i32 {
    a.iter()
        .zip(b)
        .map(|(&a, b)| {
            let delta = i32::from(a) - i32::from(b);
            delta * delta
        })
        .sum()
}

/// Reference `sampleColors`: pick `count` colors at `floor(i · len / count)`.
fn sample_colors(colors: Vec<[u8; 3]>, count: usize) -> Vec<[u8; 3]> {
    if colors.len() <= count {
        return colors;
    }
    let step = colors.len() as f64 / count as f64;
    let last = colors.len() - 1;
    (0..count)
        .map(|i| colors[((i as f64 * step).floor() as usize).min(last)])
        .collect()
}

fn bayer_matrix(size: usize) -> &'static [u8] {
    match size {
        2 => &BAYER_2X2,
        4 => &BAYER_4X4,
        _ => &BAYER_8X8,
    }
}

/// LUT bucket (`0..32`) for every (Bayer cell, 8-bit channel value) pair of a `size`×`size`
/// matrix, indexed `cell * 256 + value` with cells row-major.
///
/// The reference adds `offset = bayer[cell] · (strength · 64)` — where `bayer[cell]` is the
/// `Float32Array` entry `rank / n² − 0.5` — to each channel in JavaScript doubles, clamps to
/// [0, 255] and quantizes with `>> 3`. The rounding of `value + offset` can depend on the value's
/// magnitude when the offset is a hair below an integer, so rather than approximating it on the
/// GPU, every outcome is computed here with the same `f64` operations.
fn dither_buckets(size: usize, strength: f64) -> Vec<u32> {
    let cells = size * size;
    let spread = strength * 64.0;
    let mut table = Vec::with_capacity(cells * DITHER_TABLE_STRIDE);
    for &rank in &bayer_matrix(size)[..cells] {
        let threshold = f64::from((f64::from(rank) / cells as f64 - 0.5) as f32);
        let offset = threshold * spread;
        table.extend((0..DITHER_TABLE_STRIDE).map(|value| {
            // `as u32` truncates like JavaScript's `>> 3` (ToInt32) on the clamped value.
            ((value as f64 + offset).clamp(0.0, 255.0) as u32) >> 3
        }));
    }
    table
}

/// Little-endian bytes of the shaders' std140 `Params` block (every member is an `ivec4`).
fn uniform_bytes(
    grid: &BlockGrid,
    settings: &PixelateSettings,
    palette: &[[u8; 3]],
    encoding: ChannelEncoding,
) -> Vec<u8> {
    let mut words: Vec<i32> = Vec::with_capacity(UNIFORM_WORDS);
    words.extend([
        grid.width as i32,
        grid.height as i32,
        grid.columns as i32,
        grid.rows as i32,
    ]);
    words.extend([
        grid.block as i32,
        palette.len().min(MAX_PALETTE_COLORS) as i32,
        settings.matrix_size as i32,
        i32::from(encoding == ChannelEncoding::Srgb),
    ]);
    for slot in 0..MAX_PALETTE_COLORS {
        let [r, g, b] = palette.get(slot).copied().unwrap_or_default();
        words.extend([i32::from(r), i32::from(g), i32::from(b), 0]);
    }
    words.iter().flat_map(|word| word.to_le_bytes()).collect()
}

/// Fill the full-resolution output from per-block RGBA codes.
fn expand_blocks(
    block_codes: &[u8],
    grid: &BlockGrid,
    encoding: ChannelEncoding,
) -> Result<Vec<f32>, CascadeError> {
    let columns = grid.columns as usize;
    let expected = columns * grid.rows as usize * 4;
    if block_codes.len() != expected {
        return Err(CascadeError::InvalidImageData {
            expected,
            got: block_codes.len(),
        });
    }
    let width = grid.width as usize;
    let block = grid.block as usize;
    let mut data = vec![0.0f32; width * grid.height as usize * 4];
    if width == 0 {
        return Ok(data);
    }

    let colors: Vec<[f32; 4]> = block_codes
        .chunks_exact(4)
        .map(|code| {
            [
                encoding.decode(code[0]),
                encoding.decode(code[1]),
                encoding.decode(code[2]),
                f32::from(code[3]) / 255.0,
            ]
        })
        .collect();
    data.par_chunks_exact_mut(width * 4)
        .enumerate()
        .for_each(|(y, row)| {
            let start = (y / block) * columns;
            let block_row = &colors[start..start + columns];
            for (x, pixel) in row.chunks_exact_mut(4).enumerate() {
                pixel.copy_from_slice(&block_row[x / block]);
            }
        });
    Ok(data)
}

struct PixelateShaders {
    lut_wgsl: String,
    block_wgsl: String,
    lut_key: u64,
    block_key: u64,
}

fn build_shaders() -> Result<PixelateShaders, String> {
    let lut_wgsl = glsl_to_wgsl(&format!("#version 450\n{PARAMS_GLSL}\n{LUT_GLSL}"))?;
    let block_wgsl = glsl_to_wgsl(&format!("#version 450\n{PARAMS_GLSL}\n{BLOCK_GLSL}"))?;
    Ok(PixelateShaders {
        lut_key: pipeline_key("pixelate_lut", &lut_wgsl),
        block_key: pipeline_key("pixelate_block", &block_wgsl),
        lut_wgsl,
        block_wgsl,
    })
}

fn pipeline_key(label: &str, wgsl: &str) -> u64 {
    let mut hasher = AHasher::default();
    hasher.write(label.as_bytes());
    hasher.write(wgsl.as_bytes());
    hasher.finish()
}

fn uniform_layout_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn storage_buffer_layout_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only: false },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn storage_texture_layout_entry(
    binding: u32,
    access: wgpu::StorageTextureAccess,
    format: wgpu::TextureFormat,
) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::StorageTexture {
            access,
            format,
            view_dimension: wgpu::TextureViewDimension::D2,
        },
        count: None,
    }
}

/// Uniforms shared by both passes. Must match `uniform_bytes`.
const PARAMS_GLSL: &str = r#"
layout(std140, set = 0, binding = 0) uniform Params {
    ivec4 dims;   // x: width, y: height, z: block columns, w: block rows
    ivec4 config; // x: block size, y: palette size, z: Bayer size, w: input is sRGB-encoded
    ivec4 palette[256];
};

layout(std430, set = 0, binding = 1) buffer Lut {
    uint lut[];
};
"#;

/// Pass 1: for each of the 32³ buckets, the index of the palette color nearest to the bucket
/// center `q * 8 + 4` (reference `buildColorLUT`; the first minimum wins).
const LUT_GLSL: &str = r#"
layout(local_size_x = 64) in;

void main() {
    uint index = gl_GlobalInvocationID.x;
    if (index >= 32768u) {
        return;
    }
    ivec3 center = ivec3(int(index / 1024u), int((index / 32u) % 32u), int(index % 32u)) * 8 + 4;
    int best_distance = 2147483647;
    uint best_index = 0u;
    for (int i = 0; i < config.y; i++) {
        ivec3 delta = center - palette[i].rgb;
        int distance = 2 * delta.r * delta.r + 4 * delta.g * delta.g + 3 * delta.b * delta.b;
        if (distance < best_distance) {
            best_distance = distance;
            best_index = uint(i);
        }
    }
    lut[index] = best_index;
}
"#;

/// Pass 2: one invocation per block. Averages the block's 8-bit sRGB codes with `Math.round`
/// semantics, then (with a palette) maps each channel through its Bayer cell's dither buckets and
/// looks up the LUT.
const BLOCK_GLSL: &str = r#"
layout(set = 0, binding = 2, rgba16f) uniform readonly image2D u_input;
layout(set = 0, binding = 3, rgba8ui) uniform writeonly uimage2D u_blocks;

layout(std430, set = 0, binding = 4) buffer Dither {
    uint dither_buckets[]; // [cell * 256 + channel value] -> LUT bucket
};

layout(local_size_x = 16, local_size_y = 16) in;

int unit_to_code(float value) {
    return int(floor(clamp(value, 0.0, 1.0) * 255.0 + 0.5));
}

int linear_to_code(float value) {
    float linear = clamp(value, 0.0, 1.0);
    float encoded = linear <= 0.0031308
        ? linear * 12.92
        : 1.055 * pow(linear, 1.0 / 2.4) - 0.055;
    return unit_to_code(encoded);
}

ivec4 texel_codes(vec4 texel) {
    if (config.w == 1) {
        return ivec4(
            unit_to_code(texel.r),
            unit_to_code(texel.g),
            unit_to_code(texel.b),
            unit_to_code(texel.a)
        );
    }
    return ivec4(
        linear_to_code(texel.r),
        linear_to_code(texel.g),
        linear_to_code(texel.b),
        unit_to_code(texel.a)
    );
}

void main() {
    ivec2 cell = ivec2(gl_GlobalInvocationID.xy);
    if (cell.x >= dims.z || cell.y >= dims.w) {
        return;
    }

    int block = config.x;
    ivec2 origin = cell * block;
    ivec2 limit = min(origin + ivec2(block), dims.xy);
    ivec4 sum = ivec4(0);
    for (int y = origin.y; y < limit.y; y++) {
        for (int x = origin.x; x < limit.x; x++) {
            sum += texel_codes(imageLoad(u_input, ivec2(x, y)));
        }
    }
    ivec2 extent = limit - origin;
    int count = extent.x * extent.y;
    // Math.round(sum / count) for non-negative integers.
    ivec4 average = (sum * 2 + count) / (count * 2);

    ivec3 rgb = average.rgb;
    if (config.y > 0) {
        int size = config.z;
        int row = ((cell.y % size) * size + (cell.x % size)) * 256;
        uint bucket_r = dither_buckets[row + rgb.r];
        uint bucket_g = dither_buckets[row + rgb.g];
        uint bucket_b = dither_buckets[row + rgb.b];
        uint palette_index = lut[bucket_r * 1024u + bucket_g * 32u + bucket_b];
        rgb = palette[palette_index].rgb;
    }
    imageStore(u_blocks, cell, uvec4(uvec3(rgb), uint(average.a)));
}
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use cascade_core::color::BuiltinColorManagement;
    use cascade_core::types::{Format, FrameTime, ParamValue, RectI};

    const SLSO8: &[[u8; 3]] = &[
        [0x0d, 0x2b, 0x45],
        [0x20, 0x3c, 0x56],
        [0x54, 0x4e, 0x68],
        [0x8d, 0x69, 0x7a],
        [0xd0, 0x81, 0x59],
        [0xff, 0xaa, 0x5e],
        [0xff, 0xd4, 0xa3],
        [0xff, 0xec, 0xd6],
    ];
    const TWILIGHT5: &[[u8; 3]] = &[
        [0xfb, 0xbb, 0xad],
        [0xee, 0x86, 0x95],
        [0x4a, 0x7a, 0x96],
        [0x33, 0x3f, 0x58],
        [0x29, 0x28, 0x31],
    ];
    const NONE: &[[u8; 3]] = &[];

    /// Reference processing options. `block == 1` is the reference with pixelation disabled;
    /// `dither == false` is the reference with dithering disabled.
    #[derive(Clone, Copy, Debug)]
    struct Case<'a> {
        block: usize,
        matrix: usize,
        strength: f64,
        dither: bool,
        palette: &'a [[u8; 3]],
    }

    const fn case(
        block: usize,
        matrix: usize,
        strength: f64,
        palette: &'static [[u8; 3]],
        dither: bool,
    ) -> Case<'static> {
        Case {
            block,
            matrix,
            strength,
            dither,
            palette,
        }
    }

    // Golden vectors produced by running the deployed reference worker bundle
    // (zac.is-a.dev/pixelate/assets/imageProcessor.worker-CVNuKRmo.js, source commit efe80c9)
    // in Node on `lcg_codes` inputs; see crates/cascade-gpu/testdata/pixelate-golden.mjs.
    const GOLDEN_9X7: [(u32, Case<'static>, &str); 6] = [
        (
            1,
            case(4, 4, 0.5, SLSO8, true),
            concat!(
                "8d697ade8d697ade8d697ade8d697ade8d697ab88d697ab88d697ab88d697ab8d08159f68d697ade8d697ade8d697ade",
                "8d697ade8d697ab88d697ab88d697ab88d697ab8d08159f68d697ade8d697ade8d697ade8d697ade8d697ab88d697ab8",
                "8d697ab88d697ab8d08159f68d697ade8d697ade8d697ade8d697ade8d697ab88d697ab88d697ab88d697ab8d08159f6",
                "8d697ad68d697ad68d697ad68d697ad68d697ad78d697ad78d697ad78d697ad7ffd4a3ff8d697ad68d697ad68d697ad6",
                "8d697ad68d697ad78d697ad78d697ad78d697ad7ffd4a3ff8d697ad68d697ad68d697ad68d697ad68d697ad78d697ad7",
                "8d697ad78d697ad7ffd4a3ff",
            ),
        ),
        (
            2,
            case(1, 8, 0.35, TWILIGHT5, true),
            concat!(
                "333f58ff292831ff4a7a966cfbbbadff4a7a96fffbbbadff292831944a7a96ff4a7a96ff4a7a96fffbbbadff4a7a96ff",
                "ee8695ff333f58ff4a7a96fffbbbadff4a7a96ffee8695ff4a7a9634ee8695ff4a7a96ffee8695484a7a96ff4a7a96ff",
                "ee8695ff4a7a96ff4a7a96ff4a7a96fffbbbad28ee8695ff4a7a96ffee8695fffbbbadff4a7a96ff292831ff4a7a96ff",
                "fbbbadff4a7a96ffee86959c4a7a96644a7a96fffbbbadff4a7a96fffbbbadff333f58fffbbbadd84a7a96ffee869580",
                "fbbbadffee8695ff4a7a96ffee8695ff333f58ff333f58ac4a7a96ff4a7a9674fbbbadff4a7a96ff4a7a96104a7a96ff",
                "4a7a96ffee8695ff4a7a9630",
            ),
        ),
        (
            3,
            case(3, 4, 0.5, SLSO8, false),
            concat!(
                "8d697ae38d697ae38d697ae38d697ae68d697ae68d697ae68d697aff8d697aff8d697aff8d697ae38d697ae38d697ae3",
                "8d697ae68d697ae68d697ae68d697aff8d697aff8d697aff8d697ae38d697ae38d697ae38d697ae68d697ae68d697ae6",
                "8d697aff8d697aff8d697aff8d697ac38d697ac38d697ac38d697ad78d697ad78d697ad78d697ac28d697ac28d697ac2",
                "8d697ac38d697ac38d697ac38d697ad78d697ad78d697ad78d697ac28d697ac28d697ac28d697ac38d697ac38d697ac3",
                "8d697ad78d697ad78d697ad78d697ac28d697ac28d697ac28d697afb8d697afb8d697afb8d697ace8d697ace8d697ace",
                "544e68ea544e68ea544e68ea",
            ),
        ),
        (
            4,
            case(2, 4, 0.5, NONE, true),
            concat!(
                "1e9682b01e9682b083a6c7ff83a6c7ff3f9f48c23f9f48c2ac685ad2ac685ad245cf87ff1e9682b01e9682b083a6c7ff",
                "83a6c7ff3f9f48c23f9f48c2ac685ad2ac685ad245cf87ffc1a176eac1a176eaabc292ffabc292ffa08544b5a08544b5",
                "687887c0687887c024a133ffc1a176eac1a176eaabc292ffabc292ffa08544b5a08544b5687887c0687887c024a133ff",
                "585051d7585051d73a8b768f3a8b768f778f7cff778f7cff93a96bff93a96bff615e8bff585051d7585051d73a8b768f",
                "3a8b768f778f7cff778f7cff93a96bff93a96bff615e8bffe8d3deffe8d3deff6ab971ff6ab971ff8a81b4ff8a81b4ff",
                "c87e67c4c87e67c440d0bbff",
            ),
        ),
        (
            5,
            case(2, 2, 1.0, TWILIGHT5, true),
            concat!(
                "333f58f7333f58f7333f58cd333f58cd333f58d3333f58d34a7a96fa4a7a96fa333f58fa333f58f7333f58f7333f58cd",
                "333f58cd333f58d3333f58d34a7a96fa4a7a96fa333f58fa4a7a96ce4a7a96ce4a7a96ff4a7a96ff4a7a96c84a7a96c8",
                "4a7a96c84a7a96c84a7a96c44a7a96ce4a7a96ce4a7a96ff4a7a96ff4a7a96c84a7a96c84a7a96c84a7a96c84a7a96c4",
                "333f58ff333f58ff333f58af333f58af4a7a96d24a7a96d24a7a96ff4a7a96ff333f58fa333f58ff333f58ff333f58af",
                "333f58af4a7a96d24a7a96d24a7a96ff4a7a96ff333f58fa4a7a96ff4a7a96ff4a7a96ff4a7a96ff4a7a96ff4a7a96ff",
                "333f58ff333f58ff4a7a96ff",
            ),
        ),
        (
            6,
            case(5, 8, 0.75, SLSO8, true),
            concat!(
                "8d697ac08d697ac08d697ac08d697ac08d697ac08d697af58d697af58d697af58d697af58d697ac08d697ac08d697ac0",
                "8d697ac08d697ac08d697af58d697af58d697af58d697af58d697ac08d697ac08d697ac08d697ac08d697ac08d697af5",
                "8d697af58d697af58d697af58d697ac08d697ac08d697ac08d697ac08d697ac08d697af58d697af58d697af58d697af5",
                "8d697ac08d697ac08d697ac08d697ac08d697ac08d697af58d697af58d697af58d697af5544e68cc544e68cc544e68cc",
                "544e68cc544e68cc544e68e1544e68e1544e68e1544e68e1544e68cc544e68cc544e68cc544e68cc544e68cc544e68e1",
                "544e68e1544e68e1544e68e1",
            ),
        ),
    ];

    /// FNV-1a 64 hashes of the reference output for a 37×29 `lcg_codes(.., 42)` image.
    const GOLDEN_37X29_SEED: u32 = 42;
    const GOLDEN_37X29: [(Case<'static>, u64); 11] = [
        (case(1, 2, 0.5, SLSO8, true), 0x1d27efc3bd116089),
        (case(1, 4, 1.0, TWILIGHT5, true), 0x70e8b8ab08dd2f4b),
        (case(1, 8, 0.05, SLSO8, true), 0xb17a4268154a9186),
        (case(2, 8, 0.65, SLSO8, true), 0x007e822b8bf3530e),
        (case(3, 4, 0.25, TWILIGHT5, true), 0x70a61e976830c506),
        (case(4, 8, 0.9, SLSO8, true), 0xff396d886511d366),
        (case(6, 2, 0.4, TWILIGHT5, true), 0x7c52a8a49cc1ba27),
        (case(7, 4, 0.5, SLSO8, false), 0x02cf59039741f8d8),
        (case(8, 4, 0.5, SLSO8, true), 0xa45a40dd6e777cab),
        (case(3, 8, 0.0, TWILIGHT5, true), 0x23aafa2fdb5122ec),
        (case(5, 4, 0.5, NONE, true), 0x7654d92d9eadb8a1),
    ];

    /// Deterministic RGBA codes; mirrors `makeImage` in the golden generator.
    fn lcg_codes(width: usize, height: usize, seed: u32) -> Vec<u8> {
        let mut state = seed;
        let mut next = || {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (state >> 24) as u8
        };
        let mut codes = Vec::with_capacity(width * height * 4);
        for _ in 0..width * height {
            let (r, g, b, t) = (next(), next(), next(), next());
            codes.extend([r, g, b, if t < 64 { t * 4 } else { 255 }]);
        }
        codes
    }

    fn fnv1a64(bytes: &[u8]) -> u64 {
        bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, &byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
        })
    }

    fn hex_bytes(hex: &str) -> Vec<u8> {
        (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("valid hex"))
            .collect()
    }

    // ── Reference oracle ────────────────────────────────────────────────────────────────────
    // A line-by-line port of the deployed worker's `pixelate`, `buildColorLUT`,
    // `applyBayerDithering` and `quantizeToPalette`, using f64 wherever JavaScript uses doubles
    // (it deliberately does *not* use the integer-offset shortcut the shader relies on).

    fn reference_process(codes: &[u8], width: usize, height: usize, case: &Case) -> Vec<u8> {
        let mut data = codes.to_vec();
        if case.block > 1 {
            data = reference_pixelate(&data, width, height, case.block);
        }
        if !case.palette.is_empty() {
            let lut = reference_lut(case.palette);
            data = if case.dither {
                reference_dither(&data, width, case, &lut)
            } else {
                reference_quantize(&data, case.palette, &lut)
            };
        }
        data
    }

    fn reference_pixelate(data: &[u8], width: usize, height: usize, block: usize) -> Vec<u8> {
        let mut out = vec![0u8; data.len()];
        for block_y in (0..height).step_by(block) {
            for block_x in (0..width).step_by(block) {
                let bw = block.min(width - block_x);
                let bh = block.min(height - block_y);
                let count = (bw * bh) as f64;
                let mut sums = [0.0f64; 4];
                for y in block_y..block_y + bh {
                    for x in block_x..block_x + bw {
                        let idx = (y * width + x) * 4;
                        for (sum, &value) in sums.iter_mut().zip(&data[idx..idx + 4]) {
                            *sum += f64::from(value);
                        }
                    }
                }
                // Math.round == f64::round for non-negative values.
                let average = sums.map(|sum| (sum / count).round() as u8);
                for y in block_y..block_y + bh {
                    for x in block_x..block_x + bw {
                        let idx = (y * width + x) * 4;
                        out[idx..idx + 4].copy_from_slice(&average);
                    }
                }
            }
        }
        out
    }

    fn reference_lut(palette: &[[u8; 3]]) -> Vec<u8> {
        let mut table = vec![0u8; 32 * 32 * 32];
        for rq in 0..32i32 {
            for gq in 0..32i32 {
                for bq in 0..32i32 {
                    let center = [(rq << 3) + 4, (gq << 3) + 4, (bq << 3) + 4];
                    let mut min_dist = f64::INFINITY;
                    let mut nearest = 0;
                    for (i, color) in palette.iter().enumerate() {
                        let d = |c: usize| f64::from(center[c] - i32::from(color[c]));
                        let dist = 2.0 * d(0).powi(2) + 4.0 * d(1).powi(2) + 3.0 * d(2).powi(2);
                        if dist < min_dist {
                            min_dist = dist;
                            nearest = i;
                        }
                    }
                    table[((rq << 10) + (gq << 5) + bq) as usize] = nearest as u8;
                }
            }
        }
        table
    }

    fn reference_dither(data: &[u8], width: usize, case: &Case, lut: &[u8]) -> Vec<u8> {
        let n = case.matrix;
        // Float32Array of (rank / n² − 0.5), as in the worker.
        let matrix: Vec<f32> = bayer_matrix(n)
            .iter()
            .map(|&rank| (f64::from(rank) / (n * n) as f64 - 0.5) as f32)
            .collect();
        let spread = case.strength * 64.0;
        let mut out = vec![0u8; data.len()];
        for (i, (src, dst)) in data
            .chunks_exact(4)
            .zip(out.chunks_exact_mut(4))
            .enumerate()
        {
            let (x, y) = (i % width, i / width);
            let (block_x, block_y) = (x / case.block, y / case.block);
            let offset = f64::from(matrix[(block_y % n) * n + (block_x % n)]) * spread;
            let quantized = src[..3]
                .iter()
                .map(|&value| ((f64::from(value) + offset).clamp(0.0, 255.0) as i32) >> 3)
                .collect::<Vec<_>>();
            let color = case.palette[usize::from(
                lut[((quantized[0] << 10) + (quantized[1] << 5) + quantized[2]) as usize],
            )];
            dst[..3].copy_from_slice(&color);
            dst[3] = src[3];
        }
        out
    }

    fn reference_quantize(data: &[u8], palette: &[[u8; 3]], lut: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; data.len()];
        for (src, dst) in data.chunks_exact(4).zip(out.chunks_exact_mut(4)) {
            let [r, g, b] = [src[0], src[1], src[2]].map(|v| usize::from(v >> 3));
            dst[..3].copy_from_slice(&palette[usize::from(lut[(r << 10) + (g << 5) + b])]);
            dst[3] = src[3];
        }
        out
    }

    // ── Image helpers ───────────────────────────────────────────────────────────────────────

    fn codes_to_image(codes: &[u8], width: u32, height: u32) -> Image {
        let data = codes
            .chunks_exact(4)
            .flat_map(|c| {
                [
                    srgb_code_to_linear(c[0]),
                    srgb_code_to_linear(c[1]),
                    srgb_code_to_linear(c[2]),
                    f32::from(c[3]) / 255.0,
                ]
            })
            .collect();
        Image::from_f32_data(width, height, data).expect("test image")
    }

    fn image_to_codes(image: &Image) -> Vec<u8> {
        let encoding = ChannelEncoding::of(image);
        image
            .data
            .chunks_exact(4)
            .flat_map(|px| {
                [
                    encoding.encode(px[0]),
                    encoding.encode(px[1]),
                    encoding.encode(px[2]),
                    unit_to_code(px[3]),
                ]
            })
            .collect()
    }

    fn palette_strip(colors: &[[u8; 3]]) -> Image {
        let codes: Vec<u8> = colors
            .iter()
            .flat_map(|c| [c[0], c[1], c[2], 255])
            .collect();
        codes_to_image(&codes, colors.len() as u32, 1)
    }

    fn node_params(case: &Case) -> HashMap<String, ParamValue> {
        let matrix_index = DITHER_MATRIX_SIZES
            .iter()
            .position(|&size| size == case.matrix)
            .expect("supported matrix size");
        HashMap::from([
            ("pixel_size".to_string(), ParamValue::Int(case.block as i64)),
            (
                "dither_matrix".to_string(),
                ParamValue::Int(matrix_index as i64),
            ),
            (
                "dither_strength".to_string(),
                // The node has no dithering toggle: strength 0 is the reference's "dithering off".
                ParamValue::Float(if case.dither { case.strength } else { 0.0 }),
            ),
        ])
    }

    fn gpu_node() -> Option<GpuPixelateNode> {
        match GpuContext::new() {
            Ok(context) => Some(GpuPixelateNode::new(Arc::new(context))),
            Err(err) => {
                println!("GPU not available, skipping: {err}");
                None
            }
        }
    }

    fn evaluate(
        node: &GpuPixelateNode,
        image: Image,
        palette: Option<Image>,
        params: &HashMap<String, ParamValue>,
        preview_scale: f32,
    ) -> Image {
        let mut inputs = HashMap::from([("image".to_string(), Value::Image(image))]);
        if let Some(palette) = palette {
            inputs.insert("palette".to_string(), Value::Image(palette));
        }
        let color_management = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params,
            frame_time: FrameTime { frame: 0 },
            color_management: &color_management,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale,
        };
        let outputs = pollster::block_on(node.evaluate(&ctx)).expect("pixelate should evaluate");
        match outputs.get("image") {
            Some(Value::Image(image)) => image.clone(),
            other => panic!("expected image output, got {other:?}"),
        }
    }

    fn run_case(
        node: &GpuPixelateNode,
        codes: &[u8],
        width: u32,
        height: u32,
        case: &Case,
    ) -> Vec<u8> {
        let palette = (!case.palette.is_empty()).then(|| palette_strip(case.palette));
        let output = evaluate(
            node,
            codes_to_image(codes, width, height),
            palette,
            &node_params(case),
            1.0,
        );
        assert_eq!((output.width, output.height), (width, height));
        image_to_codes(&output)
    }

    // ── CPU tests (run everywhere, including CI without a GPU) ──────────────────────────────

    #[test]
    fn spec_mirrors_reference_controls() {
        let spec = pixelate_spec();
        assert_eq!(spec.id, "gpu_kernel::pixelate");
        assert_eq!(spec.category, "Filter");
        let inputs: Vec<_> = spec.inputs.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(inputs, ["image", "palette"]);
        let keys: Vec<_> = spec.params.iter().map(|p| p.key.as_str()).collect();
        assert_eq!(keys, ["pixel_size", "dither_matrix", "dither_strength"]);
        // Reference defaults: block size 8, 4x4 matrix, 50% strength.
        assert!(matches!(spec.params[0].default, ParamDefault::Int(8)));
        assert!(matches!(spec.params[1].default, ParamDefault::Int(1)));
        assert!(
            matches!(&spec.params[1].ui_hint, UiHint::Dropdown(options) if options == &["2x2", "4x4", "8x8"])
        );
        assert!(matches!(spec.params[2].default, ParamDefault::Float(v) if v == 0.5));
    }

    #[test]
    fn shaders_transpile_with_expected_bindings() {
        let shaders = build_shaders().expect("pixelate shaders should transpile");
        assert!(shaders.lut_wgsl.contains("var<storage, read_write>"));
        assert!(shaders.block_wgsl.contains("var<storage, read_write>"));
        assert!(shaders.block_wgsl.contains("rgba8uint"));
        assert!(shaders.block_wgsl.contains("rgba16float"));
        assert_ne!(shaders.lut_key, shaders.block_key);
    }

    #[test]
    fn uniform_layout_matches_params_block() {
        let grid = BlockGrid::new(10, 7, 4);
        let settings = PixelateSettings {
            pixel_size: 4,
            matrix_size: 4,
            strength: 0.5,
        };
        let bytes = uniform_bytes(&grid, &settings, SLSO8, ChannelEncoding::Srgb);
        assert_eq!(bytes.len(), UNIFORM_WORDS * 4);
        let word = |index: usize| {
            i32::from_le_bytes(bytes[index * 4..index * 4 + 4].try_into().expect("word"))
        };
        assert_eq!([word(0), word(1), word(2), word(3)], [10, 7, 3, 2]);
        assert_eq!([word(4), word(5), word(6), word(7)], [4, 8, 4, 1]);
        assert_eq!(
            [word(8), word(9), word(10), word(11)],
            [0x0d, 0x2b, 0x45, 0]
        );
        assert_eq!(word(8 + 8 * 4), 0, "unused palette slots are zeroed");
    }

    #[test]
    fn srgb_codes_round_trip_through_linear_and_f16() {
        for code in 0..=255u8 {
            let linear = srgb_code_to_linear(code);
            assert_eq!(linear_to_srgb_code(linear), code);
            // The GPU sees the input as rgba16f; codes must survive that rounding too.
            let half_precision = half::f16::from_f32(linear).to_f32();
            assert_eq!(linear_to_srgb_code(half_precision), code, "f16 round trip");
            assert_eq!(unit_to_code(f32::from(code) / 255.0), code);
            assert_eq!(
                unit_to_code(half::f16::from_f32(f32::from(code) / 255.0).to_f32()),
                code
            );
        }
        assert_eq!(linear_to_srgb_code(-1.0), 0);
        assert_eq!(linear_to_srgb_code(4.0), 255);
        assert_eq!(linear_to_srgb_code(f32::NAN), 0);
    }

    #[test]
    fn dither_buckets_follow_reference_offsets() {
        for size in DITHER_MATRIX_SIZES {
            assert_eq!(
                dither_buckets(size, 0.5).len(),
                size * size * DITHER_TABLE_STRIDE
            );
        }
        // 4x4 at 50%: offset = 2·rank − 16, so cell 0 (rank 0) shifts by −16, cell 1 (rank 8)
        // not at all, and cell 12 (rank 15) by +14.
        let table = dither_buckets(4, 0.5);
        let bucket = |cell: usize, value: usize| table[cell * DITHER_TABLE_STRIDE + value];
        assert_eq!(
            [bucket(0, 15), bucket(0, 16), bucket(0, 24), bucket(0, 255)],
            [0, 0, 1, 29]
        );
        assert_eq!([bucket(1, 7), bucket(1, 8), bucket(1, 255)], [0, 1, 31]);
        assert_eq!(
            [bucket(12, 0), bucket(12, 1), bucket(12, 2), bucket(12, 250)],
            [1, 1, 2, 31]
        );
        // Strength 0 is plain quantization (the reference with dithering disabled).
        let plain = dither_buckets(8, 0.0);
        assert!((0..64).all(|cell| (0..256).all(|v| plain[cell * 256 + v] == (v as u32 >> 3))));
    }

    #[test]
    fn dither_buckets_reproduce_javascript_double_rounding() {
        // 3 · 0.05 = 0.15000000000000002, so cell 8 of the 4x4 matrix (rank 3) gets the offset
        // −(3 + 2⁻⁵¹). Its floor is −4, but in doubles 11 + offset rounds to exactly 8.0, so
        // JavaScript puts value 11 in bucket 1, not the bucket 0 that 11 + floor(offset) gives.
        let table = dither_buckets(4, 3.0 * 0.05);
        assert_eq!(table[8 * DITHER_TABLE_STRIDE + 11], 1);
        assert_eq!(table[8 * DITHER_TABLE_STRIDE + 10], 0);
        let threshold = f64::from((3.0f64 / 16.0 - 0.5) as f32);
        let offset = threshold * (3.0 * 0.05 * 64.0);
        assert!(offset < -3.0 && 11.0 + offset == 8.0);
    }

    #[test]
    fn strength_is_normalized_like_the_reference_slider() {
        assert_eq!(normalize_strength(3.0 * 0.05), 0.15);
        assert_eq!(normalize_strength(7.0 * 0.05), 0.35);
        assert_eq!(normalize_strength(0.5), 0.5);
        assert_eq!(normalize_strength(-0.2), 0.0);
        assert_eq!(normalize_strength(1.7), 1.0);
        for step in 0..=20 {
            // Every value the reference slider can produce is a fixed point.
            let reference: f64 = format!("{:.2}", f64::from(step) * 0.05)
                .parse()
                .expect("decimal");
            assert_eq!(normalize_strength(reference), reference);
            assert_eq!(normalize_strength(f64::from(step) * 0.05), reference);
        }
    }

    #[test]
    fn extract_palette_matches_reference_strip() {
        // 4x3 strip from the golden generator: duplicates, near-duplicates, alpha 127/128/0.
        #[rustfmt::skip]
        let codes = [
            10, 20, 30, 255,   10, 20, 30, 255,   15, 24, 33, 255,   20, 20, 30, 255,
            200, 0, 0, 127,    200, 0, 0, 128,    0, 255, 0, 255,    6, 0, 0, 255,
            0, 0, 0, 255,      3, 4, 5, 255,      255, 255, 255, 0,  250, 250, 250, 255,
        ];
        let palette = extract_palette(&codes_to_image(&codes, 4, 3));
        assert_eq!(
            palette,
            [
                [10, 20, 30],
                [20, 20, 30],
                [200, 0, 0],
                [0, 255, 0],
                [6, 0, 0],
                [250, 250, 250]
            ]
        );
    }

    #[test]
    fn extract_palette_samples_large_palettes_like_reference() {
        let mut codes = Vec::new();
        'grid: for r in (0..256).step_by(12) {
            for g in (0..256).step_by(12) {
                for b in (0..256).step_by(12) {
                    if codes.len() == 300 * 4 {
                        break 'grid;
                    }
                    codes.extend([r as u8, g as u8, b as u8, 255]);
                }
            }
        }
        let palette = extract_palette(&codes_to_image(&codes, 300, 1));
        assert_eq!(palette.len(), 256);
        assert_eq!(fnv1a64(palette.as_flattened()), 0xfadf997b2c21e379);
        assert_eq!(
            [palette[0], palette[1], palette[255]],
            [[0, 0, 0], [0, 0, 12], [0, 156, 144]]
        );
    }

    #[test]
    fn extract_palette_reads_srgb_tagged_strips_as_codes() {
        let data = vec![0.2, 0.4, 0.6, 1.0, 1.0, 1.0, 1.0, 1.0];
        let strip =
            Image::from_f32_data_with_space(2, 1, data, ColorSpaceId::new(ColorSpaceId::SRGB))
                .expect("strip");
        assert_eq!(extract_palette(&strip), [[51, 102, 153], [255, 255, 255]]);
    }

    #[test]
    fn grid_deduplication_matches_reference_linear_scan() {
        fn reference_dedupe(colors: &[[u8; 3]]) -> Vec<[u8; 3]> {
            let mut result: Vec<[u8; 3]> = Vec::new();
            for &color in colors {
                if !result
                    .iter()
                    .any(|&kept| color_distance_sq(kept, color) < 100)
                {
                    result.push(color);
                }
            }
            result
        }
        for seed in 0..8 {
            // Clustered colors so many fall within the duplicate radius of each other.
            let colors: Vec<[u8; 3]> = lcg_codes(400, 1, seed)
                .chunks_exact(4)
                .map(|c| [c[0] / 4 + 96, c[1] / 4 + 96, c[2] / 4 + 96])
                .collect();
            assert_eq!(deduplicate_colors(&colors), reference_dedupe(&colors));
        }
    }

    #[test]
    fn reference_oracle_matches_deployed_worker_golden_vectors() {
        for (seed, case, expected) in GOLDEN_9X7 {
            let output = reference_process(&lcg_codes(9, 7, seed), 9, 7, &case);
            assert_eq!(output, hex_bytes(expected), "seed {seed}: {case:?}");
        }
        let codes = lcg_codes(37, 29, GOLDEN_37X29_SEED);
        for (case, expected) in GOLDEN_37X29 {
            let output = reference_process(&codes, 37, 29, &case);
            assert_eq!(fnv1a64(&output), expected, "{case:?}");
        }
    }

    #[test]
    fn expand_blocks_fills_partial_edge_blocks() {
        let grid = BlockGrid::new(3, 3, 2);
        #[rustfmt::skip]
        let codes = [
            255, 0, 0, 255,   0, 255, 0, 255,
            0, 0, 255, 128,   255, 255, 255, 0,
        ];
        let data = expand_blocks(&codes, &grid, ChannelEncoding::Srgb).expect("expand");
        let pixel = |x: usize, y: usize| &data[(y * 3 + x) * 4..(y * 3 + x) * 4 + 4];
        assert_eq!(pixel(1, 1), [1.0, 0.0, 0.0, 1.0]);
        assert_eq!(pixel(2, 0), [0.0, 1.0, 0.0, 1.0]);
        assert_eq!(pixel(0, 2), [0.0, 0.0, 1.0, 128.0 / 255.0]);
        assert_eq!(pixel(2, 2), [1.0, 1.0, 1.0, 0.0]);
        assert!(expand_blocks(&codes[..8], &grid, ChannelEncoding::Srgb).is_err());
    }

    // ── GPU tests (skip when no adapter is available) ───────────────────────────────────────

    #[test]
    fn gpu_matches_deployed_worker_golden_vectors() {
        let Some(node) = gpu_node() else { return };
        for (seed, case, expected) in GOLDEN_9X7 {
            let output = run_case(&node, &lcg_codes(9, 7, seed), 9, 7, &case);
            assert_eq!(output, hex_bytes(expected), "seed {seed}: {case:?}");
        }
        let codes = lcg_codes(37, 29, GOLDEN_37X29_SEED);
        for (case, expected) in GOLDEN_37X29 {
            assert_eq!(
                fnv1a64(&run_case(&node, &codes, 37, 29, &case)),
                expected,
                "{case:?}"
            );
        }
    }

    #[test]
    fn gpu_matches_reference_oracle_on_random_inputs() {
        let Some(node) = gpu_node() else { return };
        let mut state = 0x5eed_u32;
        let mut next = |bound: u32| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (state >> 8) % bound
        };
        for iteration in 0..24 {
            let width = 1 + next(70);
            let height = 1 + next(50);
            let block = match iteration % 4 {
                0 => 1,
                1 => 1 + next(12) as usize,
                2 => [16, 33, 64, 128][next(4) as usize],
                _ => 2 + next(30) as usize,
            };
            let palette_len = if iteration % 6 == 5 {
                0
            } else {
                1 + next(64) as usize
            };
            let palette: Vec<[u8; 3]> = lcg_codes(palette_len, 1, iteration)
                .chunks_exact(4)
                .map(|c| [c[0], c[1], c[2]])
                .collect();
            // The reference processes the palette as extracted from its strip.
            let extracted = extract_palette(&palette_strip(&palette));
            let case = Case {
                block,
                matrix: DITHER_MATRIX_SIZES[next(3) as usize],
                strength: f64::from(next(101)) / 100.0,
                dither: true,
                palette: &extracted,
            };
            let codes = lcg_codes(width as usize, height as usize, 1000 + iteration);
            let expected = reference_process(&codes, width as usize, height as usize, &case);
            let palette_image = (palette_len > 0).then(|| palette_strip(&palette));
            let output = evaluate(
                &node,
                codes_to_image(&codes, width, height),
                palette_image,
                &node_params(&case),
                1.0,
            );
            assert_eq!(
                image_to_codes(&output),
                expected,
                "iteration {iteration}: {width}x{height} {case:?}"
            );
        }
    }

    #[test]
    fn gpu_uses_reference_strength_for_slider_rounding_noise() {
        let Some(node) = gpu_node() else { return };
        let codes = lcg_codes(40, 30, 21);
        for step in [3, 7, 9, 11, 13, 17] {
            let noisy = f64::from(step) * 0.05;
            let reference: f64 = format!("{noisy:.2}").parse().expect("decimal");
            for matrix in DITHER_MATRIX_SIZES {
                let node_case = Case {
                    strength: noisy,
                    ..case(1, matrix, 0.0, TWILIGHT5, true)
                };
                let reference_case = Case {
                    strength: reference,
                    ..node_case
                };
                assert_eq!(
                    run_case(&node, &codes, 40, 30, &node_case),
                    reference_process(&codes, 40, 30, &reference_case),
                    "strength {noisy}, matrix {matrix}"
                );
            }
        }
    }

    #[test]
    fn gpu_preview_scale_scales_pixel_size() {
        let Some(node) = gpu_node() else { return };
        let codes = lcg_codes(24, 18, 7);
        let image = codes_to_image(&codes, 24, 18);
        let palette = palette_strip(SLSO8);
        let full = node_params(&case(8, 4, 0.5, SLSO8, true));
        let half = node_params(&case(4, 4, 0.5, SLSO8, true));
        let preview = evaluate(&node, image.clone(), Some(palette.clone()), &full, 0.5);
        let reference = evaluate(&node, image, Some(palette), &half, 1.0);
        assert_eq!(preview.data, reference.data);
    }

    #[test]
    fn gpu_preserves_image_domain() {
        let Some(node) = gpu_node() else { return };
        let codes = lcg_codes(8, 5, 9);
        let base = codes_to_image(&codes, 8, 5);
        let image = Image::new_with_domain(
            Format::from_dimensions(16, 10),
            RectI::from_dimensions(8, 5),
            base.data.as_ref().clone(),
            ColorSpaceId::default_working(),
        )
        .expect("domain image");
        let output = evaluate(
            &node,
            image,
            None,
            &node_params(&case(2, 4, 0.5, NONE, true)),
            1.0,
        );
        assert_eq!((output.width, output.height), (8, 5));
        assert_eq!((output.format.width(), output.format.height()), (16, 10));
        assert_eq!(output.data_window, RectI::from_dimensions(8, 5));
        assert_eq!(output.color_space, ColorSpaceId::default_working());
    }

    #[test]
    fn gpu_treats_srgb_tagged_input_as_encoded() {
        let Some(node) = gpu_node() else { return };
        let case = case(3, 8, 0.6, TWILIGHT5, true);
        let codes = lcg_codes(20, 14, 11);
        let encoded: Vec<f32> = codes.iter().map(|&code| f32::from(code) / 255.0).collect();
        let image =
            Image::from_f32_data_with_space(20, 14, encoded, ColorSpaceId::new(ColorSpaceId::SRGB))
                .expect("sRGB image");
        let output = evaluate(
            &node,
            image,
            Some(palette_strip(TWILIGHT5)),
            &node_params(&case),
            1.0,
        );
        assert_eq!(output.color_space.as_str(), ColorSpaceId::SRGB);
        assert_eq!(
            image_to_codes(&output),
            reference_process(&codes, 20, 14, &case)
        );
    }

    #[test]
    fn gpu_ignores_fully_transparent_palette() {
        let Some(node) = gpu_node() else { return };
        let codes = lcg_codes(12, 9, 13);
        let params = node_params(&case(3, 4, 0.5, NONE, true));
        let transparent = Image::from_f32_data(2, 1, vec![1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0])
            .expect("transparent strip");
        let with_palette = evaluate(
            &node,
            codes_to_image(&codes, 12, 9),
            Some(transparent),
            &params,
            1.0,
        );
        let without = evaluate(&node, codes_to_image(&codes, 12, 9), None, &params, 1.0);
        assert_eq!(with_palette.data, without.data);
    }

    #[test]
    fn gpu_passes_through_empty_images() {
        let Some(node) = gpu_node() else { return };
        let empty = Image::from_f32_data(0, 0, Vec::new()).expect("empty image");
        let output = evaluate(
            &node,
            empty,
            None,
            &node_params(&case(8, 4, 0.5, NONE, true)),
            1.0,
        );
        assert_eq!((output.width, output.height), (0, 0));
    }
}
