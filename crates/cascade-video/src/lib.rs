#![cfg(target_os = "macos")]

use rayon::prelude::*;
use std::path::Path;
use std::ptr::NonNull;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_av_foundation::{
    AVAsset, AVAssetReader, AVAssetReaderOutput, AVAssetReaderStatus, AVAssetReaderTrackOutput,
    AVAssetWriter, AVAssetWriterInput, AVAssetWriterInputPixelBufferAdaptor, AVAssetWriterStatus,
    AVMediaTypeVideo, AVVideoAllowFrameReorderingKey, AVVideoCodecKey,
    AVVideoCompressionPropertiesKey, AVVideoExpectedSourceFrameRateKey, AVVideoHeightKey,
    AVVideoMaxKeyFrameIntervalDurationKey, AVVideoQualityKey, AVVideoWidthKey,
};
use objc2_core_foundation::CFRetained;
use objc2_core_media::{
    kCMTimeZero, kCMVideoCodecType_H264, kCMVideoCodecType_HEVC, CMSampleBuffer, CMTime,
    CMTimeRange, CMVideoCodecType,
};
use objc2_core_video::CVImageBuffer;
use objc2_core_video::{
    kCVPixelBufferHeightKey, kCVPixelBufferPixelFormatTypeKey, kCVPixelBufferWidthKey,
    kCVPixelFormatType_32BGRA, kCVReturnSuccess, CVPixelBuffer, CVPixelBufferCreate,
    CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow, CVPixelBufferLockBaseAddress,
    CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress,
};
use objc2_foundation::{NSDictionary, NSError, NSNumber, NSString, NSURL};

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

// ── Video Decoder (AVAssetReader) ─────────────────────────────────────

/// Metadata about a decoded video.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub frame_count: u64,
    pub duration_secs: f64,
}

/// A single decoded video frame in RGBA8 format.
pub struct DecodedFrame {
    pub rgba_data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub frame_index: u64,
}

pub struct LinearFrame {
    pub data: Vec<f32>,
    pub width: u32,
    pub height: u32,
    pub frame_index: u64,
}

struct SequentialReader {
    #[allow(dead_code)] // Kept alive to own the reading session
    reader: Retained<AVAssetReader>,
    track_output: Retained<AVAssetReaderTrackOutput>,
    next_frame: u64,
}

// AVFoundation objects are safe to send between threads but must not be used concurrently.
// The Mutex<Option<SequentialReader>> in VideoDecoder ensures exclusive access.
unsafe impl Send for SequentialReader {}

pub struct VideoDecoder {
    info: VideoInfo,
    path: String,
    sequential_reader: std::sync::Mutex<Option<SequentialReader>>,
}

impl VideoDecoder {
    /// Opens a video file and reads its metadata. Does not decode frames.
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let abs_path = absolutize_path(path.as_ref())?;
        let path_string = abs_path
            .to_str()
            .ok_or_else(|| "Path is not valid UTF-8".to_string())?
            .to_string();

        let info = Self::read_video_info(&path_string)?;

