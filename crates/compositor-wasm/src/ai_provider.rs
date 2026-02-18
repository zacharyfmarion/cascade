#[cfg(target_arch = "wasm32")]
mod imp {
    use base64::{engine::general_purpose, Engine as _};
    use compositor_core::ai::{
        AiFuture, AiImageRequest, AiImageResult, AiJobId, AiJobStatus, AiProvider,
    };
    use compositor_core::error::CompositorError;
    use image::GenericImageView;
    use js_sys::{Array, Uint8Array};
    use serde::Deserialize;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use wasm_bindgen::JsCast;
    use wasm_bindgen_futures::JsFuture;
    use web_sys::{Blob, BlobPropertyBag, FormData, Headers, Request, RequestInit, Response};

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

        async fn submit_async(
            &self,
            request: AiImageRequest,
        ) -> Result<AiImageResult, CompositorError> {
            let api_key = self.get_api_key()?;
            let (response, format_size) = if request.input_image.is_some() {
                let form = build_form_data(&request)?;
                let init = RequestInit::new();
                init.set_method("POST");
                init.set_body(&form);

                let headers = Headers::new()
                    .map_err(|_| CompositorError::Other("Failed to create headers".to_string()))?;
                headers
                    .set("Authorization", &format!("Bearer {api_key}"))
                    .map_err(|_| {
                        CompositorError::Other("Failed to set authorization".to_string())
                    })?;
                init.set_headers(&headers);

                let http_request =
                    Request::new_with_str_and_init("https://api.openai.com/v1/images/edits", &init)
                        .map_err(|e| {
                            CompositorError::Other(format!("Request init failed: {e:?}"))
                        })?;
                let response = fetch_request(http_request).await?;
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
                let body = serde_json::to_string(&payload)
                    .map_err(|e| CompositorError::Other(e.to_string()))?;

                let init = RequestInit::new();
                init.set_method("POST");
                init.set_body(&wasm_bindgen::JsValue::from_str(&body));

                let headers = Headers::new()
                    .map_err(|_| CompositorError::Other("Failed to create headers".to_string()))?;
                headers
                    .set("Content-Type", "application/json")
                    .map_err(|_| {
                        CompositorError::Other("Failed to set content-type".to_string())
                    })?;
                headers
                    .set("Authorization", &format!("Bearer {api_key}"))
                    .map_err(|_| {
                        CompositorError::Other("Failed to set authorization".to_string())
                    })?;
                init.set_headers(&headers);

                let http_request = Request::new_with_str_and_init(
                    "https://api.openai.com/v1/images/generations",
                    &init,
                )
                .map_err(|e| CompositorError::Other(format!("Request init failed: {e:?}")))?;
                let response = fetch_request(http_request).await?;
                (response, (request.width, request.height))
            };

            if !response.ok() {
                let status = response.status();
                let text = JsFuture::from(response.text().map_err(|_| {
                    CompositorError::Other("Failed to read error body".to_string())
                })?)
                .await
                .map_err(|_| CompositorError::Other("Failed to read error body".to_string()))?
                .as_string()
                .unwrap_or_default();
                return Err(CompositorError::Other(format!(
                    "AI request failed ({status}): {text}"
                )));
            }

            let json = JsFuture::from(
                response
                    .json()
                    .map_err(|_| CompositorError::Other("Failed to parse response".to_string()))?,
            )
            .await
            .map_err(|_| CompositorError::Other("Failed to parse response".to_string()))?;
            let decoded: ImageResponse = serde_wasm_bindgen::from_value(json)
                .map_err(|e| CompositorError::Other(e.to_string()))?;

            let b64 = decoded
                .data
                .first()
                .and_then(|d| d.b64_json.as_ref())
                .ok_or_else(|| {
                    CompositorError::Other("AI response missing image data".to_string())
                })?;
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

    impl AiProvider for WasmAiProvider {
        fn is_configured(&self) -> bool {
            self.api_key
                .lock()
                .map(|v| v.as_ref().map_or(false, |k| !k.is_empty()))
                .unwrap_or(false)
        }

        fn submit_job(&self, request: AiImageRequest) -> Result<AiJobId, CompositorError> {
            let job_id = uuid::Uuid::new_v4().to_string();
            let job_id_clone = job_id.clone();
            let jobs = Arc::clone(&self.jobs);
            let provider = self.clone();
            wasm_bindgen_futures::spawn_local(async move {
                let status = match provider.submit_async(request).await {
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
            Box::pin(async move { self.submit_async(request).await })
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

    fn build_form_data(request: &AiImageRequest) -> Result<FormData, CompositorError> {
        let form = FormData::new()
            .map_err(|_| CompositorError::Other("FormData init failed".to_string()))?;
        form.append_with_str("prompt", &request.prompt)
            .map_err(|_| CompositorError::Other("Failed to set prompt".to_string()))?;
        form.append_with_str("model", &request.model)
            .map_err(|_| CompositorError::Other("Failed to set model".to_string()))?;
        form.append_with_str("response_format", "b64_json")
            .map_err(|_| CompositorError::Other("Failed to set response format".to_string()))?;

        if let Some(quality) = &request.quality {
            form.append_with_str("quality", quality)
                .map_err(|_| CompositorError::Other("Failed to set quality".to_string()))?;
        }

        if let (Some(width), Some(height)) = (request.width, request.height) {
            form.append_with_str("size", &format!("{width}x{height}"))
                .map_err(|_| CompositorError::Other("Failed to set size".to_string()))?;
        }

        if let Some(image) = &request.input_image {
            let blob = bytes_to_png_blob(image)?;
            form.append_with_blob_and_filename("image", &blob, "image.png")
                .map_err(|_| CompositorError::Other("Failed to set image".to_string()))?;
        }

        if let Some(mask) = &request.mask {
            let blob = bytes_to_png_blob(mask)?;
            form.append_with_blob_and_filename("mask", &blob, "mask.png")
                .map_err(|_| CompositorError::Other("Failed to set mask".to_string()))?;
        }

        Ok(form)
    }

    fn bytes_to_png_blob(bytes: &[u8]) -> Result<Blob, CompositorError> {
        let array = Uint8Array::from(bytes);
        let parts = Array::new();
        parts.push(&array);
        let bag = BlobPropertyBag::new();
        bag.set_type("image/png");
        Blob::new_with_u8_array_sequence_and_options(&parts, &bag)
            .map_err(|_| CompositorError::Other("Failed to create blob".to_string()))
    }

    async fn fetch_request(request: Request) -> Result<Response, CompositorError> {
        let window =
            web_sys::window().ok_or_else(|| CompositorError::Other("No window".to_string()))?;
        let resp_value = JsFuture::from(window.fetch_with_request(&request))
            .await
            .map_err(|e| CompositorError::Other(format!("Fetch failed: {e:?}")))?;
        resp_value
            .dyn_into::<Response>()
            .map_err(|_| CompositorError::Other("Failed to read response".to_string()))
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    use compositor_core::ai::{
        AiFuture, AiImageRequest, AiImageResult, AiJobId, AiJobStatus, AiProvider,
    };
    use compositor_core::error::CompositorError;

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

        fn submit_job(&self, _request: AiImageRequest) -> Result<AiJobId, CompositorError> {
            Err(CompositorError::Other(
                "AI provider only available for wasm32".to_string(),
            ))
        }

        fn poll_job(&self, _job_id: &AiJobId) -> Result<AiJobStatus, CompositorError> {
            Err(CompositorError::Other(
                "AI provider only available for wasm32".to_string(),
            ))
        }

        fn cancel_job(&self, _job_id: &AiJobId) -> Result<(), CompositorError> {
            Err(CompositorError::Other(
                "AI provider only available for wasm32".to_string(),
            ))
        }

        fn generate_sync(&self, _request: AiImageRequest) -> AiFuture<'_, AiImageResult> {
            Box::pin(async move {
                Err(CompositorError::Other(
                    "AI provider only available for wasm32".to_string(),
                ))
            })
        }
    }
}

pub use imp::WasmAiProvider;
