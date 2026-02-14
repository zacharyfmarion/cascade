use std::any::Any;
use std::collections::HashMap;
use std::hash::Hasher;
use std::num::NonZeroU64;
use std::sync::Arc;

use ahash::AHasher;
use compositor_core::error::CompositorError;
use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::{
    Image, NodeSpec, ParamDefault, ParamSpec, ParamValue, Value, ValueType,
};
use half::f16;

use crate::context::{CachedPipeline, GpuContext};
use crate::manifest::KernelManifest;
use crate::transpile::glsl_to_wgsl;

pub struct GpuKernelNode {
    spec: NodeSpec,
    wgsl_source: String,
    context: Arc<GpuContext>,
}

// SAFETY: Single-threaded on wasm32. See GpuContext safety comment.
#[cfg(target_arch = "wasm32")]
unsafe impl Send for GpuKernelNode {}
#[cfg(target_arch = "wasm32")]
unsafe impl Sync for GpuKernelNode {}

impl GpuKernelNode {
    pub fn from_manifest(
        manifest: KernelManifest,
        context: Arc<GpuContext>,
    ) -> Result<Self, String> {
        let spec = manifest.to_node_spec()?;
        let glsl = manifest.build_glsl()?;
        let wgsl = glsl_to_wgsl(&glsl)?;
        Ok(Self {
            spec,
            wgsl_source: wgsl,
            context,
        })
    }

    fn build_pipeline(&self, key: u64, extra_images: usize) -> Result<CachedPipeline, String> {
        if let Some(cached) = self.context.get_pipeline(key) {
            return Ok(cached);
        }

        let shader = self
            .context
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("GpuKernelNode Shader"),
                source: wgpu::ShaderSource::Wgsl(self.wgsl_source.clone().into()),
            });

        let mut entries = Vec::new();
        entries.push(wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::StorageTexture {
                access: wgpu::StorageTextureAccess::ReadOnly,
                format: wgpu::TextureFormat::Rgba16Float,
                view_dimension: wgpu::TextureViewDimension::D2,
            },
            count: None,
        });
        entries.push(wgpu::BindGroupLayoutEntry {
            binding: 1,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::StorageTexture {
                access: wgpu::StorageTextureAccess::WriteOnly,
                format: wgpu::TextureFormat::Rgba16Float,
                view_dimension: wgpu::TextureViewDimension::D2,
            },
            count: None,
        });
        entries.push(wgpu::BindGroupLayoutEntry {
            binding: 2,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        });
        for i in 0..extra_images {
            entries.push(wgpu::BindGroupLayoutEntry {
                binding: 3 + i as u32,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::StorageTexture {
                    access: wgpu::StorageTextureAccess::ReadOnly,
                    format: wgpu::TextureFormat::Rgba16Float,
                    view_dimension: wgpu::TextureViewDimension::D2,
                },
                count: None,
            });
        }

        let bind_group_layout =
            self.context
                .device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("GpuKernelNode BindGroupLayout"),
                    entries: &entries,
                });

        let pipeline_layout =
            self.context
                .device
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("GpuKernelNode PipelineLayout"),
                    bind_group_layouts: &[&bind_group_layout],
                    push_constant_ranges: &[],
                });

        let pipeline =
            self.context
                .device
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some("GpuKernelNode Pipeline"),
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
        Ok(cached)
    }

    fn build_param_buffer(&self, ctx: &EvalContext) -> Result<Vec<u8>, CompositorError> {
        let mut bytes = Vec::new();
        for param in &self.spec.params {
            let value = ctx
                .params
                .get(&param.key)
                .cloned()
                .or_else(|| default_param_value(param));
            let value = value.ok_or_else(|| CompositorError::MissingParam(param.key.clone()))?;
            bytes.extend_from_slice(&param_value_bytes(&param.ty, &value)?);
        }

        let scalar_count = if self.spec.params.is_empty() {
            1
        } else {
            self.spec.params.len()
        };
        let pad_needed = (4 - (scalar_count % 4)) % 4;
        for _ in 0..pad_needed {
            bytes.extend_from_slice(&0f32.to_le_bytes());
        }
        if self.spec.params.is_empty() {
            bytes.extend_from_slice(&0f32.to_le_bytes());
        }
        Ok(bytes)
    }
}

