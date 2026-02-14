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

// SAFETY: On WASM, execution is single-threaded. wgpu's WebGPU backend types
// contain JsValue (*mut u8) which isn't Send/Sync, but this is safe because
// there are no threads on wasm32.
#[cfg(target_arch = "wasm32")]
unsafe impl Send for GpuContext {}
#[cfg(target_arch = "wasm32")]
unsafe impl Sync for GpuContext {}

impl GpuContext {
    /// Create a new GPU context asynchronously. Works on both native and WASM.
    pub async fn new_async() -> Result<Self, String> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                ..Default::default()
            })
            .await
            .ok_or("No GPU adapter found")?;

        // Only request TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES if the adapter supports it.
        // This feature is commonly unavailable in browser WebGPU implementations.
        let mut features = wgpu::Features::empty();
        if adapter
            .features()
            .contains(wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES)
        {
            features |= wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES;
        }

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Compositor GPU"),
                    required_features: features,
                    required_limits: adapter.limits(),
                    ..Default::default()
                },
                None,
            )
            .await
            .map_err(|e| e.to_string())?;

        Ok(Self {
            device: Arc::new(device),
            queue: Arc::new(queue),
            pipelines: Mutex::new(AHashMap::new()),
        })
    }

    /// Synchronous wrapper for native (non-WASM) contexts.
    /// Uses pollster to block on the async init.
    pub fn new() -> Result<Self, String> {
        pollster::block_on(Self::new_async())
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
