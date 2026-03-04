use cascade_core::error::CascadeError;
use cascade_core::node::{EvalContext, Node, NodeFuture};
use cascade_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

fn param_i64(params: &HashMap<String, ParamValue>, key: &str, default: i64) -> i64 {
    match params.get(key) {
        Some(ParamValue::Int(v)) => *v,
        Some(ParamValue::Float(v)) => *v as i64,
        _ => default,
    }
}

fn offset_frame(current: FrameTime, offset: i64) -> FrameTime {
    // Nuke convention: positive offset = delay (look backward),
    // negative offset = advance (look forward).
    // Output frame f shows input frame (f - offset).
    if offset >= 0 {
        FrameTime {
            frame: current.frame.saturating_sub(offset as u64),
        }
    } else {
        FrameTime {
            frame: current.frame.saturating_add((-offset) as u64),
        }
    }
}

pub struct TimeOffset;

impl Default for TimeOffset {
    fn default() -> Self {
        Self::new()
    }
}

impl TimeOffset {
    pub fn new() -> Self {
        Self
    }
}

impl Node for TimeOffset {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "time_offset".to_string(),
            display_name: "Time Offset".to_string(),
            category: "Time".to_string(),
            description: "Shift input in time (positive = delay, negative = advance)".to_string(),
            inputs: vec![PortSpec {
                name: "input".to_string(),
                label: "Input".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            outputs: vec![PortSpec {
                name: "output".to_string(),
                label: "Output".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![ParamSpec {
                key: "offset".to_string(),
                label: "Offset".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(0),
                min: Some(-1000.0),
                max: Some(1000.0),
                step: Some(1.0),
                ui_hint: UiHint::Slider,
                promotable: true,
            }],
        }
    }

    fn requested_frames(
        &self,
        current_frame: FrameTime,
        params: &HashMap<String, ParamValue>,
    ) -> Vec<(String, FrameTime)> {
        let offset = param_i64(params, "offset", 0);
        vec![("input".to_string(), offset_frame(current_frame, offset))]
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let offset = ctx.get_param_int("offset")?;
            let target_frame = offset_frame(ctx.frame_time, offset);
            let value = if offset == 0 {
                ctx.inputs
                    .get("input")
                    .cloned()
                    .ok_or_else(|| CascadeError::MissingInput("input".to_string()))?
            } else {
                ctx.get_input_at_frame("input", target_frame.frame)
                    .cloned()
                    .ok_or_else(|| {
                        CascadeError::MissingInput(format!("input@{}", target_frame.frame))
                    })?
            };
            let mut outputs = HashMap::new();
            outputs.insert("output".to_string(), value);
            Ok(outputs)
        })
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

pub struct FrameHold;

impl Default for FrameHold {
    fn default() -> Self {
        Self::new()
    }
}

impl FrameHold {
    pub fn new() -> Self {
        Self
    }
}

impl Node for FrameHold {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "frame_hold".to_string(),
            display_name: "Frame Hold".to_string(),
            category: "Time".to_string(),
            description: "Hold input at a specific frame".to_string(),
            inputs: vec![PortSpec {
                name: "input".to_string(),
                label: "Input".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            outputs: vec![PortSpec {
                name: "output".to_string(),
                label: "Output".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![ParamSpec {
                key: "frame".to_string(),
                label: "Frame".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(0),
                min: Some(0.0),
                max: None,
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
                promotable: true,
            }],
        }
    }

    fn requested_frames(
        &self,
        _current_frame: FrameTime,
        params: &HashMap<String, ParamValue>,
    ) -> Vec<(String, FrameTime)> {
        let frame = param_i64(params, "frame", 0).max(0) as u64;
        vec![("input".to_string(), FrameTime { frame })]
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let frame = ctx.get_param_int("frame")?.max(0) as u64;
            let value = ctx
                .get_input_at_frame("input", frame)
                .cloned()
                .ok_or_else(|| CascadeError::MissingInput(format!("input@{}", frame)))?;
            let mut outputs = HashMap::new();
            outputs.insert("output".to_string(), value);
            Ok(outputs)
        })
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

pub struct FrameBlend;

impl Default for FrameBlend {
    fn default() -> Self {
        Self::new()
    }
}

impl FrameBlend {
    pub fn new() -> Self {
        Self
    }
}

impl Node for FrameBlend {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "frame_blend".to_string(),
            display_name: "Frame Blend".to_string(),
            category: "Time".to_string(),
            description: "Blend current frame with next frame".to_string(),
            inputs: vec![PortSpec {
                name: "input".to_string(),
                label: "Input".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            outputs: vec![PortSpec {
                name: "output".to_string(),
                label: "Output".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![ParamSpec {
                key: "blend".to_string(),
                label: "Blend".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(0.5),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
                promotable: true,
            }],
        }
    }

    fn requested_frames(
        &self,
        current_frame: FrameTime,
        _params: &HashMap<String, ParamValue>,
    ) -> Vec<(String, FrameTime)> {
        vec![(
            "input".to_string(),
            FrameTime {
                frame: current_frame.frame.saturating_add(1),
            },
        )]
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let blend = ctx.get_param_float("blend")? as f32;
            let blend = blend.clamp(0.0, 1.0);
            let inv = 1.0 - blend;
            let current = ctx.get_input_image("input")?;
            let next_frame = ctx.frame_time.frame.saturating_add(1);
            let next = ctx
                .get_input_image_at_frame("input", next_frame)
                .ok_or_else(|| CascadeError::MissingInput(format!("input@{}", next_frame)))?;

            if current.width != next.width
                || current.height != next.height
                || current.data_window != next.data_window
            {
                return Err(CascadeError::Other(
                    "FrameBlend inputs must match dimensions".to_string(),
                ));
            }

            let pixel_count = current.pixel_count();
            let mut data = vec![0.0f32; pixel_count * 4];
            let current_data = current.data.as_ref();
            let next_data = next.data.as_ref();
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    for c in 0..4 {
                        out[c] = current_data[idx + c] * inv + next_data[idx + c] * blend;
                    }
                });
            let output = Image::new_with_domain(
                current.format.clone(),
                current.data_window,
                data,
                current.color_space.clone(),
            )?;
            let mut outputs = HashMap::new();
            outputs.insert("output".to_string(), Value::Image(output));
            Ok(outputs)
        })
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cascade_core::color::BuiltinColorManagement;

    fn approx_eq(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn test_time_offset_requested_frames_positive_delays() {
        // Nuke convention: positive offset = delay (look backward)
        let node = TimeOffset::new();
        let mut params = HashMap::new();
        params.insert("offset".to_string(), ParamValue::Int(3));
        let frames = node.requested_frames(FrameTime { frame: 10 }, &params);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].0, "input");
        assert_eq!(frames[0].1.frame, 7); // 10 - 3 = 7
    }

    #[test]
    fn test_time_offset_requested_frames_negative_advances() {
        // Nuke convention: negative offset = advance (look forward)
        let node = TimeOffset::new();
        let mut params = HashMap::new();
        params.insert("offset".to_string(), ParamValue::Int(-5));
        let frames = node.requested_frames(FrameTime { frame: 10 }, &params);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].1.frame, 15); // 10 + 5 = 15
    }

