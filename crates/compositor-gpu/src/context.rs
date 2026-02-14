use std::sync::{Arc, Mutex};

use ahash::AHashMap;

pub struct CachedPipeline {
    pub pipeline: Arc<wgpu::ComputePipeline>,
    pub bind_group_layout: Arc<wgpu::BindGroupLayout>,
}

pub struct GpuContext {
    pub device: Arc<wgpu::Device>,
    pub queue: Arc<wgpu::Queue>,
    pipelines: Mutex<AHashMap<u64, CachedPipeline>>,
}

impl GpuContext {
    pub fn new() -> Result<Self, String> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            ..Default::default()
        }))
        .ok_or("No GPU adapter found")?;

        let (device, queue) = pollster::block_on(adapter.request_device(
            &wgpu::DeviceDescriptor {
                label: Some("Compositor GPU"),
                required_features: wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES,
                required_limits: adapter.limits(),
                ..Default::default()
            },
            None,
        ))
        .map_err(|e| e.to_string())?;

        Ok(Self {
            device: Arc::new(device),
            queue: Arc::new(queue),
            pipelines: Mutex::new(AHashMap::new()),
        })
    }

    pub fn get_pipeline(&self, key: u64) -> Option<CachedPipeline> {
        self.pipelines
            .lock()
            .ok()
            .and_then(|map| map.get(&key).cloned())
    }

    pub fn insert_pipeline(&self, key: u64, pipeline: CachedPipeline) {
        if let Ok(mut map) = self.pipelines.lock() {
            map.insert(key, pipeline);
        }
    }
}

impl Clone for CachedPipeline {
    fn clone(&self) -> Self {
        Self {
            pipeline: self.pipeline.clone(),
            bind_group_layout: self.bind_group_layout.clone(),
        }
    }
}
