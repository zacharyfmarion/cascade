use crate::color::ColorManagement;
use crate::error::CompositorError;
use crate::graph::{Graph, NodeId};
use crate::node::{EvalContext, Node, NodeRegistry};
use crate::types::{Format, FrameTime, ParamDefault, ParamValue, Value, ValueType};
use ahash::AHasher;
use slotmap::Key;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use std::time::Duration;
use web_time::Instant;

pub struct EvalResult {
    pub value: Value,
    pub node_timings: HashMap<NodeId, Duration>,
}

pub struct Evaluator {
    cache: HashMap<(NodeId, String), (CacheKey, Value)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CacheKey {
    pub frame_time: FrameTime,
    pub param_revision: u64,
    pub upstream_hash: u64,
    pub project_format_hash: u64,
}

impl Evaluator {
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
        }
    }

    pub async fn evaluate(
        &mut self,
        graph: &mut Graph,
        registry: &NodeRegistry,
        node_instances: &HashMap<NodeId, Arc<dyn Node>>,
        viewer_node_id: NodeId,
        output_port: &str,
        frame_time: FrameTime,
        color_management: &dyn ColorManagement,
        ai_provider: Option<&dyn crate::ai::AiProvider>,
        project_format: &Format,
        ai_node_cache: &HashMap<NodeId, HashMap<String, Value>>,
    ) -> Result<EvalResult, CompositorError> {
        let mut visited = HashSet::new();
        let mut order = Vec::new();
        self.visit_postorder(graph, registry, viewer_node_id, &mut visited, &mut order)?;
        let mut node_timings = HashMap::new();

        for node_id in order {
            let instance = graph
                .nodes
                .get(node_id)
                .ok_or(CompositorError::NodeNotFound(node_id))?;
            let spec = registry
                .get_spec(&instance.type_id)
                .ok_or_else(|| CompositorError::InvalidConnection(instance.type_id.clone()))?;

            let upstream_hash = self.compute_upstream_hash(graph, node_id, spec, frame_time)?;
            let pf_hash = {
                let mut h = AHasher::default();
                project_format.hash(&mut h);
                h.finish()
            };
            let key = CacheKey {
                frame_time,
                param_revision: instance.param_revision,
                upstream_hash,
                project_format_hash: pf_hash,
            };

            let cache_hit = !graph.is_dirty(node_id)
                && spec.outputs.iter().all(|port| {
                    self.cache
                        .get(&(node_id, port.name.clone()))
                        .map(|(cached_key, _)| cached_key == &key)
                        .unwrap_or(false)
                });

            if cache_hit {
                node_timings.insert(node_id, Duration::ZERO);
                continue;
            }

            let node = node_instances
                .get(&node_id)
                .ok_or(CompositorError::NodeNotFound(node_id))?;

            let mut inputs = HashMap::new();
            for input in spec.all_inputs().iter() {
                if let Some((up_node, up_port)) = graph.get_upstream(node_id, &input.name) {
                    // 1. Upstream connection takes priority
                    let value = self
                        .cache
                        .get(&(up_node, up_port.clone()))
                        .map(|(_, v)| v.clone())
                        .ok_or_else(|| {
                            CompositorError::MissingInput(format!(
                                "{}.{}",
                                up_node.data().as_ffi(),
                                up_port
                            ))
                        })?;
                    inputs.insert(input.name.clone(), value);
                } else if let Some(param_val) = instance.input_defaults.get(&input.name) {
                    // 2. Per-instance input default
                    inputs.insert(input.name.clone(), Self::param_value_to_value(param_val));
                } else if let Some(spec_default) = &input.default {
                    // 3. Spec-level default from PortSpec
                    inputs.insert(
                        input.name.clone(),
                        Self::param_default_to_value(spec_default),
                    );
                }
            }

            // Auto-rasterize Field values arriving at Image/Mask ports.
            // Derive rasterization domain from the first Image input, or
            // fall back to project_format when no Image inputs exist.
            let ref_domain: Option<(Format, crate::types::RectI)> =
                inputs.values().find_map(|v| match v {
                    Value::Image(img) | Value::Mask(img) => {
                        Some((img.format.clone(), img.data_window))
                    }
                    _ => None,
                });
            let (raster_format, raster_dw) = ref_domain
                .unwrap_or_else(|| (project_format.clone(), project_format.display_window));

            let all_inputs = spec.all_inputs();
            for port in all_inputs.iter() {
                if matches!(port.ty, ValueType::Image | ValueType::Mask) {
                    if let Some(Value::Field(field)) = inputs.get(&port.name) {
                        let rasterized =
                            field.rasterize_to_domain(raster_format.clone(), raster_dw)?;
                        let converted = if port.ty == ValueType::Mask {
                            Value::Mask(rasterized)
                        } else {
                            Value::Image(rasterized)
                        };
                        inputs.insert(port.name.clone(), converted);
                    }
                }
            }

            // Muted nodes pass data through without processing
            if instance.muted {
                for output in spec.outputs.iter() {
                    let pass_value = spec.inputs.iter()
                        .find(|inp| inp.ty == output.ty)
                        .and_then(|inp| inputs.get(&inp.name))
                        .cloned()
                        .unwrap_or(Value::None);
                    self.cache
                        .insert((node_id, output.name.clone()), (key.clone(), pass_value));
                }
                node_timings.insert(node_id, Duration::ZERO);
                graph.clear_dirty(node_id);
                continue;
            }

            let mut merged_params = Self::merge_params(instance, spec);
            Self::apply_promoted_params(
                &mut merged_params, spec, instance, graph, node_id, &self.cache,
            );
            let ctx = EvalContext {
                inputs,
                params: &merged_params,
                frame_time,
                color_management,
                ai_provider,
                project_format,
                ai_cached_outputs: {
                    static EMPTY: std::sync::LazyLock<HashMap<String, Value>> =
                        std::sync::LazyLock::new(HashMap::new);
                    Some(ai_node_cache.get(&node_id).unwrap_or(&EMPTY))
                },
            };
            let start = Instant::now();
            let outputs = node.evaluate(&ctx).await.map_err(|e| {
                CompositorError::EvalFailed {
                    node_id: instance.uuid.clone(),
                    node_type: instance.type_id.clone(),
                    source: Box::new(e),
                }
            })?;
            let elapsed = start.elapsed();
            node_timings.insert(node_id, elapsed);
            for output in spec.outputs.iter() {
                let value = outputs.get(&output.name).cloned().unwrap_or(Value::None);
                self.cache
                    .insert((node_id, output.name.clone()), (key.clone(), value));
            }

            graph.clear_dirty(node_id);
        }

        let value = self
            .cache
            .get(&(viewer_node_id, output_port.to_string()))
            .map(|(_, v)| v.clone())
            .ok_or_else(|| {
                CompositorError::MissingInput(format!(
                    "{}.{}",
                    viewer_node_id.data().as_ffi(),
                    output_port
                ))
            })?;
        Ok(EvalResult {
            value,
            node_timings,
        })
    }

    fn visit_postorder(
        &self,
        graph: &Graph,
        registry: &NodeRegistry,
        node_id: NodeId,
        visited: &mut HashSet<NodeId>,
        order: &mut Vec<NodeId>,
    ) -> Result<(), CompositorError> {
        if !visited.insert(node_id) {
            return Ok(());
        }
        let instance = graph
            .nodes
            .get(node_id)
            .ok_or(CompositorError::NodeNotFound(node_id))?;
        let spec = registry
            .get_spec(&instance.type_id)
            .ok_or_else(|| CompositorError::InvalidConnection(instance.type_id.clone()))?;
        for input in spec.all_inputs().iter() {
            if let Some((upstream_node, _)) = graph.get_upstream(node_id, &input.name) {
                self.visit_postorder(graph, registry, upstream_node, visited, order)?;
            }
        }
        order.push(node_id);
        Ok(())
    }

    fn compute_upstream_hash(
        &self,
        graph: &Graph,
        node_id: NodeId,
        spec: &crate::types::NodeSpec,
        frame_time: FrameTime,
    ) -> Result<u64, CompositorError> {
        let mut hasher = AHasher::default();
        frame_time.hash(&mut hasher);
        for input in spec.all_inputs().iter() {
            if let Some((up_node, up_port)) = graph.get_upstream(node_id, &input.name) {
                let cache_key = self
                    .cache
                    .get(&(up_node, up_port.clone()))
                    .map(|(key, _)| key)
                    .ok_or_else(|| {
                        CompositorError::MissingInput(format!(
                            "{}.{}",
                            up_node.data().as_ffi(),
                            up_port
                        ))
                    })?;
                input.name.hash(&mut hasher);
                up_node.hash(&mut hasher);
                up_port.hash(&mut hasher);
                cache_key.hash(&mut hasher);
            }
        }
        Ok(hasher.finish())
    }

    pub fn get_cached(&self, node_id: NodeId, output_port: &str) -> Option<&Value> {
        self.cache
            .get(&(node_id, output_port.to_string()))
            .map(|(_, v)| v)
    }

    pub fn cache(&self) -> &HashMap<(NodeId, String), (CacheKey, Value)> {
        &self.cache
    }

    pub fn compute_node_cache_key(
        &self,
        graph: &Graph,
        registry: &NodeRegistry,
        node_id: NodeId,
        frame_time: FrameTime,
        project_format: &Format,
    ) -> Result<CacheKey, CompositorError> {
        let instance = graph
            .nodes
            .get(node_id)
            .ok_or(CompositorError::NodeNotFound(node_id))?;
        let spec = registry
            .get_spec(&instance.type_id)
            .ok_or_else(|| CompositorError::InvalidConnection(instance.type_id.clone()))?;
        let upstream_hash = self.compute_upstream_hash(graph, node_id, spec, frame_time)?;
        let pf_hash = {
            let mut h = AHasher::default();
            project_format.hash(&mut h);
            h.finish()
        };
        Ok(CacheKey {
            frame_time,
            param_revision: instance.param_revision,
            upstream_hash,
            project_format_hash: pf_hash,
        })
    }

    pub fn merge_params(
        instance: &crate::graph::NodeInstance,
        spec: &crate::types::NodeSpec,
    ) -> HashMap<String, ParamValue> {
        let mut params = HashMap::new();
        for param in spec.params.iter() {
            if let Some(value) = instance.params.get(&param.key) {
                params.insert(param.key.clone(), value.clone());
            } else {
                params.insert(param.key.clone(), Self::default_to_value(&param.default));
            }
        }
        for (key, value) in instance.params.iter() {
            params.entry(key.clone()).or_insert_with(|| value.clone());
        }
        params
    }

    pub fn apply_promoted_params(
        params: &mut HashMap<String, ParamValue>,
        spec: &crate::types::NodeSpec,
        instance: &crate::graph::NodeInstance,
        graph: &Graph,
        node_id: NodeId,
        cache: &HashMap<(NodeId, String), (CacheKey, Value)>,
    ) {
        for param in &spec.params {
            if !crate::types::NodeSpec::is_connectable_param(param) {
                continue;
            }
            if let Some((up_node, up_port)) = graph.get_upstream(node_id, &param.key) {
                if let Some((_, cached_value)) = cache.get(&(up_node, up_port)) {
                    if let Some(pv) = cached_value.to_param_value() {
                        params.insert(param.key.clone(), pv);
                    }
                }
            } else if let Some(input_default) = instance.input_defaults.get(&param.key) {
                params.insert(param.key.clone(), input_default.clone());
            }
        }
    }

    fn default_to_value(default: &ParamDefault) -> ParamValue {
        match default {
            ParamDefault::Float(v) => ParamValue::Float(*v),
            ParamDefault::Int(v) => ParamValue::Int(*v),
            ParamDefault::Bool(v) => ParamValue::Bool(*v),
            ParamDefault::Color(v) => ParamValue::Color(*v),
            ParamDefault::ColorRamp(v) => ParamValue::ColorRamp(v.clone()),
            ParamDefault::ColorPalette(v) => ParamValue::ColorPalette(v.clone()),
            ParamDefault::CurvePoints(v) => ParamValue::CurvePoints(v.clone()),
            ParamDefault::String(v) => ParamValue::String(v.clone()),
        }
    }

    fn param_value_to_value(pv: &ParamValue) -> Value {
        match pv {
            ParamValue::Float(v) => Value::Float(*v as f32),
            ParamValue::Int(v) => Value::Int(*v as i32),
            ParamValue::Bool(v) => Value::Bool(*v),
            ParamValue::Color(v) => {
                Value::Color([v[0] as f32, v[1] as f32, v[2] as f32, v[3] as f32])
            }
            _ => Value::None,
        }
    }

    fn param_default_to_value(pd: &ParamDefault) -> Value {
        match pd {
            ParamDefault::Float(v) => Value::Float(*v as f32),
            ParamDefault::Int(v) => Value::Int(*v as i32),
            ParamDefault::Bool(v) => Value::Bool(*v),
            ParamDefault::Color(v) => {
                Value::Color([v[0] as f32, v[1] as f32, v[2] as f32, v[3] as f32])
            }
            _ => Value::None,
        }
    }
}

