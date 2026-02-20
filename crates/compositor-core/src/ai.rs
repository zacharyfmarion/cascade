use crate::error::CompositorError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    Completed { result: AiPredictionResult },
    /// Job failed.
    Failed { error: String },
    /// Job was cancelled.
    Cancelled,
}

/// A value that can be sent as input to a Replicate model prediction.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AiInputValue {
    /// A string value (text, data URIs, URLs).
    String(String),
    /// A numeric value (integer or float).
    Number(f64),
    /// A boolean value.
    Bool(bool),
}

impl From<&str> for AiInputValue {
    fn from(s: &str) -> Self {
        AiInputValue::String(s.to_string())
    }
}

impl From<String> for AiInputValue {
    fn from(s: String) -> Self {
        AiInputValue::String(s)
    }
}

impl From<f64> for AiInputValue {
    fn from(n: f64) -> Self {
        AiInputValue::Number(n)
    }
}

impl From<bool> for AiInputValue {
    fn from(b: bool) -> Self {
        AiInputValue::Bool(b)
    }
}

/// Request to run an AI model prediction via Replicate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiPredictionRequest {
    /// The Replicate model version hash (e.g., "b239ea33cff3...").
    pub version: String,
    /// Input parameters for the model. Keys and value types depend on the model.
    /// Images should be passed as base64 data URIs: "data:image/png;base64,..."
    pub input: HashMap<String, AiInputValue>,
}

/// The result of a successful AI prediction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiPredictionResult {
    /// The raw output from the prediction. Model-dependent format.
    /// For image models, this typically contains URL(s) to the output image(s).
    pub output: AiPredictionOutput,
}

/// Output from a Replicate prediction. Different models return different shapes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AiPredictionOutput {
    /// A single string output (e.g., a URL to a generated image).
    String(String),
    /// A list of string outputs (e.g., multiple image URLs).
    StringList(Vec<String>),
    /// A map of named outputs (e.g., depth-anything returns { color_depth, grey_depth }).
    Map(HashMap<String, serde_json::Value>),
}

impl AiPredictionOutput {
    /// Get the first URL from the output, regardless of shape.
    pub fn first_url(&self) -> Option<&str> {
        match self {
            AiPredictionOutput::String(s) => Some(s.as_str()),
            AiPredictionOutput::StringList(list) => list.first().map(|s| s.as_str()),
            AiPredictionOutput::Map(_) => None,
        }
    }

    /// Get a named field from a map output.
    pub fn get_field(&self, key: &str) -> Option<&serde_json::Value> {
        match self {
            AiPredictionOutput::Map(map) => map.get(key),
            _ => None,
        }
    }
}

/// Return type for async AI operations, platform-conditional Send bound.
#[cfg(not(target_arch = "wasm32"))]
pub type AiFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, CompositorError>> + Send + 'a>>;

#[cfg(target_arch = "wasm32")]
pub type AiFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, CompositorError>> + 'a>>;

/// Trait for AI prediction providers (Replicate).
/// Implemented differently for native (reqwest) and WASM (fetch).
pub trait AiProvider: Send + Sync {
    /// Check whether this provider is configured (has API key, etc.).
    fn is_configured(&self) -> bool;

    /// Submit a prediction request. Returns immediately with a job ID.
    /// The actual prediction happens asynchronously.
    fn submit_job(&self, request: AiPredictionRequest) -> Result<AiJobId, CompositorError>;

    /// Poll the status of a previously submitted job.
    fn poll_job(&self, job_id: &AiJobId) -> Result<AiJobStatus, CompositorError>;

    /// Cancel an in-flight job (best effort).
    fn cancel_job(&self, job_id: &AiJobId) -> Result<(), CompositorError>;

    /// Execute a prediction synchronously and return the result.
    fn predict(&self, request: AiPredictionRequest) -> AiFuture<'_, AiPredictionResult>;

    /// Fetch raw bytes from a URL (used to download output images from Replicate).
    fn fetch_url(&self, url: &str) -> AiFuture<'_, Vec<u8>>;
}
