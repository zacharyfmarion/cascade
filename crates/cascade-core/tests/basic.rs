use cascade_core::color::BuiltinColorManagement;
use cascade_core::error::CascadeError;
use cascade_core::eval::Evaluator;
use cascade_core::graph::{Graph, NodeId};
use cascade_core::node::{EvalContext, Node, NodeRegistry};
use cascade_core::types::{
    Format, FrameTime, Image, NodeSpec, ParamDefault, ParamSpec, ParamValue, PortSpec, UiHint,
    Value, ValueType,
};
use cascade_nodes_std::{
    register_standard_nodes, FrameBlend, FrameHold, GaussianBlur, LoadImage, TimeOffset, Viewer,
};
use image::codecs::png::PngEncoder;
use image::ColorType;
use image::ImageEncoder;
use pollster::block_on;
use std::any::Any;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

#[test]
fn graph_connects_and_evaluates_chain() {
    let mut registry = NodeRegistry::new();
    register_standard_nodes(&mut registry);

    let mut graph = Graph::new();
    let load_id = graph.add_node("load_image");
    let bc_id = graph.add_node("gaussian_blur");
    let viewer_id = graph.add_node("viewer");

    graph
        .connect(&registry, load_id, "image", bc_id, "image")
        .unwrap();
    graph
        .connect(&registry, bc_id, "image", viewer_id, "value")
        .unwrap();

    let mut nodes: HashMap<_, Arc<dyn Node>> = HashMap::new();
    let load = LoadImage::new();
    let png_bytes = make_png_bytes();
    load.set_image_data(&png_bytes).unwrap();
    nodes.insert(load_id, Arc::new(load));
    nodes.insert(bc_id, Arc::new(GaussianBlur::new()));
    nodes.insert(viewer_id, Arc::new(Viewer::new()));

    let mut evaluator = Evaluator::new();
    let cm = BuiltinColorManagement::new();
    let eval_result = block_on(evaluator.evaluate(
        &mut graph,
        &registry,
        &nodes,
        viewer_id,
        "display",
        FrameTime { frame: 0 },
        &cm,
        None,
        &Format::hd(),
        &HashMap::new(),
        1.0,
    ))
    .unwrap();
    match eval_result.value {
        Value::Image(image) => {
            assert_eq!(image.width, 1);
            assert_eq!(image.height, 1);
        }
        _ => panic!("Expected image"),
    }
}

#[test]
fn cache_hit_skips_evaluation() {
    let mut registry = NodeRegistry::new();
    registry.register("counter", || Arc::new(CounterNode::new()));

    let mut graph = Graph::new();
    let node_id = graph.add_node("counter");

    let mut nodes: HashMap<_, Arc<dyn Node>> = HashMap::new();
    nodes.insert(node_id, Arc::new(CounterNode::new()));

    let mut evaluator = Evaluator::new();
    let cm = BuiltinColorManagement::new();
    block_on(evaluator.evaluate(
        &mut graph,
        &registry,
        &nodes,
        node_id,
        "value",
        FrameTime { frame: 0 },
        &cm,
        None,
        &Format::hd(),
        &HashMap::new(),
        1.0,
    ))
    .unwrap();
    block_on(evaluator.evaluate(
        &mut graph,
        &registry,
        &nodes,
        node_id,
        "value",
        FrameTime { frame: 0 },
        &cm,
        None,
        &Format::hd(),
        &HashMap::new(),
        1.0,
    ))
    .unwrap();

    let counter = nodes
        .get(&node_id)
        .unwrap()
        .as_any()
        .downcast_ref::<CounterNode>()
        .unwrap();
    assert_eq!(counter.count(), 1);
}

#[test]
fn dirty_propagates_downstream() {
    let mut registry = NodeRegistry::new();
    register_standard_nodes(&mut registry);

    let mut graph = Graph::new();
    let load_id = graph.add_node("load_image");
    let viewer_id = graph.add_node("viewer");
    graph
        .connect(&registry, load_id, "image", viewer_id, "value")
        .unwrap();

    graph.set_param(load_id, "image_data", ParamValue::String("x".to_string()));
    assert!(graph.is_dirty(load_id));
    assert!(graph.is_dirty(viewer_id));
}