impl Node for GpuKernelNode {
    fn spec(&self) -> NodeSpec {
        self.spec.clone()
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a>
    {
        Box::pin(async move {
            let image_inputs = collect_image_inputs(&self.spec, ctx)?;
            if image_inputs.is_empty() {
                return Err(CompositorError::Other(
                    "GPU node needs image input".to_string(),
                ));
            }

            let width = image_inputs[0].width;
            let height = image_inputs[0].height;

            let mut hasher = AHasher::default();
            hasher.write(self.wgsl_source.as_bytes());
            let key = hasher.finish();

            let pipeline = self
                .build_pipeline(key, image_inputs.len().saturating_sub(1))
                .map_err(CompositorError::Other)?;

            let mut input_views = Vec::new();
            for image in &image_inputs {
                let texture = create_storage_texture(
                    &self.context.device,
                    image.width,
                    image.height,
                    wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_DST,
                );
                let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
                upload_image(&self.context.queue, &texture, image)?;
                input_views.push(view);
            }

            let output_texture = create_storage_texture(
                &self.context.device,
                width,
                height,
                wgpu::TextureUsages::STORAGE_BINDING
                    | wgpu::TextureUsages::COPY_SRC
                    | wgpu::TextureUsages::COPY_DST,
            );
            let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());

            let param_bytes = self.build_param_buffer(ctx)?;
            let uniform_buffer = self.context.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("GpuKernelNode Uniforms"),
                size: param_bytes.len() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.context
                .queue
                .write_buffer(&uniform_buffer, 0, &param_bytes);

            let mut entries: Vec<wgpu::BindGroupEntry> = Vec::new();
            entries.push(wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&input_views[0]),
            });
            entries.push(wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(&output_view),
            });
            entries.push(wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: &uniform_buffer,
                    offset: 0,
                    size: NonZeroU64::new(param_bytes.len() as u64),
                }),
            });
            for (i, view) in input_views.iter().skip(1).enumerate() {
                entries.push(wgpu::BindGroupEntry {
                    binding: 3 + i as u32,
                    resource: wgpu::BindingResource::TextureView(view),
                });
            }

            let bind_group = self
                .context
                .device
                .create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("GpuKernelNode BindGroup"),
                    layout: &pipeline.bind_group_layout,
                    entries: &entries,
                });

            let mut encoder =
                self.context
                    .device
                    .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                        label: Some("GpuKernelNode Encoder"),
                    });
            {
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("GpuKernelNode ComputePass"),
                    timestamp_writes: None,
                });
                pass.set_pipeline(&pipeline.pipeline);
                pass.set_bind_group(0, &bind_group, &[]);
                let x = (width + 15) / 16;
                let y = (height + 15) / 16;
                pass.dispatch_workgroups(x, y, 1);
            }
            self.context.queue.submit(Some(encoder.finish()));

            let output_image = read_texture_to_image(
                &self.context.device,
                &self.context.queue,
                &output_texture,
                width,
                height,
            )
            .await?;

            let mut outputs = HashMap::new();
            if let Some(port) = self.spec.outputs.first() {
                outputs.insert(port.name.clone(), Value::Image(output_image));
            }
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

fn create_storage_texture(
    device: &wgpu::Device,
    width: u32,
    height: u32,
    usage: wgpu::TextureUsages,
) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("GpuKernelNode Texture"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba16Float,
        usage,
        view_formats: &[],
    })
}

fn upload_image(
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    image: &Image,
) -> Result<(), CompositorError> {
    let (data, padded_bytes_per_row, _unpadded_bytes_per_row) = pack_image_data(image);
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &data,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(padded_bytes_per_row),
            rows_per_image: Some(image.height),
        },
        wgpu::Extent3d {
            width: image.width,
            height: image.height,
            depth_or_array_layers: 1,
        },
    );
    Ok(())
}

