use crate::error::CompositorError;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;

/// Unique identifier for an in-flight AI job.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AiJobId(pub String);

/// Status of an AI job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AiJobStatus {
    /// Job is queued but not yet started.
    Queued,
    /// Job is actively running. Progress is 0.0..1.0 if available.
    Running { progress: Option<f32> },
    /// Job completed successfully.
    Completed { result: AiImageResult },
    /// Job failed.
    Failed { error: String },
    /// Job was cancelled.
    Cancelled,
}

/// The result of a successful AI image generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiImageResult {
    /// Raw image bytes (PNG or JPEG encoded).
    pub image_bytes: Vec<u8>,
    /// Width of the generated image.
    pub width: u32,
    /// Height of the generated image.
    pub height: u32,
}

/// Request to generate/edit an image using AI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiImageRequest {
    /// The text prompt describing the desired output.
    pub prompt: String,
    /// The AI model to use (e.g., "gpt-image-1", "dall-e-3").
    pub model: String,
    /// Optional input image (PNG-encoded bytes) for img2img / inpainting.
    pub input_image: Option<Vec<u8>>,
    /// Optional mask image (PNG-encoded bytes) for inpainting. White = edit region.
    pub mask: Option<Vec<u8>>,
    /// Desired output width.
    pub width: Option<u32>,
    /// Desired output height.
    pub height: Option<u32>,
    /// Provider-specific quality setting (e.g., "low", "medium", "high").
    pub quality: Option<String>,
}

/// Return type for async AI operations, platform-conditional Send bound.
#[cfg(not(target_arch = "wasm32"))]
pub type AiFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, CompositorError>> + Send + 'a>>;

#[cfg(target_arch = "wasm32")]
pub type AiFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, CompositorError>> + 'a>>;

/// Trait for AI image generation providers.
/// Implemented differently for native (reqwest) and WASM (fetch).
pub trait AiProvider: Send + Sync {
    /// Check whether this provider is configured (has API key, etc.).
    fn is_configured(&self) -> bool;

    /// Submit an image generation request. Returns immediately with a job ID.
    /// The actual generation happens asynchronously.
    fn submit_job(&self, request: AiImageRequest) -> Result<AiJobId, CompositorError>;

    /// Poll the status of a previously submitted job.
    fn poll_job(&self, job_id: &AiJobId) -> Result<AiJobStatus, CompositorError>;

    /// Cancel an in-flight job (best effort).
    fn cancel_job(&self, job_id: &AiJobId) -> Result<(), CompositorError>;

    /// Execute a request synchronously/blocking and return the result.
    /// This is a convenience for simple cases; calls submit + poll loop internally.
    fn generate_sync(&self, request: AiImageRequest) -> AiFuture<'_, AiImageResult>;
}
