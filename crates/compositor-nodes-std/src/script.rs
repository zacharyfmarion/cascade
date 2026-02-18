use compositor_core::error::CompositorError;
use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::*;
use std::any::Any;

pub struct GpuScriptDraftNode {
    spec: NodeSpec,
}

impl GpuScriptDraftNode {
    pub fn new(type_id: &str) -> Self {
        Self {
            spec: NodeSpec {
                id: type_id.to_string(),
                display_name: "GPU Script".to_string(),
                category: "GPU".to_string(),
                description: "Custom GPU shader node. Write GLSL and compile to run.".to_string(),
                inputs: vec![PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                }],
                outputs: vec![PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                }],
                params: vec![],
            },
        }
    }

    pub fn with_spec(spec: NodeSpec) -> Self {
        Self { spec }
    }
}

impl Node for GpuScriptDraftNode {
    fn spec(&self) -> NodeSpec {
        self.spec.clone()
    }

    fn evaluate<'a>(
        &'a self,
        _ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a>
    {
        Box::pin(async move {
            Err(CompositorError::Other(
                "GPU Script not compiled yet. Write GLSL code and click Compile.".to_string(),
            ))
        })
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}
