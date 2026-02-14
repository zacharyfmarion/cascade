use std::os::raw::{c_char, c_float, c_int};

#[repr(C)]
pub struct OcioConfig {
    _opaque: [u8; 0],
}

#[repr(C)]
pub struct OcioProcessor {
    _opaque: [u8; 0],
}

#[cfg(not(ocio_stub))]
extern "C" {
    pub fn ocio_config_create_from_file(path: *const c_char) -> *mut OcioConfig;
    pub fn ocio_config_create_from_env() -> *mut OcioConfig;
    pub fn ocio_config_destroy(config: *mut OcioConfig);
    pub fn ocio_config_get_last_error() -> *const c_char;

    pub fn ocio_config_num_colorspaces(config: *const OcioConfig) -> c_int;
    pub fn ocio_config_colorspace_name(config: *const OcioConfig, index: c_int) -> *const c_char;
    pub fn ocio_config_colorspace_family(
        config: *const OcioConfig,
        name: *const c_char,
    ) -> *const c_char;

    pub fn ocio_config_num_displays(config: *const OcioConfig) -> c_int;
    pub fn ocio_config_display_name(config: *const OcioConfig, index: c_int) -> *const c_char;
    pub fn ocio_config_num_views(config: *const OcioConfig, display: *const c_char) -> c_int;
    pub fn ocio_config_view_name(
        config: *const OcioConfig,
        display: *const c_char,
        index: c_int,
    ) -> *const c_char;
    pub fn ocio_config_get_role(config: *const OcioConfig, role: *const c_char) -> *const c_char;

    pub fn ocio_create_processor(
        config: *const OcioConfig,
        from_space: *const c_char,
        to_space: *const c_char,
    ) -> *mut OcioProcessor;

    pub fn ocio_create_display_processor(
        config: *const OcioConfig,
        from_space: *const c_char,
        display: *const c_char,
        view: *const c_char,
    ) -> *mut OcioProcessor;

    pub fn ocio_processor_apply_rgba_f32(
        proc_: *const OcioProcessor,
        pixels: *mut c_float,
        num_pixels: c_int,
    );

    pub fn ocio_processor_destroy(proc_: *mut OcioProcessor);
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_config_create_from_file(_path: *const c_char) -> *mut OcioConfig {
    std::ptr::null_mut()
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_config_create_from_env() -> *mut OcioConfig {
    std::ptr::null_mut()
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_config_destroy(_config: *mut OcioConfig) {}

#[cfg(ocio_stub)]
pub unsafe fn ocio_config_get_last_error() -> *const c_char {
    b"OpenColorIO not available (stub build)\0".as_ptr() as *const c_char
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_config_num_colorspaces(_config: *const OcioConfig) -> c_int {
    0
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_config_colorspace_name(
    _config: *const OcioConfig,
    _index: c_int,
) -> *const c_char {
    b"\0".as_ptr() as *const c_char
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_config_colorspace_family(
    _config: *const OcioConfig,
    _name: *const c_char,
) -> *const c_char {
    b"\0".as_ptr() as *const c_char
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_config_num_displays(_config: *const OcioConfig) -> c_int {
    0
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_config_display_name(_config: *const OcioConfig, _index: c_int) -> *const c_char {
    b"\0".as_ptr() as *const c_char
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_config_num_views(_config: *const OcioConfig, _display: *const c_char) -> c_int {
    0
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_config_view_name(
    _config: *const OcioConfig,
    _display: *const c_char,
    _index: c_int,
) -> *const c_char {
    b"\0".as_ptr() as *const c_char
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_config_get_role(
    _config: *const OcioConfig,
    _role: *const c_char,
) -> *const c_char {
    b"\0".as_ptr() as *const c_char
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_create_processor(
    _config: *const OcioConfig,
    _from_space: *const c_char,
    _to_space: *const c_char,
) -> *mut OcioProcessor {
    std::ptr::null_mut()
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_create_display_processor(
    _config: *const OcioConfig,
    _from_space: *const c_char,
    _display: *const c_char,
    _view: *const c_char,
) -> *mut OcioProcessor {
    std::ptr::null_mut()
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_processor_apply_rgba_f32(
    _proc: *const OcioProcessor,
    _pixels: *mut c_float,
    _num_pixels: c_int,
) {
}

#[cfg(ocio_stub)]
pub unsafe fn ocio_processor_destroy(_proc: *mut OcioProcessor) {}