#[test]
fn test_time_offset_pipeline() {
    let mut registry = NodeRegistry::new();
    register_standard_nodes(&mut registry);
    registry.register("frame_source", || Arc::new(FrameAwareSource::new()));

    let mut graph = Graph::new();
    let source_id = graph.add_node("frame_source");
    let offset_id = graph.add_node("time_offset");
    let viewer_id = graph.add_node("viewer");

    graph
        .connect(&registry, source_id, "output", offset_id, "input")
        .unwrap();
    graph
        .connect(&registry, offset_id, "output", viewer_id, "value")
        .unwrap();
    graph.set_param(offset_id, "offset", ParamValue::Int(3));

    let mut nodes: HashMap<_, Arc<dyn Node>> = HashMap::new();
    nodes.insert(source_id, Arc::new(FrameAwareSource::new()));
    nodes.insert(offset_id, Arc::new(TimeOffset::new()));
    nodes.insert(viewer_id, Arc::new(Viewer::new()));

    let mut evaluator = Evaluator::new();
    let cm = BuiltinColorManagement::new();
    let result = block_on(evaluator.evaluate(
        &mut graph,
        &registry,
        &nodes,
        viewer_id,
        "display",
        FrameTime { frame: 10 },
        &cm,
        None,
        &Format::hd(),
        &HashMap::new(),
        1.0,
    ))
    .unwrap();

    let image = match result.value {
        Value::Image(img) => img,
        _ => panic!("Expected image"),
    };
    let px = image.get_pixel_f32(0, 0);
    assert!((px[0] - 0.07).abs() < 0.001, "expected frame 7 red");
}

#[test]
fn test_frame_hold_pipeline() {
    let mut registry = NodeRegistry::new();
    register_standard_nodes(&mut registry);
    registry.register("frame_source", || Arc::new(FrameAwareSource::new()));

    let mut graph = Graph::new();
    let source_id = graph.add_node("frame_source");
    let hold_id = graph.add_node("frame_hold");
    let viewer_id = graph.add_node("viewer");

    graph
        .connect(&registry, source_id, "output", hold_id, "input")
        .unwrap();
    graph
        .connect(&registry, hold_id, "output", viewer_id, "value")
        .unwrap();
    graph.set_param(hold_id, "frame", ParamValue::Int(5));

    let mut nodes: HashMap<_, Arc<dyn Node>> = HashMap::new();
    nodes.insert(source_id, Arc::new(FrameAwareSource::new()));
    nodes.insert(hold_id, Arc::new(FrameHold::new()));
    nodes.insert(viewer_id, Arc::new(Viewer::new()));

    let mut evaluator = Evaluator::new();
    let cm = BuiltinColorManagement::new();
    let result = block_on(evaluator.evaluate(
        &mut graph,
        &registry,
        &nodes,
        viewer_id,
        "display",
        FrameTime { frame: 20 },
        &cm,
        None,
        &Format::hd(),
        &HashMap::new(),
        1.0,
    ))
    .unwrap();

    let image = match result.value {
        Value::Image(img) => img,
        _ => panic!("Expected image"),
    };
    let px = image.get_pixel_f32(0, 0);
    assert!((px[0] - 0.05).abs() < 0.001, "expected frame 5 red");
}

