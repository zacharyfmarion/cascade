use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::sync::Mutex;

use cascade_core::color::{ColorManagement, ColorProcessor, ColorSpaceInfo};
use cascade_core::error::CascadeError;
use cascade_core::types::ColorSpaceId;
use cascade_ocio_sys as ffi;
use rayon::prelude::*;

pub struct OcioColorManagement {
    config: *mut ffi::OcioConfig,
    working_space: ColorSpaceId,
    processor_cache: Mutex<HashMap<(String, String), OcioProcessorWrapper>>,
}

unsafe impl Send for OcioColorManagement {}
unsafe impl Sync for OcioColorManagement {}

struct OcioProcessorWrapper {
    ptr: *mut ffi::OcioProcessor,
}

unsafe impl Send for OcioProcessorWrapper {}
unsafe impl Sync for OcioProcessorWrapper {}

impl Drop for OcioProcessorWrapper {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            unsafe { ffi::ocio_processor_destroy(self.ptr) };
        }
    }
}

impl OcioColorManagement {
    pub fn from_file(path: &str) -> Result<Self, CascadeError> {
        let c_path = CString::new(path)
            .map_err(|_| CascadeError::Other("Invalid path string".to_string()))?;
        let config = unsafe { ffi::ocio_config_create_from_file(c_path.as_ptr()) };
        if config.is_null() {
            let err = unsafe {
                CStr::from_ptr(ffi::ocio_config_get_last_error())
                    .to_string_lossy()
                    .to_string()
            };
            return Err(CascadeError::Other(format!(
                "OCIO config load failed: {err}"
            )));
        }

        let working = Self::resolve_role_static(config, "scene_linear")
            .unwrap_or_else(ColorSpaceId::default_working);

        Ok(Self {
            config,
            working_space: working,
            processor_cache: Mutex::new(HashMap::new()),
        })
    }

    pub fn from_env() -> Result<Self, CascadeError> {
        let config = unsafe { ffi::ocio_config_create_from_env() };
        if config.is_null() {
            let err = unsafe {
                CStr::from_ptr(ffi::ocio_config_get_last_error())
                    .to_string_lossy()
                    .to_string()
            };
            return Err(CascadeError::Other(format!(
                "OCIO config from $OCIO failed: {err}"
            )));
        }

        let working = Self::resolve_role_static(config, "scene_linear")
            .unwrap_or_else(ColorSpaceId::default_working);

        Ok(Self {
            config,
            working_space: working,
            processor_cache: Mutex::new(HashMap::new()),
        })
    }

    fn resolve_role_static(config: *mut ffi::OcioConfig, role: &str) -> Option<ColorSpaceId> {
        let c_role = CString::new(role).ok()?;
        let result = unsafe { ffi::ocio_config_get_role(config, c_role.as_ptr()) };
        if result.is_null() {
            return None;
        }
        let name = unsafe { CStr::from_ptr(result).to_string_lossy() };
        if name.is_empty() {
            None
        } else {
            Some(ColorSpaceId::new(&name))
        }
    }

    fn get_or_create_processor(
        &self,
        cache_key: (String, String),
        create: impl FnOnce() -> *mut ffi::OcioProcessor,
    ) -> Result<OcioCpuProcessor, CascadeError> {
        let mut cache = self
            .processor_cache
            .lock()
            .map_err(|_| CascadeError::Other("Processor cache mutex poisoned".to_string()))?;

        if let Some(wrapper) = cache.get(&cache_key) {
            return Ok(OcioCpuProcessor { ptr: wrapper.ptr });
        }

        let ptr = create();
        if ptr.is_null() {
            let err = unsafe {
                CStr::from_ptr(ffi::ocio_config_get_last_error())
                    .to_string_lossy()
                    .to_string()
            };
            return Err(CascadeError::Other(format!(
                "OCIO processor creation failed: {err}"
            )));
        }

        cache.insert(cache_key, OcioProcessorWrapper { ptr });
        Ok(OcioCpuProcessor { ptr })
    }
}

impl Drop for OcioColorManagement {
    fn drop(&mut self) {
        self.processor_cache.lock().ok();
        if !self.config.is_null() {
            unsafe { ffi::ocio_config_destroy(self.config) };
        }
    }
}

impl ColorManagement for OcioColorManagement {
    fn available_color_spaces(&self) -> Vec<ColorSpaceInfo> {
        let count = unsafe { ffi::ocio_config_num_colorspaces(self.config) };
        (0..count)
            .map(|i| {
                let name = unsafe {
                    CStr::from_ptr(ffi::ocio_config_colorspace_name(self.config, i))
                        .to_string_lossy()
                        .to_string()
                };
                let family = unsafe {
                    let c_name = CString::new(name.as_str()).unwrap_or_default();
                    CStr::from_ptr(ffi::ocio_config_colorspace_family(
                        self.config,
                        c_name.as_ptr(),
                    ))
                    .to_string_lossy()
                    .to_string()
                };
                ColorSpaceInfo {
                    id: ColorSpaceId::new(&name),
                    family,
                }
            })
            .collect()
    }

