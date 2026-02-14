use crate::color::ColorManagement;
use crate::error::CompositorError;
use crate::graph::{Graph, NodeId};
use crate::node::{EvalContext, Node, NodeRegistry};
use crate::types::{FrameTime, ParamDefault, ParamValue, Value};
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
struct CacheKey {
    frame_time: FrameTime,
    param_revision: u64,
    upstream_hash: u64,
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
            let key = CacheKey {
                frame_time,
                param_revision: instance.param_revision,
                upstream_hash,
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
            for input in spec.inputs.iter() {
                if let Some((up_node, up_port)) = graph.get_upstream(node_id, &input.name) {
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
                }
            }

            let merged_params = Self::merge_params(instance, spec);
            let ctx = EvalContext {
                inputs,
                params: &merged_params,
                frame_time,
                color_management,
            };
            let start = Instant::now();
            let outputs = node.evaluate(&ctx).await?;
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
        for input in spec.inputs.iter() {
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
        for input in spec.inputs.iter() {
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

    fn merge_params(
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

    fn default_to_value(default: &ParamDefault) -> ParamValue {
        match default {
            ParamDefault::Float(v) => ParamValue::Float(*v),
            ParamDefault::Int(v) => ParamValue::Int(*v),
            ParamDefault::Bool(v) => ParamValue::Bool(*v),
            ParamDefault::Color(v) => ParamValue::Color(*v),
            ParamDefault::ColorRamp(v) => ParamValue::ColorRamp(v.clone()),
            ParamDefault::String(v) => ParamValue::String(v.clone()),
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

        fn evaluate<'a>(
            &'a self,
            _ctx: &'a EvalContext<'a>,
        ) -> NodeFuture<'a>
        {
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
        Image::from_f32_data(width, height, data)
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
                }],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Image,
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
                }],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Image,
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
        ));

        assert!(result.is_ok());
        let eval_result = result.unwrap();
        if let Value::Image(img) = eval_result.value {
            assert_eq!(img.width, 2);
            assert_eq!(img.height, 2);
        }
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
        ));
        assert!(result2.is_ok());

        let cache_size_frame_2 = evaluator.cache.len();
        assert!(cache_size_frame_2 >= cache_size_frame_1);
    }
}