    #[test]
    fn test_time_offset_requested_frames_zero_offset() {
        let node = TimeOffset::new();
        let mut params = HashMap::new();
        params.insert("offset".to_string(), ParamValue::Int(0));
        let frames = node.requested_frames(FrameTime { frame: 7 }, &params);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].1.frame, 7);
    }

    #[test]
    fn test_time_offset_clamps_to_zero() {
        // Positive offset beyond current frame clamps to 0
        let node = TimeOffset::new();
        let mut params = HashMap::new();
        params.insert("offset".to_string(), ParamValue::Int(20));
        let frames = node.requested_frames(FrameTime { frame: 5 }, &params);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].1.frame, 0); // 5 - 20 = clamped to 0
    }

    #[test]
    fn test_frame_hold_requested_frames() {
        let node = FrameHold::new();
        let mut params = HashMap::new();
        params.insert("frame".to_string(), ParamValue::Int(12));
        let frames = node.requested_frames(FrameTime { frame: 3 }, &params);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].1.frame, 12);
    }

    #[test]
    fn test_frame_blend_requested_frames_returns_next_frame() {
        let node = FrameBlend::new();
        let frames = node.requested_frames(FrameTime { frame: 9 }, &HashMap::new());
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].1.frame, 10);
    }

    #[test]
    fn test_frame_blend_pixel_interpolation() -> Result<(), CascadeError> {
        let current = Image::from_f32_data(1, 1, vec![0.2, 0.4, 0.6, 1.0])?;
        let next = Image::from_f32_data(1, 1, vec![1.0, 0.0, 0.0, 1.0])?;
        let mut inputs = HashMap::new();
        inputs.insert("input".to_string(), Value::Image(current));
        let mut extra_inputs = HashMap::new();
        extra_inputs.insert(("input".to_string(), 1), Value::Image(next));
        let mut params = HashMap::new();
        params.insert("blend".to_string(), ParamValue::Float(0.5));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs,
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
        };

        let node = FrameBlend::new();
        let result = pollster::block_on(node.evaluate(&ctx))?;
        let output = result
            .get("output")
            .ok_or_else(|| CascadeError::MissingInput("output".to_string()))?;
        let image = match output {
            Value::Image(img) => img,
            _ => return Err(CascadeError::Other("Expected Image output".to_string())),
        };
        let px = image.get_pixel_f32(0, 0);
        assert!(approx_eq(px[0], 0.6));
        assert!(approx_eq(px[1], 0.2));
        assert!(approx_eq(px[2], 0.3));
        assert!(approx_eq(px[3], 1.0));
        Ok(())
    }
}
