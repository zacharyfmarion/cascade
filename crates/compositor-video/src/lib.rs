#![cfg(target_os = "macos")]

use std::path::Path;
use std::ptr::NonNull;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_av_foundation::{
    AVAssetWriter, AVAssetWriterInput, AVAssetWriterInputPixelBufferAdaptor, AVAssetWriterStatus,
    AVVideoAllowFrameReorderingKey, AVVideoCodecKey, AVVideoCompressionPropertiesKey,
    AVVideoExpectedSourceFrameRateKey, AVVideoHeightKey, AVVideoMaxKeyFrameIntervalDurationKey,
    AVVideoQualityKey, AVVideoWidthKey,
};
use objc2_core_foundation::CFRetained;
use objc2_core_media::{
    kCMTimeZero, kCMVideoCodecType_H264, kCMVideoCodecType_HEVC, CMTime, CMVideoCodecType,
};
use objc2_core_video::{
    kCVPixelBufferHeightKey, kCVPixelBufferPixelFormatTypeKey, kCVPixelBufferWidthKey,
    kCVPixelFormatType_32BGRA, kCVReturnSuccess, CVPixelBuffer, CVPixelBufferCreate,
    CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow, CVPixelBufferLockBaseAddress,
    CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress,
};
use objc2_foundation::{NSError, NSNumber, NSString};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoCodec {
    H264,
    H265,
}

impl VideoCodec {
    pub fn codec_type_id(self) -> CMVideoCodecType {
        match self {
            VideoCodec::H264 => kCMVideoCodecType_H264,
            VideoCodec::H265 => kCMVideoCodecType_HEVC,
        }
    }

    pub fn av_video_codec_string(self) -> &'static str {
        match self {
            VideoCodec::H264 => "avc1",
            VideoCodec::H265 => "hvc1",
        }
    }

    pub fn from_index(idx: i64) -> Self {
        match idx {
            1 => VideoCodec::H265,
            _ => VideoCodec::H264,
        }
    }

    pub fn default_extension(self) -> &'static str {
        "mp4"
    }
}

pub struct VideoEncoderConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub codec: VideoCodec,
    /// Constant Rate Factor (0 = lossless, 51 = worst). Default: 23.
    pub crf: u32,
}

pub struct VideoEncoder {
    writer: Retained<AVAssetWriter>,
    input: Retained<AVAssetWriterInput>,
    adaptor: Retained<AVAssetWriterInputPixelBufferAdaptor>,
    width: usize,
    height: usize,
    fps: u32,
    frame_count: i64,
}

impl VideoEncoder {
    pub fn new<P: AsRef<Path>>(path: P, config: VideoEncoderConfig) -> Result<Self, String> {
        let width = (config.width + 1) & !1;
        let height = (config.height + 1) & !1;
        let fps = config.fps;

        let abs_path = absolutize_path(path.as_ref())?;
        let output_str = abs_path
            .to_str()
            .ok_or_else(|| "Output path is not valid UTF-8".to_string())?;

        let path_str = NSString::from_str(output_str);
        let url: Retained<AnyObject> =
            unsafe { msg_send![class!(NSURL), fileURLWithPath: &*path_str] };
        let file_type = NSString::from_str("public.mpeg-4");

        let writer: Retained<AVAssetWriter> = catch_objc("AVAssetWriter creation", || {
            let mut error_ptr: *mut NSError = std::ptr::null_mut();
            let result: Option<Retained<AVAssetWriter>> = unsafe {
                msg_send![
                    class!(AVAssetWriter),
                    assetWriterWithURL: &*url,
                    fileType: &*file_type,
                    error: &mut error_ptr
                ]
            };
            match result {
                Some(writer) => Ok(writer),
                None => {
                    let err = if !error_ptr.is_null() {
                        unsafe { format!("{}", &*error_ptr) }
                    } else {
                        "unknown error".to_string()
                    };
                    Err(format!("Failed to create AVAssetWriter: {err}"))
                }
            }
        })??;

        let settings = create_video_settings(width, height, fps, config.codec, config.crf)?;
        let media_type = NSString::from_str("vide");
        let input: Retained<AVAssetWriterInput> =
            catch_objc("AVAssetWriterInput creation", || unsafe {
                msg_send![
                    class!(AVAssetWriterInput),
                    assetWriterInputWithMediaType: &*media_type,
                    outputSettings: &*settings
                ]
            })?;

        unsafe {
            input.setExpectsMediaDataInRealTime(false);
        }

        catch_objc("addInput", || unsafe {
            writer.addInput(&input);
        })?;

        let pixel_buffer_attrs = create_pixel_buffer_attributes(width, height)?;
        let adaptor: Retained<AVAssetWriterInputPixelBufferAdaptor> =
            catch_objc("AVAssetWriterInputPixelBufferAdaptor creation", || unsafe {
                msg_send![
                    class!(AVAssetWriterInputPixelBufferAdaptor),
                    assetWriterInputPixelBufferAdaptorWithAssetWriterInput: &*input,
                    sourcePixelBufferAttributes: &*pixel_buffer_attrs
                ]
            })?;

        let started = catch_objc("startWriting", || unsafe { writer.startWriting() })?;
        if !started {
            return Err(writer_error(
                &writer,
                "AVAssetWriter failed to start writing",
            ));
        }

        catch_objc("startSessionAtSourceTime", || unsafe {
            let () = msg_send![&*writer, startSessionAtSourceTime: kCMTimeZero];
        })?;

        Ok(Self {
            writer,
            input,
            adaptor,
            width: width as usize,
            height: height as usize,
            fps,
            frame_count: 0,
        })
    }