#[test]
fn test_frame_blend_pipeline() {
    let mut registry = NodeRegistry::new();
    register_standard_nodes(&mut registry);
    registry.register("frame_source", || Arc::new(FrameAwareSource::new()));

    let mut graph = Graph::new();
    let source_id = graph.add_node("frame_source");
    let blend_id = graph.add_node("frame_blend");
    let viewer_id = graph.add_node("viewer");

    graph
        .connect(&registry, source_id, "output", blend_id, "input")
        .unwrap();
    graph
        .connect(&registry, blend_id, "output", viewer_id, "value")
        .unwrap();
    graph.set_param(blend_id, "blend", ParamValue::Float(0.5));

    let mut nodes: HashMap<_, Arc<dyn Node>> = HashMap::new();
    nodes.insert(source_id, Arc::new(FrameAwareSource::new()));
    nodes.insert(blend_id, Arc::new(FrameBlend::new()));
    nodes.insert(viewer_id, Arc::new(Viewer::new()));

    let mut evaluator = Evaluator::new();
    let cm = BuiltinColorManagement::new();
    let result = block_on(evaluator.evaluate(
        &mut graph,
        &registry,
        &nodes,
        viewer_id,
        "display",
        FrameTime { frame: 10 },
        &cm,
        None,
        &Format::hd(),
        &HashMap::new(),
        1.0,
    ))
    .unwrap();

    let image = match result.value {
        Value::Image(img) => img,
        _ => panic!("Expected image"),
    };
    let px = image.get_pixel_f32(0, 0);
    assert!((px[0] - 0.105).abs() < 0.001, "expected blended red");
}

struct CounterNode {
    count: Mutex<u32>,
}

struct FrameAwareSource;

impl FrameAwareSource {
    fn new() -> Self {
        Self
    }
}

