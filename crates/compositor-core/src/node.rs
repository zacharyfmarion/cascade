use crate::color::ColorManagement;
use crate::error::CompositorError;
use crate::types::*;
use std::any::Any;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

#[cfg(not(target_arch = "wasm32"))]
pub type NodeFuture<'a> =
    Pin<Box<dyn Future<Output = Result<HashMap<String, Value>, CompositorError>> + Send + 'a>>;

#[cfg(target_arch = "wasm32")]
pub type NodeFuture<'a> =
    Pin<Box<dyn Future<Output = Result<HashMap<String, Value>, CompositorError>> + 'a>>;

pub enum ImageOrField<'a> {
    Image(&'a Image),
    Field(&'a Field),
}

pub struct EvalContext<'a> {
    pub inputs: HashMap<String, Value>,
    pub params: &'a HashMap<String, ParamValue>,
    pub frame_time: FrameTime,
    pub color_management: &'a dyn ColorManagement,
    pub ai_provider: Option<&'a dyn crate::ai::AiProvider>,
    pub project_format: &'a Format,
    pub ai_cached_outputs: Option<&'a HashMap<String, Value>>,
}

impl<'a> EvalContext<'a> {
    pub fn get_input_image(&self, name: &str) -> Result<&Image, CompositorError> {
        self.inputs
            .get(name)
            .and_then(|v| v.as_image())
            .ok_or_else(|| CompositorError::MissingInput(name.to_string()))
    }

    pub fn get_optional_input_image(&self, name: &str) -> Option<&Image> {
        self.inputs.get(name).and_then(|v| v.as_image())
    }

    pub fn get_input_image_or_field(
        &self,
        name: &str,
    ) -> Result<ImageOrField<'_>, CompositorError> {
        match self.inputs.get(name) {
            Some(Value::Image(img)) => Ok(ImageOrField::Image(img)),
            Some(Value::Field(f)) => Ok(ImageOrField::Field(f)),
            _ => Err(CompositorError::MissingInput(name.to_string())),
        }
    }

    pub fn get_input_float(&self, name: &str) -> Result<f32, CompositorError> {
        self.inputs
            .get(name)
            .and_then(|v| v.as_float())
            .ok_or_else(|| CompositorError::MissingInput(name.to_string()))
    }

    pub fn get_input_bool(&self, name: &str) -> Result<bool, CompositorError> {
        self.inputs
            .get(name)
            .and_then(|v| v.as_bool())
            .ok_or_else(|| CompositorError::MissingInput(name.to_string()))
    }

    pub fn get_input_field(&self, name: &str) -> Result<&Field, CompositorError> {
        self.inputs
            .get(name)
            .and_then(|v| v.as_field())
            .ok_or_else(|| CompositorError::MissingInput(name.to_string()))
    }

    pub fn get_input_string(&self, name: &str) -> Result<&str, CompositorError> {
        self.inputs
            .get(name)
            .and_then(|v| v.as_string())
            .ok_or_else(|| CompositorError::MissingInput(name.to_string()))
    }

    pub fn get_param_float(&self, key: &str) -> Result<f64, CompositorError> {
        match self.params.get(key) {
            Some(ParamValue::Float(v)) => Ok(*v),
            Some(ParamValue::Int(v)) => Ok(*v as f64),
            _ => Err(CompositorError::MissingParam(key.to_string())),
        }
    }

    pub fn get_param_int(&self, key: &str) -> Result<i64, CompositorError> {
        match self.params.get(key) {
            Some(ParamValue::Int(v)) => Ok(*v),
            Some(ParamValue::Float(v)) => Ok(*v as i64),
            _ => Err(CompositorError::MissingParam(key.to_string())),
        }
    }

    pub fn get_param_bool(&self, key: &str) -> Result<bool, CompositorError> {
        match self.params.get(key) {
            Some(ParamValue::Bool(v)) => Ok(*v),
            _ => Err(CompositorError::MissingParam(key.to_string())),
        }
    }

    pub fn get_param_string(&self, key: &str) -> Result<&str, CompositorError> {
        match self.params.get(key) {
            Some(ParamValue::String(v)) => Ok(v.as_str()),
            _ => Err(CompositorError::MissingParam(key.to_string())),
        }
    }

    pub fn get_param_color(&self, key: &str) -> Result<[f64; 4], CompositorError> {
        match self.params.get(key) {
            Some(ParamValue::Color(v)) => Ok(*v),
            _ => Err(CompositorError::MissingParam(key.to_string())),
        }
    }

    pub fn get_param_color_ramp(&self, key: &str) -> Result<&Vec<ColorStop>, CompositorError> {
        match self.params.get(key) {
            Some(ParamValue::ColorRamp(stops)) => Ok(stops),
            _ => Err(CompositorError::MissingParam(key.to_string())),
        }
    }

    pub fn get_param_color_palette(&self, key: &str) -> Result<&Vec<[f64; 4]>, CompositorError> {
        match self.params.get(key) {
            Some(ParamValue::ColorPalette(colors)) => Ok(colors),
            _ => Err(CompositorError::MissingParam(key.to_string())),
        }
    }

    pub fn get_param_curve_points(&self, key: &str) -> Result<&Vec<CurvePoint>, CompositorError> {
        match self.params.get(key) {
            Some(ParamValue::CurvePoints(points)) => Ok(points),
            _ => Err(CompositorError::MissingParam(key.to_string())),
        }
    }
}

pub trait Node: Send + Sync + Any {
    fn spec(&self) -> NodeSpec;

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a>;

    fn as_any(&self) -> &dyn Any;

    fn as_any_mut(&mut self) -> &mut dyn Any;
}

#[derive(Clone)]
pub struct NodeRegistry {
    factories: HashMap<String, Arc<dyn Fn() -> Arc<dyn Node> + Send + Sync>>,
    specs: HashMap<String, NodeSpec>,
}

impl NodeRegistry {
    pub fn new() -> Self {
        Self {
            factories: HashMap::new(),
            specs: HashMap::new(),
        }
    }

    pub fn register<F>(&mut self, id: &str, factory: F)
    where
        F: Fn() -> Arc<dyn Node> + Send + Sync + 'static,
    {
        let node = factory();
        let spec = node.spec();
        self.specs.insert(id.to_string(), spec);
        self.factories.insert(id.to_string(), Arc::new(factory));
    }

    pub fn register_or_replace<F>(&mut self, id: &str, factory: F)
    where
        F: Fn() -> Arc<dyn Node> + Send + Sync + 'static,
    {
        let node = factory();
        let spec = node.spec();
        self.specs.insert(id.to_string(), spec);
        self.factories.insert(id.to_string(), Arc::new(factory));
    }

    pub fn register_spec(&mut self, id: &str, spec: NodeSpec) {
        self.specs.insert(id.to_string(), spec);
    }

    pub fn create(&self, id: &str) -> Option<Arc<dyn Node>> {
        self.factories.get(id).map(|f| f())
    }

    pub fn get_spec(&self, id: &str) -> Option<&NodeSpec> {
        self.specs.get(id)
    }

    pub fn list_specs(&self) -> Vec<&NodeSpec> {
        self.specs.values().collect()
    }
}

impl Default for NodeRegistry {
    fn default() -> Self {
        Self::new()
    }
}