    pub fn encode_frame(&mut self, rgba_data: &[u8]) -> Result<(), String> {
        let expected_len = self.width * self.height * 4;
        if rgba_data.len() != expected_len {
            return Err(format!(
                "RGBA data length mismatch: expected {expected_len}, got {}",
                rgba_data.len()
            ));
        }

        self.wait_for_ready()?;

        let pixel_buffer = create_pixel_buffer(self.width, self.height)?;
        fill_pixel_buffer_bgra(&pixel_buffer, self.width, self.height, rgba_data)?;

        let presentation_time = unsafe { CMTime::new(self.frame_count, self.fps as i32) };
        let appended = catch_objc("appendPixelBuffer", || unsafe {
            self.adaptor
                .appendPixelBuffer_withPresentationTime(&pixel_buffer, presentation_time)
        })?;
        if !appended {
            return Err(writer_error(&self.writer, "Failed to append pixel buffer"));
        }

        self.frame_count += 1;
        Ok(())
    }

    pub fn finish(self) -> Result<(), String> {
        catch_objc("markAsFinished", || unsafe {
            self.input.markAsFinished();
        })?;

        let (tx, rx) = mpsc::channel();
        let handler = RcBlock::new(move || {
            let _ = tx.send(());
        });

        unsafe {
            self.writer.finishWritingWithCompletionHandler(&handler);
        }

        match rx.recv_timeout(Duration::from_secs(15)) {
            Ok(()) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Err(writer_error(
                    &self.writer,
                    "Timed out waiting for AVAssetWriter to finish",
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("AVAssetWriter completion handler disconnected".to_string());
            }
        }

        let status = unsafe { self.writer.status() };
        if status == AVAssetWriterStatus::Completed {
            Ok(())
        } else {
            Err(writer_error(
                &self.writer,
                "AVAssetWriter did not complete successfully",
            ))
        }
    }

    fn wait_for_ready(&self) -> Result<(), String> {
        let mut waited = Duration::from_millis(0);
        let step = Duration::from_millis(1);
        let timeout = Duration::from_secs(5);
        loop {
            let ready = unsafe { self.input.isReadyForMoreMediaData() };
            if ready {
                return Ok(());
            }

            let status = unsafe { self.writer.status() };
            if status != AVAssetWriterStatus::Writing {
                return Err(writer_error(
                    &self.writer,
                    "AVAssetWriter is not ready for more media data",
                ));
            }

            if waited >= timeout {
                return Err("Timed out waiting for AVAssetWriter input readiness".to_string());
            }

            std::thread::sleep(step);
            waited += step;
        }
    }
}

fn absolutize_path(path: &Path) -> Result<std::path::PathBuf, String> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        let cwd = std::env::current_dir().map_err(|e| format!("Failed to read cwd: {e}"))?;
        Ok(cwd.join(path))
    }
}

