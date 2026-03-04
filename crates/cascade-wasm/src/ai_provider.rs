#[cfg(target_arch = "wasm32")]
mod imp {
    use cascade_core::ai::{
        AiFuture, AiJobId, AiJobStatus, AiPredictionOutput, AiPredictionRequest,
        AiPredictionResult, AiProvider,
    };
    use cascade_core::error::CascadeError;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use wasm_bindgen::JsCast;
    use wasm_bindgen_futures::JsFuture;
    use web_sys::{Headers, Request, RequestInit, Response};

    #[derive(Clone)]
    pub struct WasmAiProvider {
        api_key: Arc<Mutex<Option<String>>>,
        jobs: Arc<Mutex<HashMap<String, AiJobStatus>>>,
    }

    impl WasmAiProvider {
        pub fn new() -> Self {
            Self {
                api_key: Arc::new(Mutex::new(None)),
                jobs: Arc::new(Mutex::new(HashMap::new())),
            }
        }

        pub fn set_api_key(&self, key: String) {
            if let Ok(mut guard) = self.api_key.lock() {
                *guard = Some(key);
            }
        }

        fn get_api_key(&self) -> Result<String, CascadeError> {
            let guard = self
                .api_key
                .lock()
                .map_err(|_| CascadeError::Other("AI provider lock poisoned".to_string()))?;
            guard
                .as_ref()
                .filter(|k| !k.is_empty())
                .cloned()
                .ok_or_else(|| CascadeError::Other("AI provider not configured".to_string()))
        }

        async fn predict_async(
            &self,
            request: AiPredictionRequest,
        ) -> Result<AiPredictionResult, CascadeError> {
            let api_key = self.get_api_key()?;

            let (url, payload) = if let Some(ref model) = request.model {
                (
                    get_model_predictions_url(model),
                    serde_json::json!({ "input": request.input }),
                )
            } else {
                (
                    get_predictions_url(),
                    serde_json::json!({
                        "version": request.version,
                        "input": request.input,
                    }),
                )
            };
            let body = serde_json::to_string(&payload)
                .map_err(|e| CascadeError::Other(e.to_string()))?;

            let init = RequestInit::new();
            init.set_method("POST");
            init.set_body(&wasm_bindgen::JsValue::from_str(&body));

            let headers = Headers::new()
                .map_err(|_| CascadeError::Other("Failed to create headers".to_string()))?;
            headers
                .set("Content-Type", "application/json")
                .map_err(|_| CascadeError::Other("Failed to set content-type".to_string()))?;
            headers
                .set("Authorization", &format!("Bearer {api_key}"))
                .map_err(|_| CascadeError::Other("Failed to set authorization".to_string()))?;
            headers
                .set("Prefer", "wait")
                .map_err(|_| CascadeError::Other("Failed to set prefer header".to_string()))?;
            init.set_headers(&headers);

            let http_request = Request::new_with_str_and_init(&url, &init)
                .map_err(|e| CascadeError::Other(format!("Request init failed: {e:?}")))?;

            let response = fetch_request(http_request).await?;

            if !response.ok() {
                let status = response.status();
                let text = JsFuture::from(response.text().map_err(|_| {
                    CascadeError::Other("Failed to read error body".to_string())
                })?)
                .await
                .map_err(|_| CascadeError::Other("Failed to read error body".to_string()))?
                .as_string()
                .unwrap_or_default();
                return Err(CascadeError::Other(format!(
                    "Replicate API error ({status}): {text}"
                )));
            }

            let json_text =
                JsFuture::from(response.text().map_err(|_| {
                    CascadeError::Other("Failed to read response body".to_string())
                })?)
                .await
                .map_err(|_| CascadeError::Other("Failed to read response body".to_string()))?
                .as_string()
                .ok_or_else(|| {
                    CascadeError::Other("Response body is not a string".to_string())
                })?;

            let parsed: ReplicateResponse = serde_json::from_str(&json_text)
                .map_err(|e| CascadeError::Other(format!("Failed to parse response: {e}")))?;

            match parsed.status.as_str() {
                "succeeded" => {
                    let output = parsed.output.ok_or_else(|| {
                        CascadeError::Other(
                            "Prediction succeeded but output is null".to_string(),
                        )
                    })?;
                    Ok(AiPredictionResult { output })
                }
                "failed" | "canceled" => {
                    let error_msg = parsed.error.unwrap_or_else(|| parsed.status.clone());
                    Err(CascadeError::Other(format!(
                        "Prediction {}: {error_msg}",
                        parsed.status
                    )))
                }
                _ => Err(CascadeError::Other(format!(
                    "Unexpected prediction status: {}",
                    parsed.status
                ))),
            }
        }
    }

    impl AiProvider for WasmAiProvider {
        fn is_configured(&self) -> bool {
            self.api_key
                .lock()
                .map(|v| v.as_ref().map_or(false, |k| !k.is_empty()))
                .unwrap_or(false)
        }

        fn submit_job(&self, request: AiPredictionRequest) -> Result<AiJobId, CascadeError> {
            let job_id = uuid::Uuid::new_v4().to_string();
            let job_id_clone = job_id.clone();
            let jobs = Arc::clone(&self.jobs);
            let provider = self.clone();
            wasm_bindgen_futures::spawn_local(async move {
                let status = match provider.predict_async(request).await {
                    Ok(result) => AiJobStatus::Completed { result },
                    Err(err) => AiJobStatus::Failed {
                        error: err.to_string(),
                    },
                };
                if let Ok(mut guard) = jobs.lock() {
                    guard.insert(job_id_clone, status);
                }
            });
            Ok(AiJobId(job_id))
        }