impl Default for Evaluator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::BuiltinColorManagement;
    use crate::node::{EvalContext, NodeFuture};
    use crate::types::{Image, PortSpec, ValueType};
    use pollster::block_on;
    use std::any::Any;
    use std::sync::Arc;

    struct MockNode {
        spec: crate::types::NodeSpec,
        output: Value,
    }

    impl MockNode {
        fn new(spec: crate::types::NodeSpec, output: Value) -> Self {
            Self { spec, output }
        }
    }

    impl crate::node::Node for MockNode {
        fn spec(&self) -> crate::types::NodeSpec {
            self.spec.clone()
        }

        fn evaluate<'a>(&'a self, _ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
            Box::pin(async move {
                let mut outputs = HashMap::new();
                outputs.insert("output".to_string(), self.output.clone());
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

    fn create_simple_image() -> Image {
        let width = 2u32;
        let height = 2u32;
        let data = vec![1.0f32; 16];
        Image::from_f32_data(width, height, data).unwrap()
    }

    fn create_simple_registry() -> NodeRegistry {
        let mut registry = NodeRegistry::new();
        registry.register("source", || {
            let spec = crate::types::NodeSpec {
                id: "source".to_string(),
                display_name: "Source".to_string(),
                category: "Input".to_string(),
                description: "Test source".to_string(),
                inputs: vec![],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                }],
                params: vec![],
            };
            Arc::new(MockNode::new(spec, Value::Image(create_simple_image())))
        });
        registry.register("processor", || {
            let spec = crate::types::NodeSpec {
                id: "processor".to_string(),
                display_name: "Processor".to_string(),
                category: "Processing".to_string(),
                description: "Test processor".to_string(),
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
                params: vec![crate::types::ParamSpec {
                    key: "factor".to_string(),
                    label: "Factor".to_string(),
                    ty: ValueType::Float,
                    default: crate::types::ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(10.0),
                    step: Some(0.1),
                    ui_hint: crate::types::UiHint::Slider,
                    promotable: true,
                }],
            };
            Arc::new(MockNode::new(spec, Value::Image(create_simple_image())))
        });
        registry.register("sink", || {
            let spec = crate::types::NodeSpec {
                id: "sink".to_string(),
                display_name: "Sink".to_string(),
                category: "Output".to_string(),
                description: "Test sink".to_string(),
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
                params: vec![],
            };
            Arc::new(MockNode::new(spec, Value::Image(create_simple_image())))
        });
        registry
    }

    #[test]
    fn test_simple_chain_evaluation() {
        let mut graph = Graph::new();
        let registry = create_simple_registry();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let source_id = graph.add_node("source");
        let processor_id = graph.add_node("processor");
        let sink_id = graph.add_node("sink");

        graph
            .connect(&registry, source_id, "output", processor_id, "input")
            .unwrap();
        graph
            .connect(&registry, processor_id, "output", sink_id, "input")
            .unwrap();

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(
            source_id,
            Arc::new(MockNode::new(
                registry.get_spec("source").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );
        node_instances.insert(
            processor_id,
            Arc::new(MockNode::new(
                registry.get_spec("processor").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );
        node_instances.insert(
            sink_id,
            Arc::new(MockNode::new(
                registry.get_spec("sink").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );

        let result = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            sink_id,
            "output",
            FrameTime { frame: 0 },
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));

        assert!(result.is_ok());
        let eval_result = result.unwrap();
        if let Value::Image(img) = eval_result.value {
            assert_eq!(img.width, 2);
            assert_eq!(img.height, 2);
        }
    }

    #[test]
    fn test_cache_hit_without_changes() {
        let mut graph = Graph::new();
        let registry = create_simple_registry();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let source_id = graph.add_node("source");
        let sink_id = graph.add_node("sink");

        graph
            .connect(&registry, source_id, "output", sink_id, "input")
            .unwrap();

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(
            source_id,
            Arc::new(MockNode::new(
                registry.get_spec("source").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );
        node_instances.insert(
            sink_id,
            Arc::new(MockNode::new(
                registry.get_spec("sink").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );

        let frame_time = FrameTime { frame: 0 };

        let result1 = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            sink_id,
            "output",
            frame_time,
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));
        assert!(result1.is_ok());

        let cache_size_before = evaluator.cache.len();

        let result2 = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            sink_id,
            "output",
            frame_time,
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));
        assert!(result2.is_ok());

        let cache_size_after = evaluator.cache.len();
        assert_eq!(cache_size_before, cache_size_after);
    }

    #[test]
    fn test_cache_miss_on_param_change() {
        let mut graph = Graph::new();
        let registry = create_simple_registry();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let source_id = graph.add_node("source");
        let processor_id = graph.add_node("processor");
        let sink_id = graph.add_node("sink");

        graph
            .connect(&registry, source_id, "output", processor_id, "input")
            .unwrap();
        graph
            .connect(&registry, processor_id, "output", sink_id, "input")
            .unwrap();

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(
            source_id,
            Arc::new(MockNode::new(
                registry.get_spec("source").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );
        node_instances.insert(
            processor_id,
            Arc::new(MockNode::new(
                registry.get_spec("processor").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );
        node_instances.insert(
            sink_id,
            Arc::new(MockNode::new(
                registry.get_spec("sink").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );

        let frame_time = FrameTime { frame: 0 };

        let result1 = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            sink_id,
            "output",
            frame_time,
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));
        assert!(result1.is_ok());

        let processor_node = graph.nodes.get(processor_id).unwrap();
        let revision_before = processor_node.param_revision;

        graph.set_param(processor_id, "factor", ParamValue::Float(2.0));

        let processor_node = graph.nodes.get(processor_id).unwrap();
        let revision_after = processor_node.param_revision;
        assert!(revision_after > revision_before);

        let result2 = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            sink_id,
            "output",
            frame_time,
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));
        assert!(result2.is_ok());
    }

    #[test]
    fn test_evaluation_single_source_node() {
        let mut graph = Graph::new();
        let registry = create_simple_registry();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let source_id = graph.add_node("source");

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(
            source_id,
            Arc::new(MockNode::new(
                registry.get_spec("source").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );

        let result = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            source_id,
            "output",
            FrameTime { frame: 0 },
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));

        assert!(result.is_ok());
        let eval_result = result.unwrap();
        if let Value::Image(img) = eval_result.value {
            assert_eq!(img.width, 2);
            assert_eq!(img.height, 2);
        }
    }

    #[test]
    fn test_field_auto_rasterized_to_image_for_mask_port() {
        use crate::types::Field;

        let mut registry = NodeRegistry::new();

        registry.register("field_source", || {
            let spec = crate::types::NodeSpec {
                id: "field_source".to_string(),
                display_name: "Field Source".to_string(),
                category: "Generator".to_string(),
                description: "Outputs a field".to_string(),
                inputs: vec![],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Field,
                    ..Default::default()
                }],
                params: vec![],
            };
            let field = Field::new(|u, _v| [u, u, u, 1.0]);
            Arc::new(MockNode::new(spec, Value::Field(field)))
        });

        registry.register("image_source", || {
            let spec = crate::types::NodeSpec {
                id: "image_source".to_string(),
                display_name: "Image Source".to_string(),
                category: "Input".to_string(),
                description: "Outputs a 4x4 image".to_string(),
                inputs: vec![],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                }],
                params: vec![],
            };
            Arc::new(MockNode::new(
                spec,
                Value::Image(Image::from_f32_data(4, 4, vec![0.5f32; 64]).unwrap()),
            ))
        });

        struct MaskConsumerNode {
            spec: crate::types::NodeSpec,
        }

        impl crate::node::Node for MaskConsumerNode {
            fn spec(&self) -> crate::types::NodeSpec {
                self.spec.clone()
            }

            fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
                Box::pin(async move {
                    let _image = ctx.get_input_image("image")?;
                    let mask_val = ctx.inputs.get("mask");
                    match mask_val {
                        Some(Value::Image(img)) => {
                            assert_eq!(img.width, 4);
                            assert_eq!(img.height, 4);
                        }
                        other => panic!(
                            "Expected mask to be auto-rasterized to Image, got: {:?}",
                            other.map(|v| v.value_type())
                        ),
                    }
                    let mut outputs = HashMap::new();
                    outputs.insert("output".to_string(), Value::Image(Image::new(4, 4)));
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

        registry.register("mask_consumer", || {
            let spec = crate::types::NodeSpec {
                id: "mask_consumer".to_string(),
                display_name: "Mask Consumer".to_string(),
                category: "Filter".to_string(),
                description: "Has image + mask inputs".to_string(),
                inputs: vec![
                    PortSpec {
                        name: "image".to_string(),
                        label: "Image".to_string(),
                        ty: ValueType::Image,
                        ..Default::default()
                    },
                    PortSpec {
                        name: "mask".to_string(),
                        label: "Mask".to_string(),
                        ty: ValueType::Image,
                        ..Default::default()
                    },
                ],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                }],
                params: vec![],
            };
            Arc::new(MaskConsumerNode { spec })
        });

        let mut graph = Graph::new();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let image_src = graph.add_node("image_source");
        let field_src = graph.add_node("field_source");
        let consumer = graph.add_node("mask_consumer");

        graph
            .connect(&registry, image_src, "output", consumer, "image")
            .unwrap();
        graph
            .connect(&registry, field_src, "output", consumer, "mask")
            .unwrap();

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(image_src, registry.create("image_source").unwrap());
        node_instances.insert(field_src, registry.create("field_source").unwrap());
        node_instances.insert(consumer, registry.create("mask_consumer").unwrap());

        let result = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            consumer,
            "output",
            FrameTime { frame: 0 },
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));

        assert!(result.is_ok());
    }

    #[test]
    fn test_frame_time_changes_evaluation() {
        let mut graph = Graph::new();
        let registry = create_simple_registry();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let source_id = graph.add_node("source");
        let sink_id = graph.add_node("sink");

        graph
            .connect(&registry, source_id, "output", sink_id, "input")
            .unwrap();

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(
            source_id,
            Arc::new(MockNode::new(
                registry.get_spec("source").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );
        node_instances.insert(
            sink_id,
            Arc::new(MockNode::new(
                registry.get_spec("sink").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );

        let frame_time_1 = FrameTime { frame: 0 };
        let frame_time_2 = FrameTime { frame: 1 };

        let result1 = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            sink_id,
            "output",
            frame_time_1,
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));
        assert!(result1.is_ok());

        let cache_size_frame_1 = evaluator.cache.len();

        let result2 = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            sink_id,
            "output",
            frame_time_2,
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));
        assert!(result2.is_ok());

        let cache_size_frame_2 = evaluator.cache.len();
        assert!(cache_size_frame_2 >= cache_size_frame_1);
    }

    #[test]
    fn test_field_rasterized_inherits_image_domain() {
        use crate::types::{Field, IVec2, RectI};

        let mut registry = NodeRegistry::new();

        registry.register("field_source", || {
            let spec = crate::types::NodeSpec {
                id: "field_source".to_string(),
                display_name: "Field Source".to_string(),
                category: "Generator".to_string(),
                description: "".to_string(),
                inputs: vec![],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Field,
                    ..Default::default()
                }],
                params: vec![],
            };
            let field = Field::new(|u, _v| [u, u, u, 1.0]);
            Arc::new(MockNode::new(spec, Value::Field(field)))
        });

        let offset_format = Format::hd();
        let offset_dw = RectI {
            min: IVec2::new(50, 50),
            max: IVec2::new(54, 54),
        };
        registry.register("offset_image_source", || {
            let spec = crate::types::NodeSpec {
                id: "offset_image_source".to_string(),
                display_name: "Offset Image".to_string(),
                category: "Input".to_string(),
                description: "".to_string(),
                inputs: vec![],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                }],
                params: vec![],
            };
            Arc::new(MockNode::new(
                spec,
                Value::Image(Image::new_with_domain(
                    Format::hd(),
                    RectI {
                        min: IVec2::new(50, 50),
                        max: IVec2::new(54, 54),
                    },
                    vec![0.5f32; 64],
                    crate::types::ColorSpaceId::default_working(),
                ).unwrap()),
            ))
        });

        struct DomainChecker {
            spec: crate::types::NodeSpec,
        }

        impl crate::node::Node for DomainChecker {
            fn spec(&self) -> crate::types::NodeSpec {
                self.spec.clone()
            }

            fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
                Box::pin(async move {
                    let image = ctx.get_input_image("image")?;
                    let mask_val = ctx.inputs.get("mask");
                    match mask_val {
                        Some(Value::Image(mask_img)) => {
                            assert_eq!(
                                mask_img.data_window, image.data_window,
                                "mask should be rasterized to image's data_window"
                            );
                            assert_eq!(
                                mask_img.format, image.format,
                                "mask should inherit image's format"
                            );
                        }
                        other => panic!(
                            "Expected auto-rasterized Image, got: {:?}",
                            other.map(|v| v.value_type())
                        ),
                    }
                    let mut outputs = HashMap::new();
                    outputs.insert("output".to_string(), Value::Image(image.clone()));
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

        registry.register("domain_checker", || {
            let spec = crate::types::NodeSpec {
                id: "domain_checker".to_string(),
                display_name: "Domain Checker".to_string(),
                category: "Test".to_string(),
                description: "".to_string(),
                inputs: vec![
                    PortSpec {
                        name: "image".to_string(),
                        label: "Image".to_string(),
                        ty: ValueType::Image,
                        ..Default::default()
                    },
                    PortSpec {
                        name: "mask".to_string(),
                        label: "Mask".to_string(),
                        ty: ValueType::Image,
                        ..Default::default()
                    },
                ],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                }],
                params: vec![],
            };
            Arc::new(DomainChecker { spec })
        });

        let mut graph = Graph::new();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let img_src = graph.add_node("offset_image_source");
        let field_src = graph.add_node("field_source");
        let checker = graph.add_node("domain_checker");

        graph
            .connect(&registry, img_src, "output", checker, "image")
            .unwrap();
        graph
            .connect(&registry, field_src, "output", checker, "mask")
            .unwrap();

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(img_src, registry.create("offset_image_source").unwrap());
        node_instances.insert(field_src, registry.create("field_source").unwrap());
        node_instances.insert(checker, registry.create("domain_checker").unwrap());

        let result = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            checker,
            "output",
            FrameTime { frame: 0 },
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));

        assert!(result.is_ok());
    }

    #[test]
    fn test_field_rasterized_to_project_format_when_no_image_inputs() {
        use crate::types::Field;

        struct FieldOnlyConsumer {
            spec: crate::types::NodeSpec,
        }

        impl crate::node::Node for FieldOnlyConsumer {
            fn spec(&self) -> crate::types::NodeSpec {
                self.spec.clone()
            }

            fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
                Box::pin(async move {
                    match ctx.inputs.get("image") {
                        Some(Value::Image(img)) => {
                            assert_eq!(
                                img.format, *ctx.project_format,
                                "rasterized field should use project_format"
                            );
                            assert_eq!(
                                img.data_window, ctx.project_format.display_window,
                                "rasterized field should use project_format display_window"
                            );
                            let mut outputs = HashMap::new();
                            outputs.insert("output".to_string(), Value::Image(img.clone()));
                            Ok(outputs)
                        }
                        other => panic!(
                            "Expected auto-rasterized Image, got: {:?}",
                            other.map(|v| v.value_type())
                        ),
                    }
                })
            }

            fn as_any(&self) -> &dyn Any {
                self
            }
            fn as_any_mut(&mut self) -> &mut dyn Any {
                self
            }
        }

        let mut registry = NodeRegistry::new();

        registry.register("field_source", || {
            let spec = crate::types::NodeSpec {
                id: "field_source".to_string(),
                display_name: "Field Source".to_string(),
                category: "Generator".to_string(),
                description: "".to_string(),
                inputs: vec![],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Field,
                    ..Default::default()
                }],
                params: vec![],
            };
            let field = Field::new(|u, v| [u, v, 0.0, 1.0]);
            Arc::new(MockNode::new(spec, Value::Field(field)))
        });

        registry.register("field_consumer", || {
            let spec = crate::types::NodeSpec {
                id: "field_consumer".to_string(),
                display_name: "Field Consumer".to_string(),
                category: "Test".to_string(),
                description: "".to_string(),
                inputs: vec![PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                }],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                }],
                params: vec![],
            };
            Arc::new(FieldOnlyConsumer { spec })
        });

        let mut graph = Graph::new();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let field_src = graph.add_node("field_source");
        let consumer = graph.add_node("field_consumer");

        graph
            .connect(&registry, field_src, "output", consumer, "image")
            .unwrap();

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(field_src, registry.create("field_source").unwrap());
        node_instances.insert(consumer, registry.create("field_consumer").unwrap());

        let project_format = Format::from_dimensions(1280, 720);
        let result = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            consumer,
            "output",
            FrameTime { frame: 0 },
            &cm,
            None,
            &project_format,
            &HashMap::new(),
        ));

        assert!(result.is_ok());
        let eval_result = result.unwrap();
        if let Value::Image(img) = eval_result.value {
            assert_eq!(img.width, 1280);
            assert_eq!(img.height, 720);
        } else {
            panic!("Expected Image output");
        }
    }

    #[test]
    fn test_muted_node_passes_through_input() {
        let mut graph = Graph::new();
        let registry = create_simple_registry();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let source_id = graph.add_node("source");
        let processor_id = graph.add_node("processor");
        let sink_id = graph.add_node("sink");

        graph
            .connect(&registry, source_id, "output", processor_id, "input")
            .unwrap();
        graph
            .connect(&registry, processor_id, "output", sink_id, "input")
            .unwrap();

        // Mute the processor node
        graph.set_muted(processor_id, true);
        assert!(graph.nodes.get(processor_id).unwrap().muted);

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(
            source_id,
            Arc::new(MockNode::new(
                registry.get_spec("source").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );
        node_instances.insert(
            processor_id,
            Arc::new(MockNode::new(
                registry.get_spec("processor").unwrap().clone(),
                Value::Image(Image::new(1, 1)), // Processor would output 1x1, but muted skips it
            )),
        );
        node_instances.insert(
            sink_id,
            Arc::new(MockNode::new(
                registry.get_spec("sink").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );

        let result = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            sink_id,
            "output",
            FrameTime { frame: 0 },
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));

        assert!(result.is_ok());
        let eval_result = result.unwrap();

        // Muted processor should have zero timing
        assert_eq!(
            *eval_result.node_timings.get(&processor_id).unwrap(),
            std::time::Duration::ZERO
        );
    }

    #[test]
    fn test_unmuted_node_evaluates_normally() {
        let mut graph = Graph::new();
        let registry = create_simple_registry();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let source_id = graph.add_node("source");
        let processor_id = graph.add_node("processor");
        let sink_id = graph.add_node("sink");

        graph
            .connect(&registry, source_id, "output", processor_id, "input")
            .unwrap();
        graph
            .connect(&registry, processor_id, "output", sink_id, "input")
            .unwrap();

        // Mute and then unmute
        graph.set_muted(processor_id, true);
        graph.set_muted(processor_id, false);
        assert!(!graph.nodes.get(processor_id).unwrap().muted);

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(
            source_id,
            Arc::new(MockNode::new(
                registry.get_spec("source").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );
        node_instances.insert(
            processor_id,
            Arc::new(MockNode::new(
                registry.get_spec("processor").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );
        node_instances.insert(
            sink_id,
            Arc::new(MockNode::new(
                registry.get_spec("sink").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );

        let result = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            sink_id,
            "output",
            FrameTime { frame: 0 },
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));

        assert!(result.is_ok());
    }

    #[test]
    fn test_compute_node_cache_key_consistent_for_unchanged_state() {
        let mut graph = Graph::new();
        let registry = create_simple_registry();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let source_id = graph.add_node("source");
        let processor_id = graph.add_node("processor");

        graph
            .connect(&registry, source_id, "output", processor_id, "input")
            .unwrap();

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(
            source_id,
            Arc::new(MockNode::new(
                registry.get_spec("source").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );
        node_instances.insert(
            processor_id,
            Arc::new(MockNode::new(
                registry.get_spec("processor").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );

        // Evaluate once to populate caches
        let _ = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            processor_id,
            "output",
            FrameTime { frame: 0 },
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));

        let frame_time = FrameTime { frame: 0 };
        let format = Format::hd();

        let key1 = evaluator
            .compute_node_cache_key(&graph, &registry, processor_id, frame_time, &format)
            .unwrap();
        let key2 = evaluator
            .compute_node_cache_key(&graph, &registry, processor_id, frame_time, &format)
            .unwrap();

        assert_eq!(key1, key2, "Cache key should be identical for unchanged state");
    }

    #[test]
    fn test_compute_node_cache_key_changes_on_param_change() {
        let mut graph = Graph::new();
        let registry = create_simple_registry();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let source_id = graph.add_node("source");
        let processor_id = graph.add_node("processor");

        graph
            .connect(&registry, source_id, "output", processor_id, "input")
            .unwrap();

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(
            source_id,
            Arc::new(MockNode::new(
                registry.get_spec("source").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );
        node_instances.insert(
            processor_id,
            Arc::new(MockNode::new(
                registry.get_spec("processor").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );

        let _ = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            processor_id,
            "output",
            FrameTime { frame: 0 },
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));

        let frame_time = FrameTime { frame: 0 };
        let format = Format::hd();

        let key_before = evaluator
            .compute_node_cache_key(&graph, &registry, processor_id, frame_time, &format)
            .unwrap();

        // Change a param on the processor node
        graph.set_param(processor_id, "factor", ParamValue::Float(2.0));

        let key_after = evaluator
            .compute_node_cache_key(&graph, &registry, processor_id, frame_time, &format)
            .unwrap();

        assert_ne!(
            key_before, key_after,
            "Cache key should change after param modification"
        );
        assert_ne!(
            key_before.param_revision, key_after.param_revision,
            "param_revision should differ"
        );
    }

    #[test]
    fn test_compute_node_cache_key_changes_on_frame_time_change() {
        let mut graph = Graph::new();
        let registry = create_simple_registry();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let source_id = graph.add_node("source");
        let processor_id = graph.add_node("processor");

        graph
            .connect(&registry, source_id, "output", processor_id, "input")
            .unwrap();

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(
            source_id,
            Arc::new(MockNode::new(
                registry.get_spec("source").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );
        node_instances.insert(
            processor_id,
            Arc::new(MockNode::new(
                registry.get_spec("processor").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );

        let _ = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            processor_id,
            "output",
            FrameTime { frame: 0 },
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));

        let format = Format::hd();

        let key_frame_0 = evaluator
            .compute_node_cache_key(&graph, &registry, processor_id, FrameTime { frame: 0 }, &format)
            .unwrap();
        let key_frame_1 = evaluator
            .compute_node_cache_key(&graph, &registry, processor_id, FrameTime { frame: 1 }, &format)
            .unwrap();

        assert_ne!(
            key_frame_0, key_frame_1,
            "Cache key should differ for different frame times"
        );
        assert_ne!(
            key_frame_0.frame_time, key_frame_1.frame_time,
            "frame_time field should differ"
        );
    }

    #[test]
    fn test_compute_node_cache_key_changes_on_upstream_connection_change() {
        let mut graph = Graph::new();
        let registry = create_simple_registry();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let source_id = graph.add_node("source");
        let processor_id = graph.add_node("processor");
        let sink_id = graph.add_node("sink");

        graph
            .connect(&registry, source_id, "output", processor_id, "input")
            .unwrap();
        graph
            .connect(&registry, processor_id, "output", sink_id, "input")
            .unwrap();

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(
            source_id,
            Arc::new(MockNode::new(
                registry.get_spec("source").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );
        node_instances.insert(
            processor_id,
            Arc::new(MockNode::new(
                registry.get_spec("processor").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );
        node_instances.insert(
            sink_id,
            Arc::new(MockNode::new(
                registry.get_spec("sink").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );

        let frame_time = FrameTime { frame: 0 };
        let format = Format::hd();

        // Evaluate to populate cache
        let _ = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            sink_id,
            "output",
            frame_time,
            &cm,
            None,
            &format,
            &HashMap::new(),
        ));

        let key_before = evaluator
            .compute_node_cache_key(&graph, &registry, sink_id, frame_time, &format)
            .unwrap();

        // Change a param on the upstream source node — this changes the upstream hash for sink
        graph.set_param(source_id, "value", ParamValue::Float(1.0));

        // Re-evaluate so the evaluator's internal cache keys reflect the upstream change
        let _ = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            sink_id,
            "output",
            frame_time,
            &cm,
            None,
            &format,
            &HashMap::new(),
        ));

        let key_after = evaluator
            .compute_node_cache_key(&graph, &registry, sink_id, frame_time, &format)
            .unwrap();

        assert_ne!(
            key_before, key_after,
            "Cache key should change when upstream node params change"
        );
    }

    #[test]
    fn test_compute_node_cache_key_changes_on_project_format_change() {
        let mut graph = Graph::new();
        let registry = create_simple_registry();
        let mut evaluator = Evaluator::new();
        let cm = BuiltinColorManagement::new();

        let source_id = graph.add_node("source");

        let mut node_instances: HashMap<NodeId, Arc<dyn crate::node::Node>> = HashMap::new();
        node_instances.insert(
            source_id,
            Arc::new(MockNode::new(
                registry.get_spec("source").unwrap().clone(),
                Value::Image(create_simple_image()),
            )),
        );

        let frame_time = FrameTime { frame: 0 };

        let _ = block_on(evaluator.evaluate(
            &mut graph,
            &registry,
            &node_instances,
            source_id,
            "output",
            frame_time,
            &cm,
            None,
            &Format::hd(),
            &HashMap::new(),
        ));

        let key_hd = evaluator
            .compute_node_cache_key(&graph, &registry, source_id, frame_time, &Format::hd())
            .unwrap();
        let key_custom = evaluator
            .compute_node_cache_key(
                &graph,
                &registry,
                source_id,
                frame_time,
                &Format::from_dimensions(1280, 720),
            )
            .unwrap();

        assert_ne!(
            key_hd, key_custom,
            "Cache key should differ for different project formats"
        );
        assert_ne!(
            key_hd.project_format_hash, key_custom.project_format_hash,
            "project_format_hash should differ"
        );
    }
}
