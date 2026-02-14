use crate::color::ColorManagement;
use crate::error::CompositorError;
use crate::types::*;
use std::any::Any;
use std::collections::HashMap;
use std::sync::Arc;

pub struct EvalContext<'a> {
    pub inputs: HashMap<String, Value>,
    pub params: &'a HashMap<String, ParamValue>,
    pub frame_time: FrameTime,
    pub color_management: &'a dyn ColorManagement,
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

    pub fn get_param_float(&self, key: &str) -> Result<f64, CompositorError> {
        match self.params.get(key) {
            Some(ParamValue::Float(v)) => Ok(*v),
            _ => Err(CompositorError::MissingParam(key.to_string())),
        }
    }

    pub fn get_param_int(&self, key: &str) -> Result<i64, CompositorError> {
        match self.params.get(key) {
            Some(ParamValue::Int(v)) => Ok(*v),
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

    pub fn get_param_color_ramp(&self, key: &str) -> Result<&Vec<ColorStop>, CompositorError> {
        match self.params.get(key) {
            Some(ParamValue::ColorRamp(stops)) => Ok(stops),
            _ => Err(CompositorError::MissingParam(key.to_string())),
        }
    }
}

pub trait Node: Send + Sync + Any {
    fn spec(&self) -> NodeSpec;

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError>;

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