        fn poll_job(&self, job_id: &AiJobId) -> Result<AiJobStatus, CascadeError> {
            let guard = self
                .jobs
                .lock()
                .map_err(|_| CascadeError::Other("AI jobs lock poisoned".to_string()))?;
            guard
                .get(&job_id.0)
                .cloned()
                .ok_or_else(|| CascadeError::Other("AI job not found".to_string()))
        }

        fn cancel_job(&self, job_id: &AiJobId) -> Result<(), CascadeError> {
            let mut guard = self
                .jobs
                .lock()
                .map_err(|_| CascadeError::Other("AI jobs lock poisoned".to_string()))?;
            guard.insert(job_id.0.clone(), AiJobStatus::Cancelled);
            Ok(())
        }

        fn predict(&self, request: AiPredictionRequest) -> AiFuture<'_, AiPredictionResult> {
            Box::pin(async move { self.predict_async(request).await })
        }

        fn fetch_url(&self, url: &str) -> AiFuture<'_, Vec<u8>> {
            let url = url.to_string();
            Box::pin(async move {
                let init = RequestInit::new();
                init.set_method("GET");
                let http_request = Request::new_with_str_and_init(&url, &init)
                    .map_err(|e| CascadeError::Other(format!("Request init failed: {e:?}")))?;
                let response = fetch_request(http_request).await?;
                if !response.ok() {
                    let status = response.status();
                    return Err(CascadeError::Other(format!(
                        "Failed to fetch URL ({status}): {url}"
                    )));
                }
                let array_buffer = JsFuture::from(
                    response
                        .array_buffer()
                        .map_err(|_| CascadeError::Other("Failed to read body".to_string()))?,
                )
                .await
                .map_err(|_| CascadeError::Other("Failed to read body".to_string()))?;
                let uint8_array = js_sys::Uint8Array::new(&array_buffer);
                Ok(uint8_array.to_vec())
            })
        }
    }

    #[derive(serde::Deserialize)]
    struct ReplicateResponse {
        status: String,
        output: Option<AiPredictionOutput>,
        error: Option<String>,
    }

    const WORKER_URL: &str = "https://cascade-api-proxy.compositor-proxy.workers.dev";

    fn is_local_dev() -> bool {
        web_sys::window()
            .and_then(|w| w.location().hostname().ok())
            .map(|h| h == "localhost" || h == "127.0.0.1")
            .unwrap_or(false)
    }

    fn get_predictions_url() -> String {
        if is_local_dev() {
            "/api/replicate/v1/predictions".to_string()
        } else {
            format!("{WORKER_URL}/v1/predictions")
        }
    }

    fn get_model_predictions_url(model: &str) -> String {
        if is_local_dev() {
            format!("/api/replicate/v1/models/{model}/predictions")
        } else {
            format!("{WORKER_URL}/v1/models/{model}/predictions")
        }
    }

    async fn fetch_request(request: Request) -> Result<Response, CascadeError> {
        let window =
            web_sys::window().ok_or_else(|| CascadeError::Other("No window".to_string()))?;
        let resp_value = JsFuture::from(window.fetch_with_request(&request))
            .await
            .map_err(|e| CascadeError::Other(format!("Fetch failed: {e:?}")))?;
        resp_value
            .dyn_into::<Response>()
            .map_err(|_| CascadeError::Other("Failed to read response".to_string()))
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    use cascade_core::ai::{
        AiFuture, AiJobId, AiJobStatus, AiPredictionRequest, AiPredictionResult, AiProvider,
    };
    use cascade_core::error::CascadeError;

    #[derive(Clone)]
    pub struct WasmAiProvider;

    impl WasmAiProvider {
        pub fn new() -> Self {
            Self
        }

        pub fn set_api_key(&self, _key: String) {}
    }

    impl AiProvider for WasmAiProvider {
        fn is_configured(&self) -> bool {
            false
        }

        fn submit_job(&self, _request: AiPredictionRequest) -> Result<AiJobId, CascadeError> {
            Err(CascadeError::Other(
                "AI provider only available for wasm32".to_string(),
            ))
        }

        fn poll_job(&self, _job_id: &AiJobId) -> Result<AiJobStatus, CascadeError> {
            Err(CascadeError::Other(
                "AI provider only available for wasm32".to_string(),
            ))
        }

        fn cancel_job(&self, _job_id: &AiJobId) -> Result<(), CascadeError> {
            Err(CascadeError::Other(
                "AI provider only available for wasm32".to_string(),
            ))
        }

        fn predict(&self, _request: AiPredictionRequest) -> AiFuture<'_, AiPredictionResult> {
            Box::pin(async move {
                Err(CascadeError::Other(
                    "AI provider only available for wasm32".to_string(),
                ))
            })
        }

        fn fetch_url(&self, _url: &str) -> AiFuture<'_, Vec<u8>> {
            Box::pin(async move {
                Err(CascadeError::Other(
                    "AI provider only available for wasm32".to_string(),
                ))
            })
        }
    }
}

pub use imp::WasmAiProvider;
