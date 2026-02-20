use compositor_core::ai::{
    AiFuture, AiPredictionOutput, AiPredictionRequest, AiPredictionResult, AiJobId, AiJobStatus,
    AiProvider,
};
use compositor_core::error::CompositorError;
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

    fn predict_blocking(
        &self,
        request: AiPredictionRequest,
    ) -> Result<AiPredictionResult, CompositorError> {
        let api_key = self.get_api_key()?;

        let payload = serde_json::json!({
            "version": request.version,
            "input": request.input,
        });

        let response = self
            .client
            .post("https://api.replicate.com/v1/predictions")
            .bearer_auth(&api_key)
            .header("Content-Type", "application/json")
            .header("Prefer", "wait")
            .json(&payload)
            .send()
            .map_err(|e| CompositorError::Other(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            return Err(CompositorError::Other(format!(
                "Replicate API error ({status}): {body}"
            )));
        }

        let parsed: ReplicateResponse = response
            .json()
            .map_err(|e| CompositorError::Other(format!("Failed to parse response: {e}")))?;

        match parsed.status.as_str() {
            "succeeded" => {
                let output = parsed.output.ok_or_else(|| {
                    CompositorError::Other(
                        "Prediction succeeded but output is null".to_string(),
                    )
                })?;
                Ok(AiPredictionResult { output })
            }
            "failed" | "canceled" => {
                let error_msg = parsed.error.unwrap_or_else(|| parsed.status.clone());
                Err(CompositorError::Other(format!(
                    "Prediction {}: {error_msg}",
                    parsed.status
                )))
            }
            _ => Err(CompositorError::Other(format!(
                "Unexpected prediction status: {}",
                parsed.status
            ))),
        }
    }

    fn fetch_url_blocking(&self, url: &str) -> Result<Vec<u8>, CompositorError> {
        let response = self
            .client
            .get(url)
            .send()
            .map_err(|e| CompositorError::Other(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            return Err(CompositorError::Other(format!(
                "Failed to fetch URL ({status}): {url}"
            )));
        }

        response
            .bytes()
            .map(|b| b.to_vec())
            .map_err(|e| CompositorError::Other(e.to_string()))
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

    fn submit_job(&self, request: AiPredictionRequest) -> Result<AiJobId, CompositorError> {
        let job_id = uuid::Uuid::new_v4().to_string();
        let status = match self.predict_blocking(request) {
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

    fn predict(&self, request: AiPredictionRequest) -> AiFuture<'_, AiPredictionResult> {
        Box::pin(async move { self.predict_blocking(request) })
    }

    fn fetch_url(&self, url: &str) -> AiFuture<'_, Vec<u8>> {
        let url = url.to_string();
        Box::pin(async move { self.fetch_url_blocking(&url) })
    }
}

#[derive(Deserialize)]
struct ReplicateResponse {
    status: String,
    output: Option<AiPredictionOutput>,
    error: Option<String>,
}