        Ok(Self {
            info,
            path: path_string,
            sequential_reader: std::sync::Mutex::new(None),
        })
    }

    /// Returns metadata about the video.
    pub fn info(&self) -> &VideoInfo {
        &self.info
    }

    /// Decodes all frames from the video sequentially.
    pub fn decode_all_frames(&self) -> Result<Vec<DecodedFrame>, String> {
        let (reader, track_output) = self.create_reader()?;

        let started = unsafe { reader.startReading() };
        if !started {
            return Err(reader_error(
                &reader,
                "AVAssetReader failed to start reading",
            ));
        }

        let mut frames = Vec::new();
        let mut frame_index: u64 = 0;

        let output_base: &AVAssetReaderOutput = &track_output;

        loop {
            let sample = unsafe { output_base.copyNextSampleBuffer() };
            let sample = match sample {
                Some(s) => s,
                None => break,
            };

            if unsafe { sample.num_samples() } == 0 {
                continue;
            }

            let frame = self.extract_frame_from_sample(&sample, frame_index)?;
            frames.push(frame);
            frame_index += 1;
        }

        let status = unsafe { reader.status() };
        if status == AVAssetReaderStatus::Failed {
            return Err(reader_error(&reader, "AVAssetReader failed during reading"));
        }

        Ok(frames)
    }

    /// Decodes a single frame at the given index by reading up to that frame.
    /// For random access, prefer `decode_all_frames` and caching.
    pub fn decode_frame(&self, target_frame: u64) -> Result<Option<DecodedFrame>, String> {
        let (reader, track_output) = self.create_reader()?;

        let started = unsafe { reader.startReading() };
        if !started {
            return Err(reader_error(
                &reader,
                "AVAssetReader failed to start reading",
            ));
        }

        let output_base: &AVAssetReaderOutput = &track_output;
        let mut frame_index: u64 = 0;

        loop {
            let sample = unsafe { output_base.copyNextSampleBuffer() };
            let sample = match sample {
                Some(s) => s,
                None => break,
            };

            if unsafe { sample.num_samples() } == 0 {
                continue;
            }

            if frame_index == target_frame {
                let frame = self.extract_frame_from_sample(&sample, frame_index)?;
                return Ok(Some(frame));
            }
            frame_index += 1;
        }

        Ok(None)
    }

    pub fn decode_frame_at_time(&self, frame_index: u64) -> Result<Option<DecodedFrame>, String> {
        self.with_next_sample(frame_index, |sample, idx| {
            self.extract_frame_from_sample(sample, idx)
        })
    }

    pub fn decode_frame_linear(
        &self,
        frame_index: u64,
        srgb_lut: &'static [f32; 256],
    ) -> Result<Option<LinearFrame>, String> {
        self.with_next_sample(frame_index, |sample, idx| {
            self.extract_frame_linear(sample, idx, srgb_lut)
        })
    }

    fn with_next_sample<T>(
        &self,
        frame_index: u64,
        extract: impl FnOnce(&CMSampleBuffer, u64) -> Result<T, String>,
    ) -> Result<Option<T>, String> {
        if self.info.fps <= 0.0 {
            return Err("Cannot seek: video has no FPS info".to_string());
        }

        let mut state_guard = self
            .sequential_reader
            .lock()
            .map_err(|_| "Sequential reader mutex poisoned".to_string())?;

        let is_sequential = state_guard
            .as_ref()
            .map_or(false, |s| s.next_frame == frame_index);

        if !is_sequential {
            let (reader, track_output) = self.create_reader()?;

            let timescale = 600i32;
            let frame_time_secs = frame_index as f64 / self.info.fps;
            let start_value = (frame_time_secs * timescale as f64) as i64;
            let remaining_secs = self.info.duration_secs - frame_time_secs;
            let duration_value =
                (remaining_secs.max(1.0 / self.info.fps) * timescale as f64) as i64;

            let start_time = unsafe { CMTime::new(start_value, timescale) };
            let duration = unsafe { CMTime::new(duration_value.max(1), timescale) };
            let time_range = unsafe { CMTimeRange::new(start_time, duration) };
            unsafe { reader.setTimeRange(time_range) };

            let started = unsafe { reader.startReading() };
            if !started {
                return Err(reader_error(
                    &reader,
                    "AVAssetReader failed to start reading",
                ));
            }

            *state_guard = Some(SequentialReader {
                reader,
                track_output,
                next_frame: frame_index,
            });
        }

        let state = state_guard.as_mut().ok_or_else(|| "sequential reader state unexpectedly empty".to_string())?;
        let output_base: &AVAssetReaderOutput = &state.track_output;
        let sample = unsafe { output_base.copyNextSampleBuffer() };

        match sample {
            Some(s) => {
                if unsafe { s.num_samples() } == 0 {
                    *state_guard = None;
                    return Ok(None);
                }
                state.next_frame = frame_index + 1;
                let result = extract(&s, frame_index)?;
                Ok(Some(result))
            }
            None => {
                *state_guard = None;
                Ok(None)
            }
        }
    }

    fn read_video_info(path: &str) -> Result<VideoInfo, String> {
        let path_str = NSString::from_str(path);
        let url: Retained<NSURL> = unsafe { msg_send![class!(NSURL), fileURLWithPath: &*path_str] };
        let asset = unsafe { AVAsset::assetWithURL(&url) };

        let media_type = unsafe {
            AVMediaTypeVideo.ok_or_else(|| "AVMediaTypeVideo not available".to_string())?
        };
        #[allow(deprecated)]
        let tracks = unsafe { asset.tracksWithMediaType(media_type) };
        let track = tracks
            .firstObject()
            .ok_or_else(|| "No video tracks found in file".to_string())?;

        let size = unsafe { track.naturalSize() };
        let fps = unsafe { track.nominalFrameRate() } as f64;
        let duration = unsafe { asset.duration() };
        let duration_secs = if duration.timescale > 0 {
            duration.value as f64 / duration.timescale as f64
        } else {
            0.0
        };
        let frame_count = if fps > 0.0 {
            (duration_secs * fps).round() as u64
        } else {
            0
        };

        Ok(VideoInfo {
            width: size.width as u32,
            height: size.height as u32,
            fps,
            frame_count,
            duration_secs,
        })
    }

    fn create_reader(
        &self,
    ) -> Result<(Retained<AVAssetReader>, Retained<AVAssetReaderTrackOutput>), String> {
        let path_str = NSString::from_str(&self.path);
        let url: Retained<NSURL> = unsafe { msg_send![class!(NSURL), fileURLWithPath: &*path_str] };
        let asset = unsafe { AVAsset::assetWithURL(&url) };

        let media_type = unsafe {
            AVMediaTypeVideo.ok_or_else(|| "AVMediaTypeVideo not available".to_string())?
        };
        #[allow(deprecated)]
        let tracks = unsafe { asset.tracksWithMediaType(media_type) };
        let track = tracks
            .firstObject()
            .ok_or_else(|| "No video tracks found in file".to_string())?;

        let output_settings = create_decoder_output_settings()?;
        let settings_dict: &NSDictionary<NSString, AnyObject> = unsafe {
            &*(&*output_settings as *const AnyObject as *const NSDictionary<NSString, AnyObject>)
        };

        let track_output = unsafe {
            AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(
                &track,
                Some(settings_dict),
            )
        };

        unsafe {
            track_output.setAlwaysCopiesSampleData(false);
        }

        let reader = catch_objc("AVAssetReader creation", || unsafe {
            AVAssetReader::assetReaderWithAsset_error(&asset)
                .map_err(|e| format!("Failed to create AVAssetReader: {e}"))
        })??;

        let output_ref: &AVAssetReaderOutput = &track_output;
        unsafe {
            reader.addOutput(output_ref);
        }

        Ok((reader, track_output))
    }

    fn extract_frame_from_sample(
        &self,
        sample: &CMSampleBuffer,
        frame_index: u64,
    ) -> Result<DecodedFrame, String> {
        let image_buffer: CFRetained<CVImageBuffer> = unsafe { sample.image_buffer() }
            .ok_or_else(|| "CMSampleBuffer has no image buffer".to_string())?;

        let pixel_buffer: &CVPixelBuffer = &image_buffer;

        // kCVPixelBufferLock_ReadOnly
        let lock_flags = CVPixelBufferLockFlags(1);
        let status = unsafe { CVPixelBufferLockBaseAddress(pixel_buffer, lock_flags) };
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
                let _ = unsafe { CVPixelBufferUnlockBaseAddress(self.buffer, self.flags) };
            }
        }

        let _unlock = UnlockGuard {
            buffer: pixel_buffer,
            flags: lock_flags,
        };

        let base = CVPixelBufferGetBaseAddress(pixel_buffer) as *const u8;
        if base.is_null() {
            return Err("CVPixelBuffer base address is null".to_string());
        }

        let bytes_per_row = CVPixelBufferGetBytesPerRow(pixel_buffer);
        let width = self.info.width as usize;
        let height = self.info.height as usize;
        let mut rgba_data = vec![0u8; width * height * 4];

        for y in 0..height {
            let src_row =
                unsafe { std::slice::from_raw_parts(base.add(y * bytes_per_row), width * 4) };
            let dst_offset = y * width * 4;
            for x in 0..width {
                let si = x * 4;
                let di = dst_offset + x * 4;
                rgba_data[di] = src_row[si + 2]; // BGRA → RGBA: R
                rgba_data[di + 1] = src_row[si + 1]; // G
                rgba_data[di + 2] = src_row[si]; // B
                rgba_data[di + 3] = src_row[si + 3]; // A
            }
        }

        Ok(DecodedFrame {
            rgba_data,
            width: self.info.width,
            height: self.info.height,
            frame_index,
        })
    }

    fn extract_frame_linear(
        &self,
        sample: &CMSampleBuffer,
        frame_index: u64,
        lut: &[f32; 256],
    ) -> Result<LinearFrame, String> {
        let image_buffer: CFRetained<CVImageBuffer> = unsafe { sample.image_buffer() }
            .ok_or_else(|| "CMSampleBuffer has no image buffer".to_string())?;

        let pixel_buffer: &CVPixelBuffer = &image_buffer;

        let lock_flags = CVPixelBufferLockFlags(1);
        let status = unsafe { CVPixelBufferLockBaseAddress(pixel_buffer, lock_flags) };
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
                let _ = unsafe { CVPixelBufferUnlockBaseAddress(self.buffer, self.flags) };
            }
        }

        let _unlock = UnlockGuard {
            buffer: pixel_buffer,
            flags: lock_flags,
        };

        let base = CVPixelBufferGetBaseAddress(pixel_buffer) as *const u8;
        if base.is_null() {
            return Err("CVPixelBuffer base address is null".to_string());
        }

        let bytes_per_row = CVPixelBufferGetBytesPerRow(pixel_buffer);
        let width = self.info.width as usize;
        let height = self.info.height as usize;
        let mut data = vec![0.0f32; width * height * 4];

        // SAFETY: base is valid for the lifetime of _unlock guard and each row slice is
        // non-overlapping, so parallel reads from different rows are safe.
        let base_addr = base as usize;
        data.par_chunks_exact_mut(width * 4)
            .enumerate()
            .for_each(|(y, row_out)| {
                let row_ptr = (base_addr + y * bytes_per_row) as *const u8;
                let src_row = unsafe { std::slice::from_raw_parts(row_ptr, width * 4) };
                for x in 0..width {
                    let si = x * 4;
                    let di = x * 4;
                    row_out[di] = lut[src_row[si + 2] as usize];
                    row_out[di + 1] = lut[src_row[si + 1] as usize];
                    row_out[di + 2] = lut[src_row[si] as usize];
                    row_out[di + 3] = src_row[si + 3] as f32 / 255.0;
                }
            });

        Ok(LinearFrame {
            data,
            width: self.info.width,
            height: self.info.height,
            frame_index,
        })
    }
}

fn create_decoder_output_settings() -> Result<Retained<AnyObject>, String> {
    let dict: Retained<AnyObject> = unsafe { msg_send![class!(NSMutableDictionary), new] };
    let format_val = NSNumber::new_u32(kCVPixelFormatType_32BGRA);
    unsafe {
        dict_set_cfstring(&dict, kCVPixelBufferPixelFormatTypeKey, &format_val);
    }
    Ok(dict)
}

fn reader_error(reader: &AVAssetReader, context: &str) -> String {
    let status = unsafe { reader.status() };
    let error = unsafe { reader.error() };
    let error_desc = error
        .map(|err| format!("{err}"))
        .unwrap_or_else(|| "unknown error".to_string());
    format!("{context} (status: {status:?}, error: {error_desc})")
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
