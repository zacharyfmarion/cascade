use std::any::Any;
use std::collections::HashMap;
use std::hash::Hasher;
use std::num::NonZeroU64;
use std::sync::Arc;

use ahash::AHasher;
use bytemuck::{Pod, Zeroable};
use compositor_core::error::CompositorError;
use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::{
    Image, NodeSpec, ParamDefault, ParamSpec, PortSpec, UiHint, Value, ValueType,
};

use crate::context::{CachedPipeline, GpuContext};
use crate::transpile::glsl_to_wgsl;

pub struct GpuKuwaharaNode {
    spec: NodeSpec,
    context: Arc<GpuContext>,
    shaders: Result<KuwaharaShaders, String>,
}

// SAFETY: Single-threaded on wasm32. See GpuContext safety comment.
#[cfg(target_arch = "wasm32")]
unsafe impl Send for GpuKuwaharaNode {}
#[cfg(target_arch = "wasm32")]
unsafe impl Sync for GpuKuwaharaNode {}

impl GpuKuwaharaNode {
    pub fn new(context: Arc<GpuContext>) -> Self {
        let shaders = build_shaders();
        Self {
            spec: kuwahara_spec(),
            context,
            shaders,
        }
    }

    fn build_pipeline(
        &self,
        key: u64,
        label: &str,
        wgsl_source: &str,
        entries: &[wgpu::BindGroupLayoutEntry],
    ) -> Result<CachedPipeline, CompositorError> {
        if let Some(cached) = self.context.get_pipeline(key) {
            return Ok(cached);
        }

        let shader = self
            .context
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(label),
                source: wgpu::ShaderSource::Wgsl(wgsl_source.into()),
            });

        let bind_group_layout_label = format!("{label} BindGroupLayout");
        let bind_group_layout =
            self.context
                .device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some(&bind_group_layout_label),
                    entries,
                });

        let pipeline_layout_label = format!("{label} PipelineLayout");
        let pipeline_layout =
            self.context
                .device
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some(&pipeline_layout_label),
                    bind_group_layouts: &[&bind_group_layout],
                    push_constant_ranges: &[],
                });

        let pipeline =
            self.context
                .device
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
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
        Ok(cached)
    }
}

