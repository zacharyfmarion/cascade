use compositor_core::color::BuiltinColorManagement;
use compositor_core::eval::Evaluator;
use compositor_core::graph::Graph;
use compositor_core::node::{EvalContext, Node, NodeRegistry};
use compositor_core::types::{
    Format, FrameTime, ParamDefault, ParamSpec, ParamValue, PortSpec, UiHint, Value, ValueType,
};
use compositor_nodes_std::{register_standard_nodes, BrightnessContrast, LoadImage, Viewer};
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
    let bc_id = graph.add_node("brightness_contrast");
    let viewer_id = graph.add_node("viewer");

    graph
        .connect(&registry, load_id, "image", bc_id, "image")
        .unwrap();
    graph
        .connect(&registry, bc_id, "image", viewer_id, "image")
        .unwrap();

    let mut nodes: HashMap<_, Arc<dyn Node>> = HashMap::new();
    let load = LoadImage::new();
    let png_bytes = make_png_bytes();
    load.set_image_data(&png_bytes).unwrap();
    nodes.insert(load_id, Arc::new(load));
    nodes.insert(bc_id, Arc::new(BrightnessContrast::new()));
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
        .connect(&registry, load_id, "image", viewer_id, "image")
        .unwrap();

    graph.set_param(load_id, "image_data", ParamValue::String("x".to_string()));
    assert!(graph.is_dirty(load_id));
    assert!(graph.is_dirty(viewer_id));
}

struct CounterNode {
    count: Mutex<u32>,
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
    fn spec(&self) -> compositor_core::types::NodeSpec {
        compositor_core::types::NodeSpec {
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
            dyn Future<
                    Output = Result<
                        HashMap<String, Value>,
                        compositor_core::error::CompositorError,
                    >,
                > + Send
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