fn create_video_settings(
    width: u32,
    height: u32,
    fps: u32,
    codec: VideoCodec,
    crf: u32,
) -> Result<Retained<AnyObject>, String> {
    let dict: Retained<AnyObject> = unsafe { msg_send![class!(NSMutableDictionary), new] };

    let codec_key = unsafe { av_key(AVVideoCodecKey, "AVVideoCodecKey")? };
    let codec_val = NSString::from_str(codec.av_video_codec_string());
    unsafe {
        let () = msg_send![&*dict, setObject: &*codec_val, forKey: codec_key];
    }

    let width_key = unsafe {
        // SAFETY: AVFoundation provides these static keys for the process lifetime.
        av_key(AVVideoWidthKey, "AVVideoWidthKey")?
    };
    let height_key = unsafe {
        // SAFETY: AVFoundation provides these static keys for the process lifetime.
        av_key(AVVideoHeightKey, "AVVideoHeightKey")?
    };
    let width_val = NSNumber::new_u32(width);
    let height_val = NSNumber::new_u32(height);
    unsafe {
        dict_set_nsstring(&dict, width_key, &width_val);
        dict_set_nsstring(&dict, height_key, &height_val);
    }

    let compression: Retained<AnyObject> = unsafe { msg_send![class!(NSMutableDictionary), new] };
    let quality_key = unsafe {
        // SAFETY: AVFoundation provides these static keys for the process lifetime.
        av_key(AVVideoQualityKey, "AVVideoQualityKey")?
    };
    let quality_val = NSNumber::new_f64(crf_to_quality(crf));
    unsafe {
        dict_set_nsstring(&compression, quality_key, &quality_val);
    }

    let keyframe_key = unsafe {
        // SAFETY: AVFoundation provides these static keys for the process lifetime.
        av_key(
            AVVideoMaxKeyFrameIntervalDurationKey,
            "AVVideoMaxKeyFrameIntervalDurationKey",
        )?
    };
    let keyframe_val = NSNumber::new_f64(2.0);
    unsafe {
        dict_set_nsstring(&compression, keyframe_key, &keyframe_val);
    }

    let fps_key = unsafe {
        // SAFETY: AVFoundation provides these static keys for the process lifetime.
        av_key(
            AVVideoExpectedSourceFrameRateKey,
            "AVVideoExpectedSourceFrameRateKey",
        )?
    };
    let fps_val = NSNumber::new_u32(fps);
    unsafe {
        dict_set_nsstring(&compression, fps_key, &fps_val);
    }

    let reorder_key = unsafe {
        // SAFETY: AVFoundation provides these static keys for the process lifetime.
        av_key(
            AVVideoAllowFrameReorderingKey,
            "AVVideoAllowFrameReorderingKey",
        )?
    };
    let reorder_val = NSNumber::new_bool(false);
    unsafe {
        dict_set_nsstring(&compression, reorder_key, &reorder_val);
    }

    let compression_key = unsafe {
        // SAFETY: AVFoundation provides these static keys for the process lifetime.
        av_key(
            AVVideoCompressionPropertiesKey,
            "AVVideoCompressionPropertiesKey",
        )?
    };
    unsafe {
        dict_set_nsstring(&dict, compression_key, &compression);
    }

    Ok(dict)
}

fn create_pixel_buffer_attributes(width: u32, height: u32) -> Result<Retained<AnyObject>, String> {
    let attrs: Retained<AnyObject> = unsafe { msg_send![class!(NSMutableDictionary), new] };
    let format_val = NSNumber::new_u32(kCVPixelFormatType_32BGRA);
    let width_val = NSNumber::new_u32(width);
    let height_val = NSNumber::new_u32(height);
    unsafe {
        // SAFETY: CoreVideo provides these static keys for the process lifetime.
        dict_set_cfstring(&attrs, kCVPixelBufferPixelFormatTypeKey, &format_val);
        dict_set_cfstring(&attrs, kCVPixelBufferWidthKey, &width_val);
        dict_set_cfstring(&attrs, kCVPixelBufferHeightKey, &height_val);
    }
    Ok(attrs)
}