impl Node for GpuKuwaharaNode {
    fn spec(&self) -> NodeSpec {
        self.spec.clone()
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let variation = ctx.get_param_int("variation")?.clamp(0, 1) as i32;
            let size = ctx.get_param_int("size")?.clamp(1, 100) as i32;

            let width = image.width;
            let height = image.height;
            if width == 0 || height == 0 || size <= 0 {
                let output = image.clone();
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    apply_mask_cpu(image, &output, mask)
                } else {
                    output
                };
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(output));
                return Ok(outputs);
            }

            let shaders = self
                .shaders
                .as_ref()
                .map_err(|err| CompositorError::Other(err.clone()))?;

            let mask_fallback = Image::from_f32_data(1, 1, vec![1.0, 1.0, 1.0, 1.0]);
            let mask_image = ctx
                .get_optional_input_image("mask")
                .unwrap_or(&mask_fallback);

            let input_texture = create_storage_texture(
                &self.context.device,
                width,
                height,
                wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_DST,
            );
            upload_image(&self.context.queue, &input_texture, image)?;
            let input_view = input_texture.create_view(&wgpu::TextureViewDescriptor::default());

            let mask_texture = create_storage_texture(
                &self.context.device,
                mask_image.width,
                mask_image.height,
                wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_DST,
            );
            upload_image(&self.context.queue, &mask_texture, mask_image)?;
            let mask_view = mask_texture.create_view(&wgpu::TextureViewDescriptor::default());

            let output_texture = create_storage_texture(
                &self.context.device,
                width,
                height,
                wgpu::TextureUsages::STORAGE_BINDING
                    | wgpu::TextureUsages::COPY_SRC
                    | wgpu::TextureUsages::COPY_DST,
            );
            let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());

            let mut encoder =
                self.context
                    .device
                    .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                        label: Some("GpuKuwahara Encoder"),
                    });

            if variation == 0 {
                let params = ClassicParams {
                    radius: size as f32,
                    _pad0: 0.0,
                    _pad1: 0.0,
                    _pad2: 0.0,
                };
                let uniform_buffer = create_uniform_buffer(
                    &self.context.device,
                    &self.context.queue,
                    "GpuKuwahara Classic Params",
                    &params,
                );

                let pipeline = self.build_pipeline(
                    shaders.classic_key,
                    "GpuKuwahara Classic Pipeline",
                    &shaders.classic_wgsl,
                    &classic_bind_group_layout_entries(),
                )?;

                let bind_group = self
                    .context
                    .device
                    .create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("GpuKuwahara Classic BindGroup"),
                        layout: &pipeline.bind_group_layout,
                        entries: &[
                            wgpu::BindGroupEntry {
                                binding: 0,
                                resource: wgpu::BindingResource::TextureView(&input_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: 1,
                                resource: wgpu::BindingResource::TextureView(&output_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: 2,
                                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                                    buffer: &uniform_buffer,
                                    offset: 0,
                                    size: NonZeroU64::new(
                                        std::mem::size_of::<ClassicParams>() as u64,
                                    ),
                                }),
                            },
                            wgpu::BindGroupEntry {
                                binding: 3,
                                resource: wgpu::BindingResource::TextureView(&mask_view),
                            },
                        ],
                    });

                {
                    let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                        label: Some("GpuKuwahara Classic Pass"),
                        timestamp_writes: None,
                    });
                    pass.set_pipeline(&pipeline.pipeline);
                    pass.set_bind_group(0, &bind_group, &[]);
                    let x = (width + 15) / 16;
                    let y = (height + 15) / 16;
                    pass.dispatch_workgroups(x, y, 1);
                }
            } else {
                let uniformity = ctx.get_param_int("uniformity")?.max(0) as i32;
                let sharpness_raw = ctx.get_param_float("sharpness")? as f32;
                let eccentricity_raw = ctx.get_param_float("eccentricity")? as f32;
                let sharpness_raw = sharpness_raw.clamp(0.0, 1.0);
                let eccentricity_raw = eccentricity_raw.clamp(0.0, 2.0);
                let sharpness = sharpness_raw * sharpness_raw * 16.0;
                let eccentricity = 1.0 / eccentricity_raw.max(0.01);

                let tensor_texture = create_storage_texture(
                    &self.context.device,
                    width,
                    height,
                    wgpu::TextureUsages::STORAGE_BINDING
                        | wgpu::TextureUsages::COPY_SRC
                        | wgpu::TextureUsages::COPY_DST,
                );
                let tensor_view =
                    tensor_texture.create_view(&wgpu::TextureViewDescriptor::default());

                let tensor_pipeline = self.build_pipeline(
                    shaders.tensor_key,
                    "GpuKuwahara Tensor Pipeline",
                    &shaders.tensor_wgsl,
                    &tensor_bind_group_layout_entries(),
                )?;
                let tensor_bind_group = self
                    .context
                    .device
                    .create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("GpuKuwahara Tensor BindGroup"),
                        layout: &tensor_pipeline.bind_group_layout,
                        entries: &[
                            wgpu::BindGroupEntry {
                                binding: 0,
                                resource: wgpu::BindingResource::TextureView(&input_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: 1,
                                resource: wgpu::BindingResource::TextureView(&tensor_view),
                            },
                        ],
                    });

                {
                    let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                        label: Some("GpuKuwahara Tensor Pass"),
                        timestamp_writes: None,
                    });
                    pass.set_pipeline(&tensor_pipeline.pipeline);
                    pass.set_bind_group(0, &tensor_bind_group, &[]);
                    let x = (width + 15) / 16;
                    let y = (height + 15) / 16;
                    pass.dispatch_workgroups(x, y, 1);
                }

                if uniformity > 0 {
                    let blur_texture = create_storage_texture(
                        &self.context.device,
                        width,
                        height,
                        wgpu::TextureUsages::STORAGE_BINDING
                            | wgpu::TextureUsages::COPY_SRC
                            | wgpu::TextureUsages::COPY_DST,
                    );
                    let blur_view =
                        blur_texture.create_view(&wgpu::TextureViewDescriptor::default());

                    let blur_params = BlurParams {
                        radius: 0.0,
                        _pad0: 0.0,
                        _pad1: 0.0,
                        _pad2: 0.0,
                    };
                    let blur_buffer = create_uniform_buffer(
                        &self.context.device,
                        &self.context.queue,
                        "GpuKuwahara Blur Params",
                        &blur_params,
                    );

                    let blur_h_pipeline = self.build_pipeline(
                        shaders.blur_h_key,
                        "GpuKuwahara BlurH Pipeline",
                        &shaders.blur_h_wgsl,
                        &blur_bind_group_layout_entries(),
                    )?;
                    let blur_v_pipeline = self.build_pipeline(
                        shaders.blur_v_key,
                        "GpuKuwahara BlurV Pipeline",
                        &shaders.blur_v_wgsl,
                        &blur_bind_group_layout_entries(),
                    )?;

                    let radii = box_radii_for_gaussian(uniformity as f32, 3);
                    for radius in radii {
                        let params = BlurParams {
                            radius: radius as f32,
                            _pad0: 0.0,
                            _pad1: 0.0,
                            _pad2: 0.0,
                        };
                        self.context.queue.write_buffer(
                            &blur_buffer,
                            0,
                            bytemuck::bytes_of(&params),
                        );

                        let blur_h_bind_group = self
                            .context
                            .device
                            .create_bind_group(&wgpu::BindGroupDescriptor {
                                label: Some("GpuKuwahara BlurH BindGroup"),
                                layout: &blur_h_pipeline.bind_group_layout,
                                entries: &[
                                    wgpu::BindGroupEntry {
                                        binding: 0,
                                        resource: wgpu::BindingResource::TextureView(&tensor_view),
                                    },
                                    wgpu::BindGroupEntry {
                                        binding: 1,
                                        resource: wgpu::BindingResource::TextureView(&blur_view),
                                    },
                                    wgpu::BindGroupEntry {
                                        binding: 2,
                                        resource: wgpu::BindingResource::Buffer(
                                            wgpu::BufferBinding {
                                                buffer: &blur_buffer,
                                                offset: 0,
                                                size: NonZeroU64::new(
                                                    std::mem::size_of::<BlurParams>() as u64,
                                                ),
                                            },
                                        ),
                                    },
                                ],
                            });

                        {
                            let mut pass =
                                encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                                    label: Some("GpuKuwahara BlurH Pass"),
                                    timestamp_writes: None,
                                });
                            pass.set_pipeline(&blur_h_pipeline.pipeline);
                            pass.set_bind_group(0, &blur_h_bind_group, &[]);
                            let x = (width + 15) / 16;
                            let y = (height + 15) / 16;
                            pass.dispatch_workgroups(x, y, 1);
                        }

                        let blur_v_bind_group = self
                            .context
                            .device
                            .create_bind_group(&wgpu::BindGroupDescriptor {
                                label: Some("GpuKuwahara BlurV BindGroup"),
                                layout: &blur_v_pipeline.bind_group_layout,
                                entries: &[
                                    wgpu::BindGroupEntry {
                                        binding: 0,
                                        resource: wgpu::BindingResource::TextureView(&blur_view),
                                    },
                                    wgpu::BindGroupEntry {
                                        binding: 1,
                                        resource: wgpu::BindingResource::TextureView(&tensor_view),
                                    },
                                    wgpu::BindGroupEntry {
                                        binding: 2,
                                        resource: wgpu::BindingResource::Buffer(
                                            wgpu::BufferBinding {
                                                buffer: &blur_buffer,
                                                offset: 0,
                                                size: NonZeroU64::new(
                                                    std::mem::size_of::<BlurParams>() as u64,
                                                ),
                                            },
                                        ),
                                    },
                                ],
                            });

                        {
                            let mut pass =
                                encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                                    label: Some("GpuKuwahara BlurV Pass"),
                                    timestamp_writes: None,
                                });
                            pass.set_pipeline(&blur_v_pipeline.pipeline);
                            pass.set_bind_group(0, &blur_v_bind_group, &[]);
                            let x = (width + 15) / 16;
                            let y = (height + 15) / 16;
                            pass.dispatch_workgroups(x, y, 1);
                        }
                    }
                }

                let aniso_params = AnisotropicParams {
                    radius: size as f32,
                    sharpness,
                    eccentricity,
                    _pad0: 0.0,
                };
                let aniso_buffer = create_uniform_buffer(
                    &self.context.device,
                    &self.context.queue,
                    "GpuKuwahara Anisotropic Params",
                    &aniso_params,
                );

                let aniso_pipeline = self.build_pipeline(
                    shaders.anisotropic_key,
                    "GpuKuwahara Anisotropic Pipeline",
                    &shaders.anisotropic_wgsl,
                    &anisotropic_bind_group_layout_entries(),
                )?;

                let aniso_bind_group = self
                    .context
                    .device
                    .create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("GpuKuwahara Anisotropic BindGroup"),
                        layout: &aniso_pipeline.bind_group_layout,
                        entries: &[
                            wgpu::BindGroupEntry {
                                binding: 0,
                                resource: wgpu::BindingResource::TextureView(&input_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: 1,
                                resource: wgpu::BindingResource::TextureView(&output_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: 2,
                                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                                    buffer: &aniso_buffer,
                                    offset: 0,
                                    size: NonZeroU64::new(
                                        std::mem::size_of::<AnisotropicParams>() as u64,
                                    ),
                                }),
                            },
                            wgpu::BindGroupEntry {
                                binding: 3,
                                resource: wgpu::BindingResource::TextureView(&mask_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: 4,
                                resource: wgpu::BindingResource::TextureView(&tensor_view),
                            },
                        ],
                    });

                {
                    let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                        label: Some("GpuKuwahara Anisotropic Pass"),
                        timestamp_writes: None,
                    });
                    pass.set_pipeline(&aniso_pipeline.pipeline);
                    pass.set_bind_group(0, &aniso_bind_group, &[]);
                    let x = (width + 15) / 16;
                    let y = (height + 15) / 16;
                    pass.dispatch_workgroups(x, y, 1);
                }
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
            outputs.insert("image".to_string(), Value::Image(output_image));
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

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ClassicParams {
    radius: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct BlurParams {
    radius: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct AnisotropicParams {
    radius: f32,
    sharpness: f32,
    eccentricity: f32,
    _pad0: f32,
}

struct KuwaharaShaders {
    tensor_wgsl: String,
    blur_h_wgsl: String,
    blur_v_wgsl: String,
    anisotropic_wgsl: String,
    classic_wgsl: String,
    tensor_key: u64,
    blur_h_key: u64,
    blur_v_key: u64,
    anisotropic_key: u64,
    classic_key: u64,
}

fn kuwahara_spec() -> NodeSpec {
    NodeSpec {
        id: "kuwahara".to_string(),
        display_name: "Kuwahara".to_string(),
        category: "Filter".to_string(),
        description: "Smoothing filter that preserves edges, for painterly effects".to_string(),
        inputs: vec![
            PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            },
            PortSpec {
                name: "mask".to_string(),
                label: "Mask".to_string(),
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
                key: "variation".to_string(),
                label: "Variation".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(1),
                min: None,
                max: None,
                step: None,
                ui_hint: UiHint::Dropdown(vec!["Classic".to_string(), "Anisotropic".to_string()]),
                promotable: true,
            },
            ParamSpec {
                key: "size".to_string(),
                label: "Size".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(6),
                min: Some(1.0),
                max: Some(100.0),
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
                    promotable: true,
            },
            ParamSpec {
                key: "uniformity".to_string(),
                label: "Uniformity".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(4),
                min: Some(0.0),
                max: Some(50.0),
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
                    promotable: true,
            },
            ParamSpec {
                key: "sharpness".to_string(),
                label: "Sharpness".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(0.5),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
                    promotable: true,
            },
            ParamSpec {
                key: "eccentricity".to_string(),
                label: "Eccentricity".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(1.0),
                min: Some(0.0),
                max: Some(2.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
                    promotable: true,
            },
        ],
    }
}

fn build_shaders() -> Result<KuwaharaShaders, String> {
    let tensor_wgsl = glsl_to_wgsl(STRUCTURE_TENSOR_GLSL)?;
    let blur_h_wgsl = glsl_to_wgsl(BLUR_H_GLSL)?;
    let blur_v_wgsl = glsl_to_wgsl(BLUR_V_GLSL)?;
    let anisotropic_wgsl = glsl_to_wgsl(ANISOTROPIC_GLSL)?;
    let classic_wgsl = glsl_to_wgsl(CLASSIC_GLSL)?;

    Ok(KuwaharaShaders {
        tensor_key: pipeline_key("kuwahara_tensor", &tensor_wgsl),
        blur_h_key: pipeline_key("kuwahara_blur_h", &blur_h_wgsl),
        blur_v_key: pipeline_key("kuwahara_blur_v", &blur_v_wgsl),
        anisotropic_key: pipeline_key("kuwahara_anisotropic", &anisotropic_wgsl),
        classic_key: pipeline_key("kuwahara_classic", &classic_wgsl),
        tensor_wgsl,
        blur_h_wgsl,
        blur_v_wgsl,
        anisotropic_wgsl,
        classic_wgsl,
    })
}

fn pipeline_key(label: &str, wgsl: &str) -> u64 {
    let mut hasher = AHasher::default();
    hasher.write(label.as_bytes());
    hasher.write(wgsl.as_bytes());
    hasher.finish()
}

fn create_uniform_buffer<T: Pod>(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    label: &str,
    params: &T,
) -> wgpu::Buffer {
    let bytes = bytemuck::bytes_of(params);
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size: bytes.len() as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    queue.write_buffer(&buffer, 0, bytes);
    buffer
}

fn tensor_bind_group_layout_entries() -> [wgpu::BindGroupLayoutEntry; 2] {
    [
        texture_layout_entry(0, wgpu::StorageTextureAccess::ReadOnly),
        texture_layout_entry(1, wgpu::StorageTextureAccess::WriteOnly),
    ]
}

fn blur_bind_group_layout_entries() -> [wgpu::BindGroupLayoutEntry; 3] {
    [
        texture_layout_entry(0, wgpu::StorageTextureAccess::ReadOnly),
        texture_layout_entry(1, wgpu::StorageTextureAccess::WriteOnly),
        uniform_layout_entry(2),
    ]
}

fn classic_bind_group_layout_entries() -> [wgpu::BindGroupLayoutEntry; 4] {
    [
        texture_layout_entry(0, wgpu::StorageTextureAccess::ReadOnly),
        texture_layout_entry(1, wgpu::StorageTextureAccess::WriteOnly),
        uniform_layout_entry(2),
        texture_layout_entry(3, wgpu::StorageTextureAccess::ReadOnly),
    ]
}

fn anisotropic_bind_group_layout_entries() -> [wgpu::BindGroupLayoutEntry; 5] {
    [
        texture_layout_entry(0, wgpu::StorageTextureAccess::ReadOnly),
        texture_layout_entry(1, wgpu::StorageTextureAccess::WriteOnly),
        uniform_layout_entry(2),
        texture_layout_entry(3, wgpu::StorageTextureAccess::ReadOnly),
        texture_layout_entry(4, wgpu::StorageTextureAccess::ReadOnly),
    ]
}

fn texture_layout_entry(
    binding: u32,
    access: wgpu::StorageTextureAccess,
) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::StorageTexture {
            access,
            format: wgpu::TextureFormat::Rgba16Float,
            view_dimension: wgpu::TextureViewDimension::D2,
        },
        count: None,
    }
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

fn create_storage_texture(
    device: &wgpu::Device,
    width: u32,
    height: u32,
    usage: wgpu::TextureUsages,
) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("GpuKuwahara Texture"),
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
        label: Some("GpuKuwahara Readback"),
        size: buffer_size,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("GpuKuwahara Readback Encoder"),
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
        out.push(half::f16::from_le_bytes([chunk[0], chunk[1]]).to_f32());
    }
    Ok(Image::from_f32_data(width, height, out))
}