impl Node for FrameAwareSource {
    fn spec(&self) -> cascade_core::types::NodeSpec {
        cascade_core::types::NodeSpec {
            id: "frame_source".to_string(),
            display_name: "Frame Source".to_string(),
            category: "Input".to_string(),
            description: "Frame-aware test source".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "output".to_string(),
                label: "Output".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![],
        }
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<HashMap<String, Value>, cascade_core::error::CascadeError>>
                + Send
                + 'a,
        >,
    > {
        Box::pin(async move {
            let intensity = (ctx.frame_time.frame as f32) * 0.01;
            let data = vec![intensity, 0.0, 0.0, 1.0];
            let image = Image::from_f32_data(1, 1, data)?;
            let mut outputs = HashMap::new();
            outputs.insert("output".to_string(), Value::Image(image));
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

fn make_png_bytes() -> Vec<u8> {
    let mut data = Vec::new();
    let encoder = PngEncoder::new(&mut data);
    let rgba = [0u8, 0u8, 0u8, 255u8];
    encoder
        .write_image(&rgba, 1, 1, ColorType::Rgba8.into())
        .unwrap();
    data
}

impl CounterNode {
    fn new() -> Self {
        Self {
            count: Mutex::new(0),
        }
    }

    fn count(&self) -> u32 {
        *self.count.lock().unwrap()
    }
}

impl Node for CounterNode {
    fn spec(&self) -> cascade_core::types::NodeSpec {
        cascade_core::types::NodeSpec {
            id: "counter".to_string(),
            display_name: "Counter".to_string(),
            category: "Test".to_string(),
            description: "Counter".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "value".to_string(),
                label: "Value".to_string(),
                ty: ValueType::Float,
                ..Default::default()
            }],
            params: vec![ParamSpec {
                key: "value".to_string(),
                label: "Value".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(1.0),
                min: None,
                max: None,
                step: None,
                ui_hint: UiHint::NumberInput,
                promotable: true,
            }],
        }
    }

    fn evaluate<'a>(
        &'a self,
        _ctx: &'a EvalContext<'a>,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<HashMap<String, Value>, cascade_core::error::CascadeError>>
                + Send
                + 'a,
        >,
    > {
        Box::pin(async move {
            let mut guard = self.count.lock().unwrap();
            *guard += 1;
            let mut outputs = HashMap::new();
            outputs.insert("value".to_string(), Value::Float(1.0));
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

/// A test node with a promotable string param, simulating the AI Generate Image
/// node's `prompt` input. Records the prompt value it receives during evaluation.
struct PromotableStringNode {
    received_prompt: Arc<Mutex<String>>,
}

impl PromotableStringNode {
    fn new(received_prompt: Arc<Mutex<String>>) -> Self {
        Self { received_prompt }
    }
}

impl Node for PromotableStringNode {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "promotable_string_test".to_string(),
            display_name: "Promotable String Test".to_string(),
            category: "Test".to_string(),
            description: "".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                default: None,
                min: None,
                max: None,
                step: None,
                ui_hint: None,
            }],
            params: vec![ParamSpec {
                key: "prompt".to_string(),
                label: "Prompt".to_string(),
                ty: ValueType::String,
                default: ParamDefault::String("".to_string()),
                ui_hint: UiHint::TextArea,
                min: None,
                max: None,
                step: None,
                promotable: true,
            }],
        }
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<HashMap<String, Value>, CascadeError>> + Send + 'a>>
    {
        Box::pin(async move {
            let prompt = ctx.get_param_string("prompt").unwrap_or("").to_string();
            *self.received_prompt.lock().unwrap() = prompt;
            let mut outputs = HashMap::new();
            outputs.insert("image".to_string(), Value::None);
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

#[test]
fn promoted_string_param_receives_connected_text_value() {
    let mut registry = NodeRegistry::new();
    register_standard_nodes(&mut registry);

    let received_prompt = Arc::new(Mutex::new(String::new()));
    let _test_node = PromotableStringNode::new(received_prompt.clone());
    let received_1 = received_prompt.clone();
    registry.register("promotable_string_test", move || {
        Arc::new(PromotableStringNode::new(received_1.clone())) as Arc<dyn Node>
    });

    let mut graph = Graph::new();
    let text_id = graph.add_node("text_area");
    let consumer_id = graph.add_node("promotable_string_test");
    let viewer_id = graph.add_node("viewer");

    // Set the text value
    graph.nodes.get_mut(text_id).unwrap().params.insert(
        "text".to_string(),
        ParamValue::String("hello from text node".to_string()),
    );

    // Connect Text output → consumer's promoted "prompt" param
    graph
        .connect(&registry, text_id, "text", consumer_id, "prompt")
        .expect("connection text -> prompt should succeed");

    // Connect consumer output → viewer input
    graph
        .connect(&registry, consumer_id, "image", viewer_id, "value")
        .expect("connection consumer -> viewer should succeed");

    let mut nodes: HashMap<NodeId, Arc<dyn Node>> = HashMap::new();
    for (nid, inst) in graph.nodes.iter() {
        if inst.type_id == "promotable_string_test" {
            nodes.insert(
                nid,
                Arc::new(PromotableStringNode::new(received_prompt.clone())),
            );
        } else {
            nodes.insert(nid, registry.create(&inst.type_id).unwrap());
        }
    }

    let mut evaluator = Evaluator::new();
    let cm = BuiltinColorManagement::new();
    let pf = Format::default();
    let ai_cache: HashMap<NodeId, HashMap<String, Value>> = HashMap::new();

    pollster::block_on(evaluator.evaluate(
        &mut graph,
        &registry,
        &nodes,
        viewer_id,
        "display",
        FrameTime { frame: 0 },
        &cm,
        None,
        &pf,
        &ai_cache,
        1.0,
    ))
    .expect("evaluation should succeed");

    let prompt = received_prompt.lock().unwrap().clone();
    assert_eq!(
        prompt, "hello from text node",
        "promoted string param should receive text node's output value"
    );
}

#[test]
fn evaluate_upstream_caches_upstream_outputs_for_target_node() {
    let mut registry = NodeRegistry::new();
    register_standard_nodes(&mut registry);

    let received_prompt = Arc::new(Mutex::new(String::new()));
    let _test_node = PromotableStringNode::new(received_prompt.clone());
    let received_1 = received_prompt.clone();
    registry.register("promotable_string_test", move || {
        Arc::new(PromotableStringNode::new(received_1.clone())) as Arc<dyn Node>
    });

    let mut graph = Graph::new();
    let text_id = graph.add_node("text_area");
    let consumer_id = graph.add_node("promotable_string_test");

    graph.nodes.get_mut(text_id).unwrap().params.insert(
        "text".to_string(),
        ParamValue::String("upstream cached value".to_string()),
    );

    // Connect Text output → consumer's promoted "prompt" param
    graph
        .connect(&registry, text_id, "text", consumer_id, "prompt")
        .expect("connection text -> prompt should succeed");

    let mut nodes: HashMap<NodeId, Arc<dyn Node>> = HashMap::new();
    for (nid, inst) in graph.nodes.iter() {
        if inst.type_id == "promotable_string_test" {
            nodes.insert(
                nid,
                Arc::new(PromotableStringNode::new(received_prompt.clone())),
            );
        } else {
            nodes.insert(nid, registry.create(&inst.type_id).unwrap());
        }
    }

    let mut evaluator = Evaluator::new();
    let cm = BuiltinColorManagement::new();
    let pf = Format::default();
    let ai_cache: HashMap<NodeId, HashMap<String, Value>> = HashMap::new();

    // Before evaluate_upstream, the cache should be empty
    assert!(
        evaluator.get_cached(text_id, "text").is_none(),
        "text node output should not be cached initially"
    );

    // evaluate_upstream should cache the text node's output without evaluating the consumer
    pollster::block_on(evaluator.evaluate_upstream(
        &mut graph,
        &registry,
        &nodes,
        consumer_id,
        FrameTime { frame: 0 },
        &cm,
        None,
        &pf,
        &ai_cache,
        1.0,
    ))
    .expect("evaluate_upstream should succeed");

    // After evaluate_upstream, the text node's output should be cached
    let cached = evaluator
        .get_cached(text_id, "text")
        .expect("text node output should be cached after evaluate_upstream");
    match cached {
        Value::String(s) => assert_eq!(s, "upstream cached value"),
        other => panic!("expected Value::String, got {:?}", other),
    }

    // The consumer (target) should NOT have been evaluated
    let prompt = received_prompt.lock().unwrap().clone();
    assert_eq!(
        prompt, "",
        "target node should not be evaluated by evaluate_upstream"
    );
}

#[test]
fn promoted_string_param_empty_when_not_connected() {
    let mut registry = NodeRegistry::new();
    register_standard_nodes(&mut registry);

    let received_prompt = Arc::new(Mutex::new(String::from("sentinel")));
    let _test_node = PromotableStringNode::new(received_prompt.clone());
    let received_1 = received_prompt.clone();
    registry.register("promotable_string_test", move || {
        Arc::new(PromotableStringNode::new(received_1.clone())) as Arc<dyn Node>
    });

    let mut graph = Graph::new();
    let consumer_id = graph.add_node("promotable_string_test");
    let viewer_id = graph.add_node("viewer");

    // No text node connected — prompt should fall back to default (empty string)
    graph
        .connect(&registry, consumer_id, "image", viewer_id, "value")
        .expect("connection consumer -> viewer should succeed");

    let mut nodes: HashMap<NodeId, Arc<dyn Node>> = HashMap::new();
    for (nid, inst) in graph.nodes.iter() {
        if inst.type_id == "promotable_string_test" {
            nodes.insert(
                nid,
                Arc::new(PromotableStringNode::new(received_prompt.clone())),
            );
        } else {
            nodes.insert(nid, registry.create(&inst.type_id).unwrap());
        }
    }

    let mut evaluator = Evaluator::new();
    let cm = BuiltinColorManagement::new();
    let pf = Format::default();
    let ai_cache: HashMap<NodeId, HashMap<String, Value>> = HashMap::new();

    pollster::block_on(evaluator.evaluate(
        &mut graph,
        &registry,
        &nodes,
        viewer_id,
        "display",
        FrameTime { frame: 0 },
        &cm,
        None,
        &pf,
        &ai_cache,
        1.0,
    ))
    .expect("evaluation should succeed");

    let prompt = received_prompt.lock().unwrap().clone();
    assert_eq!(
        prompt, "",
        "unconnected promoted string param should be empty (default)"
    );
}