fn create_pixel_buffer(width: usize, height: usize) -> Result<CFRetained<CVPixelBuffer>, String> {
    let mut buffer = std::ptr::null_mut();
    let status = unsafe {
        CVPixelBufferCreate(
            None,
            width,
            height,
            kCVPixelFormatType_32BGRA,
            None,
            NonNull::from(&mut buffer),
        )
    };
    if status != kCVReturnSuccess {
        return Err(format!("CVPixelBufferCreate failed with status {status}"));
    }

    let buffer_ptr =
        NonNull::new(buffer).ok_or_else(|| "CVPixelBufferCreate returned null".to_string())?;
    Ok(unsafe { CFRetained::from_raw(buffer_ptr) })
}

fn fill_pixel_buffer_bgra(
    buffer: &CVPixelBuffer,
    width: usize,
    height: usize,
    rgba_data: &[u8],
) -> Result<(), String> {
    let lock_flags = CVPixelBufferLockFlags::empty();
    let status = unsafe { CVPixelBufferLockBaseAddress(buffer, lock_flags) };
    if status != kCVReturnSuccess {
        return Err(format!(
            "CVPixelBufferLockBaseAddress failed with status {status}"
        ));
    }

    struct UnlockGuard<'a> {
        buffer: &'a CVPixelBuffer,
        flags: CVPixelBufferLockFlags,
    }

    impl Drop for UnlockGuard<'_> {
        fn drop(&mut self) {
            // SAFETY: The pixel buffer was locked with these flags and is valid for unlock.
            let _ = unsafe { CVPixelBufferUnlockBaseAddress(self.buffer, self.flags) };
        }
    }

    let _unlock = UnlockGuard {
        buffer,
        flags: lock_flags,
    };

    let base = CVPixelBufferGetBaseAddress(buffer) as *mut u8;
    if base.is_null() {
        return Err("CVPixelBuffer base address is null".to_string());
    }

    let bytes_per_row = CVPixelBufferGetBytesPerRow(buffer);
    for y in 0..height {
        let src_row = &rgba_data[y * width * 4..(y + 1) * width * 4];
        let dst_row =
            unsafe { std::slice::from_raw_parts_mut(base.add(y * bytes_per_row), width * 4) };
        for x in 0..width {
            let i = x * 4;
            dst_row[i] = src_row[i + 2];
            dst_row[i + 1] = src_row[i + 1];
            dst_row[i + 2] = src_row[i];
            dst_row[i + 3] = src_row[i + 3];
        }
    }

    Ok(())
}

fn crf_to_quality(crf: u32) -> f64 {
    let clamped = crf.min(51) as f64;
    let quality = 1.0 - (clamped / 51.0);
    quality.clamp(0.0, 1.0)
}

fn av_key(key: Option<&'static NSString>, name: &str) -> Result<&'static NSString, String> {
    key.ok_or_else(|| format!("{name} not available"))
}

fn writer_error(writer: &AVAssetWriter, context: &str) -> String {
    let status = unsafe { writer.status() };
    let error = unsafe { writer.error() };
    let error_desc = error
        .map(|err| format!("{err}"))
        .unwrap_or_else(|| "unknown error".to_string());
    format!("{context} (status: {:?}, error: {error_desc})", status)
}

fn catch_objc<R>(context: &str, f: impl FnOnce() -> R) -> Result<R, String> {
    use std::panic::AssertUnwindSafe;
    objc2::exception::catch(AssertUnwindSafe(f)).map_err(|e| {
        let desc = e
            .map(|ex| format!("{ex}"))
            .unwrap_or_else(|| "unknown ObjC exception".to_string());
        format!("ObjC exception in {context}: {desc}")
    })
}

unsafe fn dict_set_nsstring(dict: &AnyObject, key: &NSString, value: &AnyObject) {
    let () = msg_send![dict, setObject: value, forKey: key];
}

unsafe fn dict_set_cfstring(
    dict: &AnyObject,
    key: &'static objc2_core_foundation::CFString,
    value: &AnyObject,
) {
    let () = msg_send![dict, setObject: value, forKey: key];
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_codec_from_index() {
        assert_eq!(VideoCodec::from_index(0), VideoCodec::H264);
        assert_eq!(VideoCodec::from_index(1), VideoCodec::H265);
        assert_eq!(VideoCodec::from_index(99), VideoCodec::H264);
    }

    #[test]
    fn test_codec_extension() {
        assert_eq!(VideoCodec::H264.default_extension(), "mp4");
        assert_eq!(VideoCodec::H265.default_extension(), "mp4");
    }
}