    fn available_displays(&self) -> Vec<String> {
        let count = unsafe { ffi::ocio_config_num_displays(self.config) };
        (0..count)
            .map(|i| unsafe {
                CStr::from_ptr(ffi::ocio_config_display_name(self.config, i))
                    .to_string_lossy()
                    .to_string()
            })
            .collect()
    }

    fn available_views(&self, display: &str) -> Vec<String> {
        let c_display = match CString::new(display) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        let count = unsafe { ffi::ocio_config_num_views(self.config, c_display.as_ptr()) };
        (0..count)
            .map(|i| unsafe {
                CStr::from_ptr(ffi::ocio_config_view_name(
                    self.config,
                    c_display.as_ptr(),
                    i,
                ))
                .to_string_lossy()
                .to_string()
            })
            .collect()
    }

    fn working_space(&self) -> &ColorSpaceId {
        &self.working_space
    }

    fn create_transform(
        &self,
        from: &ColorSpaceId,
        to: &ColorSpaceId,
    ) -> Result<Box<dyn ColorProcessor>, CascadeError> {
        let from_str = from.as_str().to_string();
        let to_str = to.as_str().to_string();
        let cache_key = (from_str.clone(), to_str.clone());

        let config = self.config;
        let proc = self.get_or_create_processor(cache_key, || {
            let c_from = CString::new(from_str.as_str()).unwrap_or_default();
            let c_to = CString::new(to_str.as_str()).unwrap_or_default();
            unsafe { ffi::ocio_create_processor(config, c_from.as_ptr(), c_to.as_ptr()) }
        })?;

        Ok(Box::new(proc))
    }

    fn create_display_transform(
        &self,
        from: &ColorSpaceId,
        display: &str,
        view: &str,
    ) -> Result<Box<dyn ColorProcessor>, CascadeError> {
        let from_str = from.as_str().to_string();
        let cache_key = (
            from_str.clone(),
            format!("__display__:{}:{}", display, view),
        );

        let config = self.config;
        let display_owned = display.to_string();
        let view_owned = view.to_string();
        let proc = self.get_or_create_processor(cache_key, || {
            let c_from = CString::new(from_str.as_str()).unwrap_or_default();
            let c_display = CString::new(display_owned.as_str()).unwrap_or_default();
            let c_view = CString::new(view_owned.as_str()).unwrap_or_default();
            unsafe {
                ffi::ocio_create_display_processor(
                    config,
                    c_from.as_ptr(),
                    c_display.as_ptr(),
                    c_view.as_ptr(),
                )
            }
        })?;

        Ok(Box::new(proc))
    }
}

struct OcioCpuProcessor {
    ptr: *mut ffi::OcioProcessor,
}

unsafe impl Send for OcioCpuProcessor {}
unsafe impl Sync for OcioCpuProcessor {}

impl ColorProcessor for OcioCpuProcessor {
    fn apply(&self, pixels: &mut [f32]) {
        if self.ptr.is_null() || pixels.is_empty() {
            return;
        }
        let num_pixels = pixels.len() / 4;
        const CHUNK_PIXELS: usize = 64 * 1024;
        if num_pixels <= CHUNK_PIXELS {
            unsafe {
                ffi::ocio_processor_apply_rgba_f32(
                    self.ptr,
                    pixels.as_mut_ptr(),
                    num_pixels as i32,
                );
            }
        } else {
            // SAFETY: OCIO's ConstCPUProcessorRcPtr::apply is thread-safe (const method).
            // We transmit the pointer as usize to satisfy Send+Sync bounds on the closure.
            let ptr_val = self.ptr as usize;
            pixels
                .par_chunks_exact_mut(CHUNK_PIXELS * 4)
                .for_each(move |chunk| unsafe {
                    ffi::ocio_processor_apply_rgba_f32(
                        ptr_val as *mut ffi::OcioProcessor,
                        chunk.as_mut_ptr(),
                        (chunk.len() / 4) as i32,
                    );
                });
            let remainder_start = (num_pixels / CHUNK_PIXELS) * CHUNK_PIXELS * 4;
            if remainder_start < pixels.len() {
                let remainder = &mut pixels[remainder_start..];
                let rem_pixels = remainder.len() / 4;
                if rem_pixels > 0 {
                    unsafe {
                        ffi::ocio_processor_apply_rgba_f32(
                            self.ptr,
                            remainder.as_mut_ptr(),
                            rem_pixels as i32,
                        );
                    }
                }
            }
        }
    }
}
