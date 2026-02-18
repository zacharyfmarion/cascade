use base64::{engine::general_purpose, Engine as _};
use compositor_core::ai::{
    AiFuture, AiImageRequest, AiImageResult, AiJobId, AiJobStatus, AiProvider,
};
use compositor_core::error::CompositorError;
use image::GenericImageView;
use reqwest::blocking::multipart::{Form, Part};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct NativeAiProvider {
    api_key: Arc<Mutex<Option<String>>>,
    jobs: Arc<Mutex<HashMap<String, AiJobStatus>>>,
    client: Client,
}

impl NativeAiProvider {
    pub fn new() -> Self {
        Self {
            api_key: Arc::new(Mutex::new(None)),
            jobs: Arc::new(Mutex::new(HashMap::new())),
            client: Client::new(),
        }
    }

    pub fn set_api_key(&self, key: String) {
        if let Ok(mut guard) = self.api_key.lock() {
            *guard = Some(key);
        }
    }

    fn get_api_key(&self) -> Result<String, CompositorError> {
        let guard = self
            .api_key
            .lock()
            .map_err(|_| CompositorError::Other("AI provider lock poisoned".to_string()))?;
        guard
            .as_ref()
            .filter(|k| !k.is_empty())
            .cloned()
            .ok_or_else(|| CompositorError::Other("AI provider not configured".to_string()))
    }

    fn submit_blocking(&self, request: AiImageRequest) -> Result<AiImageResult, CompositorError> {
        let api_key = self.get_api_key()?;
        let (response, format_size) = if request.input_image.is_some() {
            let mut form = Form::new()
                .text("prompt", request.prompt)
                .text("model", request.model)
                .text("response_format", "b64_json");

            if let Some(quality) = request.quality {
                form = form.text("quality", quality);
            }

            if let (Some(width), Some(height)) = (request.width, request.height) {
                form = form.text("size", format!("{width}x{height}"));
            }

            if let Some(image) = request.input_image {
                let part = Part::bytes(image)
                    .file_name("image.png")
                    .mime_str("image/png")
                    .map_err(|e| CompositorError::Other(e.to_string()))?;
                form = form.part("image", part);
            }

            if let Some(mask) = request.mask {
                let part = Part::bytes(mask)
                    .file_name("mask.png")
                    .mime_str("image/png")
                    .map_err(|e| CompositorError::Other(e.to_string()))?;
                form = form.part("mask", part);
            }

            let response = self
                .client
                .post("https://api.openai.com/v1/images/edits")
                .bearer_auth(api_key)
                .multipart(form)
                .send()
                .map_err(|e| CompositorError::Other(e.to_string()))?;
            (response, (request.width, request.height))
        } else {
            let size = match (request.width, request.height) {
                (Some(width), Some(height)) => format!("{width}x{height}"),
                _ => "1024x1024".to_string(),
            };

            let payload = GenerationRequest {
                prompt: request.prompt,
                model: request.model,
                size,
                response_format: "b64_json".to_string(),
                quality: request.quality,
            };
            let response = self
                .client
                .post("https://api.openai.com/v1/images/generations")
                .bearer_auth(api_key)
                .json(&payload)
                .send()
                .map_err(|e| CompositorError::Other(e.to_string()))?;
            (response, (request.width, request.height))
        };

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            return Err(CompositorError::Other(format!(
                "AI request failed ({status}): {body}"
            )));
        }

        let decoded: ImageResponse = response
            .json()
            .map_err(|e| CompositorError::Other(e.to_string()))?;
        let b64 = decoded
            .data
            .first()
            .and_then(|d| d.b64_json.as_ref())
            .ok_or_else(|| CompositorError::Other("AI response missing image data".to_string()))?;
        let image_bytes = general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| CompositorError::Other(e.to_string()))?;

        let (width, height) = match format_size {
            (Some(width), Some(height)) => (width, height),
            _ => {
                let img = image::load_from_memory(&image_bytes)
                    .map_err(|e| CompositorError::ImageDecode(e.to_string()))?;
                img.dimensions()
            }
        };

        Ok(AiImageResult {
            image_bytes,
            width,
            height,
        })
    }
}

impl Default for NativeAiProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl AiProvider for NativeAiProvider {
    fn is_configured(&self) -> bool {
        self.api_key
            .lock()
            .map(|v| v.as_ref().is_some_and(|k| !k.is_empty()))
            .unwrap_or(false)
    }

    fn submit_job(&self, request: AiImageRequest) -> Result<AiJobId, CompositorError> {
        let job_id = uuid::Uuid::new_v4().to_string();
        let status = match self.submit_blocking(request) {
            Ok(result) => AiJobStatus::Completed { result },
            Err(err) => AiJobStatus::Failed {
                error: err.to_string(),
            },
        };
        let mut guard = self
            .jobs
            .lock()
            .map_err(|_| CompositorError::Other("AI jobs lock poisoned".to_string()))?;
        guard.insert(job_id.clone(), status);
        Ok(AiJobId(job_id))
    }

    fn poll_job(&self, job_id: &AiJobId) -> Result<AiJobStatus, CompositorError> {
        let guard = self
            .jobs
            .lock()
            .map_err(|_| CompositorError::Other("AI jobs lock poisoned".to_string()))?;
        guard
            .get(&job_id.0)
            .cloned()
            .ok_or_else(|| CompositorError::Other("AI job not found".to_string()))
    }

    fn cancel_job(&self, job_id: &AiJobId) -> Result<(), CompositorError> {
        let mut guard = self
            .jobs
            .lock()
            .map_err(|_| CompositorError::Other("AI jobs lock poisoned".to_string()))?;
        guard.insert(job_id.0.clone(), AiJobStatus::Cancelled);
        Ok(())
    }

    fn generate_sync(&self, request: AiImageRequest) -> AiFuture<'_, AiImageResult> {
        Box::pin(async move { self.submit_blocking(request) })
    }
}

#[derive(Deserialize)]
struct ImageResponse {
    data: Vec<ImageData>,
}

#[derive(Deserialize)]
struct ImageData {
    #[serde(rename = "b64_json")]
    b64_json: Option<String>,
}

#[derive(serde::Serialize)]
struct GenerationRequest {
    prompt: String,
    model: String,
    size: String,
    #[serde(rename = "response_format")]
    response_format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    quality: Option<String>,
}