async fn read_texture_to_image(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Result<Image, CompositorError> {
    let bytes_per_pixel = 8u32;
    let unpadded_bytes_per_row = width * bytes_per_pixel;
    let padded_bytes_per_row = align_to(unpadded_bytes_per_row, wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
    let buffer_size = padded_bytes_per_row as u64 * height as u64;

    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("GpuKernelNode Readback"),
        size: buffer_size,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("GpuKernelNode Readback Encoder"),
    });
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded_bytes_per_row),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    queue.submit(Some(encoder.finish()));

    let buffer_slice = buffer.slice(..);
    let (sender, receiver) = flume::bounded(1);
    buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = sender.send(result);
    });
    device.poll(wgpu::Maintain::Wait);
    receiver
        .recv_async()
        .await
        .map_err(|e| CompositorError::Other(format!("Map receive error: {e}")))?
        .map_err(|e| CompositorError::Other(format!("Map error: {e:?}")))?;

    let data = buffer_slice.get_mapped_range();
    let mut output_bytes = vec![0u8; (unpadded_bytes_per_row * height) as usize];
    for row in 0..height as usize {
        let src_start = row * padded_bytes_per_row as usize;
        let dst_start = row * unpadded_bytes_per_row as usize;
        let src_end = src_start + unpadded_bytes_per_row as usize;
        output_bytes[dst_start..dst_start + unpadded_bytes_per_row as usize]
            .copy_from_slice(&data[src_start..src_end]);
    }
    drop(data);
    buffer.unmap();

    let mut out = Vec::with_capacity((width * height * 4) as usize);
    for chunk in output_bytes.chunks_exact(2) {
        out.push(f16::from_le_bytes([chunk[0], chunk[1]]).to_f32());
    }
    Ok(Image::from_f32_data(width, height, out))
}

fn collect_image_inputs<'a>(
    spec: &NodeSpec,
    ctx: &'a EvalContext,
) -> Result<Vec<&'a Image>, CompositorError> {
    let mut out = Vec::new();
    for port in &spec.inputs {
        match port.ty {
            ValueType::Image | ValueType::Mask => {
                let value = ctx
                    .inputs
                    .get(&port.name)
                    .ok_or_else(|| CompositorError::MissingInput(port.name.clone()))?;
                match value {
                    Value::Image(image) | Value::Mask(image) => out.push(image),
                    other => {
                        return Err(CompositorError::TypeMismatch {
                            expected: format!("{:?}", port.ty),
                            got: format!("{:?}", other.value_type()),
                        })
                    }
                }
            }
            _ => {
                return Err(CompositorError::Other(
                    "GPU node inputs must be images".to_string(),
                ))
            }
        }
    }
    Ok(out)
}

fn default_param_value(param: &ParamSpec) -> Option<ParamValue> {
    match &param.default {
        ParamDefault::Float(v) => Some(ParamValue::Float(*v)),
        ParamDefault::Int(v) => Some(ParamValue::Int(*v)),
        ParamDefault::Bool(v) => Some(ParamValue::Bool(*v)),
        ParamDefault::Color(_) => None,
        ParamDefault::ColorRamp(_) => None,
        ParamDefault::String(_) => None,
    }
}

fn param_value_bytes(ty: &ValueType, value: &ParamValue) -> Result<[u8; 4], CompositorError> {
    match (ty, value) {
        (ValueType::Float, ParamValue::Float(v)) => Ok((*v as f32).to_le_bytes()),
        (ValueType::Int, ParamValue::Int(v)) => Ok((*v as i32).to_le_bytes()),
        (ValueType::Bool, ParamValue::Bool(v)) => {
            let as_u32: u32 = if *v { 1 } else { 0 };
            Ok(as_u32.to_le_bytes())
        }
        _ => Err(CompositorError::Other(
            "Unsupported param type for GPU kernel".to_string(),
        )),
    }
}

fn pack_image_data(image: &Image) -> (Vec<u8>, u32, u32) {
    let bytes_per_pixel = 8u32;
    let unpadded_bytes_per_row = image.width * bytes_per_pixel;
    let padded_bytes_per_row = align_to(unpadded_bytes_per_row, wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
    let mut raw = Vec::with_capacity((image.width * image.height * 4 * 2) as usize);
    for &value in image.data.iter() {
        raw.extend_from_slice(&f16::from_f32(value).to_bits().to_le_bytes());
    }

    if padded_bytes_per_row == unpadded_bytes_per_row {
        return (raw, padded_bytes_per_row, unpadded_bytes_per_row);
    }

    let mut padded = vec![0u8; (padded_bytes_per_row * image.height) as usize];
    for row in 0..image.height as usize {
        let src_start = row * unpadded_bytes_per_row as usize;
        let dst_start = row * padded_bytes_per_row as usize;
        let src_end = src_start + unpadded_bytes_per_row as usize;
        padded[dst_start..dst_start + unpadded_bytes_per_row as usize]
            .copy_from_slice(&raw[src_start..src_end]);
    }
    (padded, padded_bytes_per_row, unpadded_bytes_per_row)
}

fn align_to(value: u32, alignment: u32) -> u32 {
    let remainder = value % alignment;
    if remainder == 0 {
        value
    } else {
        value + (alignment - remainder)
    }
}