fn pack_image_data(image: &Image) -> (Vec<u8>, u32, u32) {
    let bytes_per_pixel = 8u32;
    let unpadded_bytes_per_row = image.width * bytes_per_pixel;
    let padded_bytes_per_row = align_to(unpadded_bytes_per_row, wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
    let mut raw = Vec::with_capacity((image.width * image.height * 4 * 2) as usize);
    for &value in image.data.iter() {
        raw.extend_from_slice(&half::f16::from_f32(value).to_bits().to_le_bytes());
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

fn box_radii_for_gaussian(sigma: f32, n: usize) -> Vec<usize> {
    let w_ideal = ((12.0 * sigma * sigma / n as f32) + 1.0).sqrt();
    let mut wl = w_ideal.floor() as usize;
    if wl % 2 == 0 {
        wl = wl.saturating_sub(1);
    }
    let wu = wl + 2;

    let m_ideal =
        (12.0 * sigma * sigma - (n * wl * wl + 4 * n * wl + 3 * n) as f32) / (4 * wl + 4) as f32;
    let m = m_ideal.round() as usize;

    (0..n)
        .map(|i| {
            let size = if i < m { wl } else { wu };
            (size.saturating_sub(1)) / 2
        })
        .collect()
}

fn apply_mask_cpu(original: &Image, processed: &Image, mask: &Image) -> Image {
    let pixel_count = processed.pixel_count();
    let proc_width = processed.width as usize;
    let mask_width = mask.width as usize;
    let mask_max_x = mask.width.saturating_sub(1) as usize;
    let mask_max_y = mask.height.saturating_sub(1) as usize;
    let orig_data = &original.data;
    let proc_data = &processed.data;
    let mask_data = &mask.data;
    let mut data = vec![0.0f32; pixel_count * 4];
    for i in 0..pixel_count {
        let idx = i * 4;
        let x = i % proc_width;
        let y = i / proc_width;
        let mx = x.min(mask_max_x);
        let my = y.min(mask_max_y);
        let mask_idx = (my * mask_width + mx) * 4;
        let mask_r = mask_data[mask_idx];
        let mask_g = mask_data[mask_idx + 1];
        let mask_b = mask_data[mask_idx + 2];
        let mask_lum = (0.2126 * mask_r + 0.7152 * mask_g + 0.0722 * mask_b).clamp(0.0, 1.0);
        let inv_mask = 1.0 - mask_lum;
        for c in 0..4 {
            let orig_val = orig_data[idx + c];
            let proc_val = proc_data[idx + c];
            data[idx + c] = orig_val * inv_mask + proc_val * mask_lum;
        }
    }
    Image::from_f32_data(processed.width, processed.height, data)
}

const STRUCTURE_TENSOR_GLSL: &str = r#"#version 450

layout(set=0, binding=0, rgba16f) uniform readonly image2D u_input;
layout(set=0, binding=1, rgba16f) uniform writeonly image2D u_output;

vec3 sample_rgb(ivec2 coord, ivec2 dims) {
    ivec2 clamped = clamp(coord, ivec2(0), dims - ivec2(1));
    vec4 color = imageLoad(u_input, clamped);
    return color.rgb;
}

layout(local_size_x=16, local_size_y=16) in;
void main() {
    ivec2 gid = ivec2(gl_GlobalInvocationID.xy);
    ivec2 dims = imageSize(u_input);
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    const float corner_weight = 0.182;
    const float center_weight = 1.0 - 2.0 * corner_weight;

    vec3 tl = sample_rgb(gid + ivec2(-1, 1), dims);
    vec3 ml = sample_rgb(gid + ivec2(-1, 0), dims);
    vec3 bl = sample_rgb(gid + ivec2(-1, -1), dims);
    vec3 tr = sample_rgb(gid + ivec2(1, 1), dims);
    vec3 mr = sample_rgb(gid + ivec2(1, 0), dims);
    vec3 br = sample_rgb(gid + ivec2(1, -1), dims);
    vec3 tc = sample_rgb(gid + ivec2(0, 1), dims);
    vec3 bc = sample_rgb(gid + ivec2(0, -1), dims);

    vec3 dx = tl * (-corner_weight)
        + ml * (-center_weight)
        + bl * (-corner_weight)
        + tr * corner_weight
        + mr * center_weight
        + br * corner_weight;

    vec3 dy = tl * corner_weight
        + tc * center_weight
        + tr * corner_weight
        + bl * (-corner_weight)
        + bc * (-center_weight)
        + br * (-corner_weight);

    float dxdx = dot(dx, dx);
    float dxdy = dot(dx, dy);
    float dydy = dot(dy, dy);

    imageStore(u_output, gid, vec4(dxdx, dxdy, dxdy, dydy));
}
"#;

const BLUR_H_GLSL: &str = r#"#version 450

layout(set=0, binding=0, rgba16f) uniform readonly image2D u_input;
layout(set=0, binding=1, rgba16f) uniform writeonly image2D u_output;

layout(std140, set=0, binding=2) uniform Params {
    float radius;
    float _pad0;
    float _pad1;
    float _pad2;
};

layout(local_size_x=16, local_size_y=16) in;
void main() {
    ivec2 gid = ivec2(gl_GlobalInvocationID.xy);
    ivec2 dims = imageSize(u_input);
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    int r = int(radius);
    int start = gid.x - r;
    int end = gid.x + r;
    int span = end - start + 1;
    vec4 sum = vec4(0.0);

    for (int x = start; x <= end; ++x) {
        int cx = clamp(x, 0, dims.x - 1);
        sum += imageLoad(u_input, ivec2(cx, gid.y));
    }

    imageStore(u_output, gid, sum / float(span));
}
"#;

const BLUR_V_GLSL: &str = r#"#version 450

layout(set=0, binding=0, rgba16f) uniform readonly image2D u_input;
layout(set=0, binding=1, rgba16f) uniform writeonly image2D u_output;

layout(std140, set=0, binding=2) uniform Params {
    float radius;
    float _pad0;
    float _pad1;
    float _pad2;
};

layout(local_size_x=16, local_size_y=16) in;
void main() {
    ivec2 gid = ivec2(gl_GlobalInvocationID.xy);
    ivec2 dims = imageSize(u_input);
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    int r = int(radius);
    int start = gid.y - r;
    int end = gid.y + r;
    int span = end - start + 1;
    vec4 sum = vec4(0.0);

    for (int y = start; y <= end; ++y) {
        int cy = clamp(y, 0, dims.y - 1);
        sum += imageLoad(u_input, ivec2(gid.x, cy));
    }

    imageStore(u_output, gid, sum / float(span));
}
"#;

const CLASSIC_GLSL: &str = r#"#version 450

layout(set=0, binding=0, rgba16f) uniform readonly image2D u_input;
layout(set=0, binding=1, rgba16f) uniform writeonly image2D u_output;
layout(set=0, binding=3, rgba16f) uniform readonly image2D u_mask;

layout(std140, set=0, binding=2) uniform Params {
    float radius;
    float _pad0;
    float _pad1;
    float _pad2;
};

layout(local_size_x=16, local_size_y=16) in;
void main() {
    ivec2 gid = ivec2(gl_GlobalInvocationID.xy);
    ivec2 dims = imageSize(u_input);
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    int r = int(radius);
    vec4 original = imageLoad(u_input, gid);
    vec4 best_mean = original;
    float min_variance = 1e20;

    ivec2 quadrant_signs[4] = ivec2[4](
        ivec2(1, 1),
        ivec2(-1, 1),
        ivec2(1, -1),
        ivec2(-1, -1)
    );

    for (int q = 0; q < 4; ++q) {
        int sx = quadrant_signs[q].x;
        int sy = quadrant_signs[q].y;
        int x_start = (sx > 0) ? gid.x : gid.x - r;
        int x_end = (sx < 0) ? gid.x : gid.x + r;
        int y_start = (sy > 0) ? gid.y : gid.y - r;
        int y_end = (sy < 0) ? gid.y : gid.y + r;

        vec4 sum = vec4(0.0);
        vec4 sum_sq = vec4(0.0);
        float count = 0.0;

        for (int ny = y_start; ny <= y_end; ++ny) {
            int cy = clamp(ny, 0, dims.y - 1);
            for (int nx = x_start; nx <= x_end; ++nx) {
                int cx = clamp(nx, 0, dims.x - 1);
                vec4 color = imageLoad(u_input, ivec2(cx, cy));
                sum += color;
                sum_sq += color * color;
                count += 1.0;
            }
        }

        if (count < 1.0) {
            continue;
        }
        float inv = 1.0 / count;
        vec4 mean = sum * inv;
        vec4 mean_sq = sum_sq * inv;
        vec4 var = mean_sq - mean * mean;
        float variance = max(var.r, 0.0) + max(var.g, 0.0) + max(var.b, 0.0);

        if (variance < min_variance) {
            min_variance = variance;
            best_mean = mean;
        }
    }

    ivec2 mask_dims = imageSize(u_mask);
    ivec2 mask_coord = clamp(gid, ivec2(0), mask_dims - ivec2(1));
    vec4 mask_color = imageLoad(u_mask, mask_coord);
    float mask_lum = clamp(dot(mask_color.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    vec4 result = mix(original, best_mean, mask_lum);
    imageStore(u_output, gid, result);
}
"#;

const ANISOTROPIC_GLSL: &str = r#"#version 450

layout(set=0, binding=0, rgba16f) uniform readonly image2D u_input;
layout(set=0, binding=1, rgba16f) uniform writeonly image2D u_output;
layout(set=0, binding=3, rgba16f) uniform readonly image2D u_mask;
layout(set=0, binding=4, rgba16f) uniform readonly image2D u_tensor;

layout(std140, set=0, binding=2) uniform Params {
    float radius;
    float sharpness;
    float eccentricity;
    float _pad0;
};

layout(local_size_x=16, local_size_y=16) in;
void main() {
    ivec2 gid = ivec2(gl_GlobalInvocationID.xy);
    ivec2 dims = imageSize(u_input);
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    float PI = 3.14159265358979323846;
    float SQRT2_INV = 0.7071067811865475244;

    vec4 tensor = imageLoad(u_tensor, gid);
    float dxdx = tensor.x;
    float dxdy = tensor.y;
    float dydy = tensor.w;

    float half_sum = (dxdx + dydy) * 0.5;
    float discriminant = sqrt((dxdx - dydy) * (dxdx - dydy) + 4.0 * dxdy * dxdy) * 0.5;
    float eigenvalue1 = half_sum + discriminant;
    float eigenvalue2 = half_sum - discriminant;

    float ev_x = eigenvalue1 - dxdx;
    float ev_y = -dxdy;
    float ev_len = sqrt(ev_x * ev_x + ev_y * ev_y);
    vec2 unit = ev_len > 1e-10 ? vec2(ev_x / ev_len, ev_y / ev_len) : vec2(1.0, 0.0);

    float eigen_sum = eigenvalue1 + eigenvalue2;
    float eigen_diff = eigenvalue1 - eigenvalue2;
    float anisotropy = eigen_sum > 0.0 ? eigen_diff / eigen_sum : 0.0;

    float radius_f = radius;
    float width_factor = (eccentricity + anisotropy) / eccentricity;
    float ellipse_w = width_factor * radius_f;
    float ellipse_h = radius_f / width_factor;

    float cosine = unit.x;
    float sine = unit.y;

    float inv_00 = cosine / ellipse_w;
    float inv_01 = sine / ellipse_w;
    float inv_10 = -sine / ellipse_h;
    float inv_11 = cosine / ellipse_h;

    float major_x = ellipse_w * unit.x;
    float major_y = ellipse_w * unit.y;
    float minor_x = ellipse_h * (-unit.y);
    float minor_y = ellipse_h * unit.x;
    int bound_x = int(ceil(sqrt(major_x * major_x + minor_x * minor_x)));
    int bound_y = int(ceil(sqrt(major_y * major_y + minor_y * minor_y)));

    float sector_center_overlap = 2.0 / radius_f;
    float sector_envelope_angle = (3.0 / 2.0) * PI / float(8);
    float cross_sector_overlap =
        (sector_center_overlap + cos(sector_envelope_angle))
        / (sin(sector_envelope_angle) * sin(sector_envelope_angle));

    vec4 w_mean_color[8];
    vec4 w_mean_sq_color[8];
    float w_sum[8];
    for (int s = 0; s < 8; ++s) {
        w_mean_color[s] = vec4(0.0);
        w_mean_sq_color[s] = vec4(0.0);
        w_sum[s] = 0.0;
    }

    vec4 center_color = imageLoad(u_input, gid);
    float cw = 1.0 / float(8);
    for (int s = 0; s < 8; ++s) {
        w_mean_color[s] = center_color * cw;
        w_mean_sq_color[s] = center_color * center_color * cw;
        w_sum[s] = cw;
    }

    for (int j = 0; j <= bound_y; ++j) {
        for (int ii = -bound_x; ii <= bound_x; ++ii) {
            if (j == 0 && ii <= 0) {
                continue;
            }

            float dp_x = inv_00 * float(ii) + inv_01 * float(j);
            float dp_y = inv_10 * float(ii) + inv_11 * float(j);
            float dp_len_sq = dp_x * dp_x + dp_y * dp_y;
            if (dp_len_sq > 1.0) {
                continue;
            }

            float poly_x = sector_center_overlap - cross_sector_overlap * dp_x * dp_x;
            float poly_y = sector_center_overlap - cross_sector_overlap * dp_y * dp_y;

            float sector_weights[8];
            for (int s = 0; s < 8; ++s) {
                sector_weights[s] = 0.0;
            }

            float v0 = dp_y + poly_x;
            sector_weights[0] = v0 > 0.0 ? v0 * v0 : 0.0;
            float v2 = -dp_x + poly_y;
            sector_weights[2] = v2 > 0.0 ? v2 * v2 : 0.0;
            float v4 = -dp_y + poly_x;
            sector_weights[4] = v4 > 0.0 ? v4 * v4 : 0.0;
            float v6 = dp_x + poly_y;
            sector_weights[6] = v6 > 0.0 ? v6 * v6 : 0.0;

            float rdp_x = SQRT2_INV * (dp_x - dp_y);
            float rdp_y = SQRT2_INV * (dp_x + dp_y);
            float rpoly_x = sector_center_overlap - cross_sector_overlap * rdp_x * rdp_x;
            float rpoly_y = sector_center_overlap - cross_sector_overlap * rdp_y * rdp_y;

            float v1 = rdp_y + rpoly_x;
            sector_weights[1] = v1 > 0.0 ? v1 * v1 : 0.0;
            float v3 = -rdp_x + rpoly_y;
            sector_weights[3] = v3 > 0.0 ? v3 * v3 : 0.0;
            float v5 = -rdp_y + rpoly_x;
            sector_weights[5] = v5 > 0.0 ? v5 * v5 : 0.0;
            float v7 = rdp_x + rpoly_y;
            sector_weights[7] = v7 > 0.0 ? v7 * v7 : 0.0;

            float sw_sum = 0.0;
            for (int s = 0; s < 8; ++s) {
                sw_sum += sector_weights[s];
            }
            if (sw_sum < 1e-10) {
                continue;
            }
            float radial_gauss = exp(-PI * dp_len_sq) / sw_sum;

            int ux = clamp(gid.x + ii, 0, dims.x - 1);
            int uy = clamp(gid.y + j, 0, dims.y - 1);
            int lx = clamp(gid.x - ii, 0, dims.x - 1);
            int ly = clamp(gid.y - j, 0, dims.y - 1);

            vec4 upper = imageLoad(u_input, ivec2(ux, uy));
            vec4 lower = imageLoad(u_input, ivec2(lx, ly));

            for (int k = 0; k < 8; ++k) {
                float weight = sector_weights[k] * radial_gauss;
                w_sum[k] += weight;
                w_mean_color[k] += upper * weight;
                w_mean_sq_color[k] += upper * upper * weight;

                int lower_k = (k + 8 / 2) % 8;
                w_sum[lower_k] += weight;
                w_mean_color[lower_k] += lower * weight;
                w_mean_sq_color[lower_k] += lower * lower * weight;
            }
        }
    }

    float total_weight = 0.0;
    vec4 weighted_color = vec4(0.0);
    for (int s = 0; s < 8; ++s) {
        if (w_sum[s] < 1e-10) {
            continue;
        }
        float inv_w = 1.0 / w_sum[s];
        vec4 color_mean = w_mean_color[s] * inv_w;
        vec4 color_mean_sq = w_mean_sq_color[s] * inv_w;
        vec4 var = abs(color_mean_sq - color_mean * color_mean);
        float std_dev = sqrt(var.r) + sqrt(var.g) + sqrt(var.b);

        float w_sector = 1.0 / pow(max(0.02, std_dev), sharpness);
        total_weight += w_sector;
        weighted_color += color_mean * w_sector;
    }

    vec4 filtered = total_weight > 0.0 ? (weighted_color / total_weight) : center_color;
    ivec2 mask_dims = imageSize(u_mask);
    ivec2 mask_coord = clamp(gid, ivec2(0), mask_dims - ivec2(1));
    vec4 mask_color = imageLoad(u_mask, mask_coord);
    float mask_lum = clamp(dot(mask_color.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    vec4 result = mix(center_color, filtered, mask_lum);
    imageStore(u_output, gid, result);
}
"#;
