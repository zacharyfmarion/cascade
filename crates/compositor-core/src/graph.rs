use crate::error::CompositorError;
use crate::node::NodeRegistry;
use crate::types::{ParamValue, ValueType};
use slotmap::{new_key_type, SlotMap};
use std::collections::{HashMap, HashSet};

new_key_type! {
    pub struct NodeId;
}

#[derive(Clone)]
pub struct NodeInstance {
    pub id: NodeId,
    pub uuid: String,
    pub type_id: String,
    pub params: HashMap<String, ParamValue>,
    pub position: (f64, f64),
    pub param_revision: u64,
}

#[derive(Clone)]
pub struct Connection {
    pub from_node: NodeId,
    pub from_port: String,
    pub to_node: NodeId,
    pub to_port: String,
}

#[derive(Clone)]
pub struct Graph {
    pub nodes: SlotMap<NodeId, NodeInstance>,
    inputs: HashMap<(NodeId, String), (NodeId, String)>,
    outputs: HashMap<NodeId, Vec<Connection>>,
    dirty_nodes: HashSet<NodeId>,
}

pub fn types_compatible(from: &ValueType, to: &ValueType) -> bool {
    from == to || (*from == ValueType::Field && *to == ValueType::Image)
}

impl Graph {
    pub fn new() -> Self {
        Self {
            nodes: SlotMap::with_key(),
            inputs: HashMap::new(),
            outputs: HashMap::new(),
            dirty_nodes: HashSet::new(),
        }
    }

    pub fn add_node(&mut self, type_id: &str) -> NodeId {
        let id = self.nodes.insert_with_key(|key| NodeInstance {
            id: key,
            uuid: uuid::Uuid::new_v4().to_string(),
            type_id: type_id.to_string(),
            params: HashMap::new(),
            position: (0.0, 0.0),
            param_revision: 0,
        });
        self.dirty_nodes.insert(id);
        id
    }

    pub fn remove_node(&mut self, node_id: NodeId) {
        self.nodes.remove(node_id);
        self.inputs
            .retain(|(to_node, _), (from_node, _)| *to_node != node_id && *from_node != node_id);
        self.outputs.remove(&node_id);
        for conns in self.outputs.values_mut() {
            conns.retain(|c| c.to_node != node_id);
        }
        self.outputs.retain(|_, conns| !conns.is_empty());
        self.dirty_nodes.remove(&node_id);
    }

    pub fn prune_connections_for_node(&mut self, node_id: NodeId, registry: &NodeRegistry) {
        let node = match self.nodes.get(node_id) {
            Some(n) => n,
            None => return,
        };
        let spec = match registry.get_spec(&node.type_id) {
            Some(s) => s.clone(),
            None => return,
        };

        let input_names: HashSet<&str> = spec.inputs.iter().map(|p| p.name.as_str()).collect();
        let output_names: HashSet<&str> = spec.outputs.iter().map(|p| p.name.as_str()).collect();

        self.retain_connections(|c| {
            if c.to_node == node_id && !input_names.contains(c.to_port.as_str()) {
                return false;
            }
            if c.from_node == node_id && !output_names.contains(c.from_port.as_str()) {
                return false;
            }
            true
        });
    }

    pub fn connect(
        &mut self,
        registry: &NodeRegistry,
        from_node: NodeId,
        from_port: &str,
        to_node: NodeId,
        to_port: &str,
    ) -> Result<(), CompositorError> {
        let from_instance = self
            .nodes
            .get(from_node)
            .ok_or(CompositorError::NodeNotFound(from_node))?;
        let to_instance = self
            .nodes
            .get(to_node)
            .ok_or(CompositorError::NodeNotFound(to_node))?;

        let from_spec = registry.get_spec(&from_instance.type_id).ok_or_else(|| {
            CompositorError::InvalidConnection(format!(
                "Unknown node type: {}",
                from_instance.type_id
            ))
        })?;
        let to_spec = registry.get_spec(&to_instance.type_id).ok_or_else(|| {
            CompositorError::InvalidConnection(format!(
                "Unknown node type: {}",
                to_instance.type_id
            ))
        })?;

        let from_port_spec = from_spec
            .outputs
            .iter()
            .find(|p| p.name == from_port)
            .ok_or_else(|| CompositorError::PortNotFound {
                node_type: from_instance.type_id.clone(),
                port_name: from_port.to_string(),
            })?;
        let to_port_spec = to_spec
            .inputs
            .iter()
            .find(|p| p.name == to_port)
            .ok_or_else(|| CompositorError::PortNotFound {
                node_type: to_instance.type_id.clone(),
                port_name: to_port.to_string(),
            })?;

        if !types_compatible(&from_port_spec.ty, &to_port_spec.ty) {
            return Err(CompositorError::TypeMismatch {
                expected: format!("{:?}", to_port_spec.ty),
                got: format!("{:?}", from_port_spec.ty),
            });
        }

        let new_connection = Connection {
            from_node,
            from_port: from_port.to_string(),
            to_node,
            to_port: to_port.to_string(),
        };

        if from_node == to_node || self.has_path(to_node, from_node, Some(&new_connection)) {
            return Err(CompositorError::CycleDetected);
        }

        let to_port_string = to_port.to_string();
        let to_key = (to_node, to_port_string.clone());
        if let Some((prev_from_node, prev_from_port)) = self.inputs.remove(&to_key) {
            if let Some(conns) = self.outputs.get_mut(&prev_from_node) {
                conns.retain(|c| {
                    !(c.to_node == to_node
                        && c.to_port == to_port
                        && c.from_port == prev_from_port)
                });
                if conns.is_empty() {
                    self.outputs.remove(&prev_from_node);
                }
            }
        }

        self.inputs
            .insert((to_node, to_port_string), (from_node, from_port.to_string()));
        self.outputs
            .entry(from_node)
            .or_default()
            .push(new_connection);
        self.mark_dirty(to_node);
        Ok(())
    }

    pub fn disconnect(&mut self, to_node: NodeId, to_port: &str) {
        let to_key = (to_node, to_port.to_string());
        if let Some((from_node, from_port)) = self.inputs.remove(&to_key) {
            if let Some(conns) = self.outputs.get_mut(&from_node) {
                conns.retain(|c| {
                    !(c.to_node == to_node && c.to_port == to_port && c.from_port == from_port)
                });
                if conns.is_empty() {
                    self.outputs.remove(&from_node);
                }
            }
        }
        self.mark_dirty(to_node);
    }

    pub fn set_param(&mut self, node_id: NodeId, key: &str, value: ParamValue) {
        if let Some(node) = self.nodes.get_mut(node_id) {
            node.params.insert(key.to_string(), value);
            node.param_revision = node.param_revision.saturating_add(1);
            self.mark_dirty(node_id);
        }
    }

    pub fn set_position(&mut self, node_id: NodeId, x: f64, y: f64) {
        if let Some(node) = self.nodes.get_mut(node_id) {
            node.position = (x, y);
        }
    }

    pub fn get_upstream(&self, node_id: NodeId, input_port: &str) -> Option<(NodeId, String)> {
        let key = (node_id, input_port.to_string());
        self.inputs
            .get(&key)
            .map(|(from_node, from_port)| (*from_node, from_port.clone()))
    }

    pub fn mark_dirty(&mut self, node_id: NodeId) {
        let downstream = self.get_downstream(node_id);
        self.dirty_nodes.insert(node_id);
        for node in downstream {
            self.dirty_nodes.insert(node);
        }
    }

    pub fn is_dirty(&self, node_id: NodeId) -> bool {
        self.dirty_nodes.contains(&node_id)
    }

    pub fn clear_dirty(&mut self, node_id: NodeId) {
        self.dirty_nodes.remove(&node_id);
    }

    pub fn get_downstream(&self, node_id: NodeId) -> Vec<NodeId> {
        let mut visited = HashSet::new();
        let mut queue = std::collections::VecDeque::new();
        let mut out = Vec::new();
        queue.push_back(node_id);
        while let Some(current) = queue.pop_front() {
            if let Some(conns) = self.outputs.get(&current) {
                for connection in conns {
                    if visited.insert(connection.to_node) {
                        out.push(connection.to_node);
                        queue.push_back(connection.to_node);
                    }
                }
            }
        }
        out
    }

    fn has_path(&self, start: NodeId, target: NodeId, extra: Option<&Connection>) -> bool {
        let mut visited = HashSet::new();
        let mut stack = vec![start];
        while let Some(current) = stack.pop() {
            if current == target {
                return true;
            }
            if !visited.insert(current) {
                continue;
            }
            if let Some(conns) = self.outputs.get(&current) {
                for connection in conns {
                    stack.push(connection.to_node);
                }
            }
            if let Some(extra_conn) = extra {
                if extra_conn.from_node == current {
                    stack.push(extra_conn.to_node);
                }
            }
        }
        false
    }

    pub fn connections(&self) -> impl Iterator<Item = &Connection> + '_ {
        self.outputs.values().flat_map(|conns| conns.iter())
    }

    pub fn connections_from(&self, node_id: NodeId) -> &[Connection] {
        self.outputs
            .get(&node_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    pub fn connections_to(&self, node_id: NodeId) -> impl Iterator<Item = Connection> + '_ {
        self.inputs
            .iter()
            .filter(move |((to_node, _), _)| *to_node == node_id)
            .map(|((to_node, to_port), (from_node, from_port))| Connection {
                from_node: *from_node,
                from_port: from_port.clone(),
                to_node: *to_node,
                to_port: to_port.clone(),
            })
    }

    pub fn connection_count(&self) -> usize {
        self.inputs.len()
    }

    pub fn retain_connections<F>(&mut self, predicate: F)
    where
        F: Fn(&Connection) -> bool,
    {
        self.inputs
            .retain(|(to_node, to_port), (from_node, from_port)| {
                predicate(&Connection {
                    from_node: *from_node,
                    from_port: from_port.clone(),
                    to_node: *to_node,
                    to_port: to_port.clone(),
                })
            });

        for conns in self.outputs.values_mut() {
            conns.retain(|c| predicate(c));
        }
        self.outputs.retain(|_, v| !v.is_empty());
    }
}

impl Default for Graph {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::{EvalContext, Node, NodeRegistry};
    use crate::types::{
        NodeSpec, ParamDefault, ParamSpec, ParamValue, PortSpec, UiHint, Value, ValueType,
    };
    use std::any::Any;
    use std::collections::HashMap;
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::Arc;

    fn create_test_registry() -> NodeRegistry {
        let mut registry = NodeRegistry::new();
        registry.register("input", || {
            let spec = NodeSpec {
                id: "input".to_string(),
                display_name: "Input".to_string(),
                category: "Input".to_string(),
                description: "Test input".to_string(),
                inputs: vec![],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Float,
                }],
                params: vec![],
            };
            Arc::new(TestNode { spec })
        });
        registry.register("process", || {
            let spec = NodeSpec {
                id: "process".to_string(),
                display_name: "Process".to_string(),
                category: "Processing".to_string(),
                description: "Test processor".to_string(),
                inputs: vec![PortSpec {
                    name: "input".to_string(),
                    label: "Input".to_string(),
                    ty: ValueType::Float,
                }],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Float,
                }],
                params: vec![ParamSpec {
                    key: "factor".to_string(),
                    label: "Factor".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(10.0),
                    step: Some(0.1),
                    ui_hint: UiHint::Slider,
                }],
            };
            Arc::new(TestNode { spec })
        });
        registry.register("output", || {
            let spec = NodeSpec {
                id: "output".to_string(),
                display_name: "Output".to_string(),
                category: "Output".to_string(),
                description: "Test output".to_string(),
                inputs: vec![PortSpec {
                    name: "input".to_string(),
                    label: "Input".to_string(),
                    ty: ValueType::Float,
                }],
                outputs: vec![],
                params: vec![],
            };
            Arc::new(TestNode { spec })
        });
        registry
    }

    struct TestNode {
        spec: NodeSpec,
    }

    impl Node for TestNode {
        fn spec(&self) -> NodeSpec {
            self.spec.clone()
        }

        fn evaluate<'a>(
            &'a self,
            _ctx: &'a EvalContext<'a>,
        ) -> Pin<
            Box<dyn Future<Output = Result<HashMap<String, Value>, CompositorError>> + Send + 'a>,
        > {
            Box::pin(async move { Ok(HashMap::new()) })
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    #[test]
    fn test_add_node() {
        let mut graph = Graph::new();
        let node_id = graph.add_node("input");
        assert!(graph.nodes.contains_key(node_id));
        assert_eq!(graph.nodes.get(node_id).unwrap().type_id, "input");
        assert!(graph.is_dirty(node_id));
    }

    #[test]
    fn test_remove_node() {
        let mut graph = Graph::new();
        let node_id = graph.add_node("input");
        assert!(graph.nodes.contains_key(node_id));
        graph.remove_node(node_id);
        assert!(!graph.nodes.contains_key(node_id));
    }

    #[test]
    fn test_connect_valid() {
        let mut graph = Graph::new();
        let registry = create_test_registry();

        let input_id = graph.add_node("input");
        let process_id = graph.add_node("process");

        let result = graph.connect(&registry, input_id, "output", process_id, "input");
        assert!(result.is_ok());
        assert_eq!(graph.connection_count(), 1);
    }

    #[test]
    fn test_connect_invalid_port() {
        let mut graph = Graph::new();
        let registry = create_test_registry();

        let input_id = graph.add_node("input");
        let process_id = graph.add_node("process");

        let result = graph.connect(&registry, input_id, "nonexistent", process_id, "input");
        assert!(matches!(result, Err(CompositorError::PortNotFound { .. })));
    }

    #[test]
    fn test_connect_type_mismatch() {
        let mut graph = Graph::new();
        let mut registry = create_test_registry();

        registry.register("image_output", || {
            let spec = NodeSpec {
                id: "image_output".to_string(),
                display_name: "Image Output".to_string(),
                category: "Input".to_string(),
                description: "Test image output".to_string(),
                inputs: vec![],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Image,
                }],
                params: vec![],
            };
            Arc::new(TestNode { spec })
        });

        let image_out_id = graph.add_node("image_output");
        let process_id = graph.add_node("process");

        let result = graph.connect(&registry, image_out_id, "output", process_id, "input");
        assert!(matches!(result, Err(CompositorError::TypeMismatch { .. })));
    }

    #[test]
    fn test_cycle_detection_self_loop() {
        let mut graph = Graph::new();
        let registry = create_test_registry();

        let process_id = graph.add_node("process");

        let result = graph.connect(&registry, process_id, "output", process_id, "input");
        assert!(matches!(result, Err(CompositorError::CycleDetected)));
    }

    #[test]
    fn test_cycle_detection_simple() {
        let mut graph = Graph::new();
        let registry = create_test_registry();

        let process1 = graph.add_node("process");
        let process2 = graph.add_node("process");

        assert!(graph
            .connect(&registry, process1, "output", process2, "input")
            .is_ok());

        let result = graph.connect(&registry, process2, "output", process1, "input");
        assert!(matches!(result, Err(CompositorError::CycleDetected)));
    }

    #[test]
    fn test_disconnect() {
        let mut graph = Graph::new();
        let registry = create_test_registry();

        let input_id = graph.add_node("input");
        let process_id = graph.add_node("process");

        graph
            .connect(&registry, input_id, "output", process_id, "input")
            .unwrap();
        assert_eq!(graph.connection_count(), 1);

        graph.disconnect(process_id, "input");
        assert_eq!(graph.connection_count(), 0);
    }

    #[test]
    fn test_set_param() {
        let mut graph = Graph::new();
        let node_id = graph.add_node("process");

        let initial_revision = graph.nodes.get(node_id).unwrap().param_revision;
        graph.set_param(node_id, "factor", ParamValue::Float(2.5));

        let node = graph.nodes.get(node_id).unwrap();
        assert_eq!(node.params.get("factor"), Some(&ParamValue::Float(2.5)));
        assert_eq!(node.param_revision, initial_revision + 1);
    }

    #[test]
    fn test_set_position() {
        let mut graph = Graph::new();
        let node_id = graph.add_node("input");

        graph.set_position(node_id, 10.5, 20.3);

        let node = graph.nodes.get(node_id).unwrap();
        assert_eq!(node.position, (10.5, 20.3));
    }

    #[test]
    fn test_dirty_propagation_on_param_change() {
        let mut graph = Graph::new();
        let registry = create_test_registry();

        let input_id = graph.add_node("input");
        let process_id = graph.add_node("process");
        let output_id = graph.add_node("output");

        graph
            .connect(&registry, input_id, "output", process_id, "input")
            .unwrap();
        graph
            .connect(&registry, process_id, "output", output_id, "input")
            .unwrap();

        graph.clear_dirty(input_id);
        graph.clear_dirty(process_id);
        graph.clear_dirty(output_id);

        graph.set_param(input_id, "factor", ParamValue::Float(1.5));

        assert!(graph.is_dirty(input_id));
        assert!(graph.is_dirty(process_id));
        assert!(graph.is_dirty(output_id));
    }

    #[test]
    fn test_dirty_propagation_on_disconnect() {
        let mut graph = Graph::new();
        let registry = create_test_registry();

        let input_id = graph.add_node("input");
        let process_id = graph.add_node("process");

        graph
            .connect(&registry, input_id, "output", process_id, "input")
            .unwrap();

        graph.clear_dirty(input_id);
        graph.clear_dirty(process_id);

        graph.disconnect(process_id, "input");

        assert!(graph.is_dirty(process_id));
    }

    #[test]
    fn test_get_upstream() {
        let mut graph = Graph::new();
        let registry = create_test_registry();

        let input_id = graph.add_node("input");
        let process_id = graph.add_node("process");

        graph
            .connect(&registry, input_id, "output", process_id, "input")
            .unwrap();

        let upstream = graph.get_upstream(process_id, "input");
        assert_eq!(upstream, Some((input_id, "output".to_string())));
    }

    #[test]
    fn test_get_downstream() {
        let mut graph = Graph::new();
        let registry = create_test_registry();

        let input_id = graph.add_node("input");
        let process1_id = graph.add_node("process");
        let process2_id = graph.add_node("process");
        let output_id = graph.add_node("output");

        graph
            .connect(&registry, input_id, "output", process1_id, "input")
            .unwrap();
        graph
            .connect(&registry, process1_id, "output", process2_id, "input")
            .unwrap();
        graph
            .connect(&registry, process2_id, "output", output_id, "input")
            .unwrap();

        let downstream = graph.get_downstream(input_id);
        assert!(downstream.contains(&process1_id));
        assert!(downstream.contains(&process2_id));
        assert!(downstream.contains(&output_id));
    }

    #[test]
    fn test_remove_node_disconnects_connections() {
        let mut graph = Graph::new();
        let registry = create_test_registry();

        let input_id = graph.add_node("input");
        let process_id = graph.add_node("process");
        let output_id = graph.add_node("output");

        graph
            .connect(&registry, input_id, "output", process_id, "input")
            .unwrap();
        graph
            .connect(&registry, process_id, "output", output_id, "input")
            .unwrap();

        assert_eq!(graph.connection_count(), 2);

        graph.remove_node(process_id);

        assert_eq!(graph.connection_count(), 0);
    }

    #[test]
    fn test_param_revision_increment() {
        let mut graph = Graph::new();
        let node_id = graph.add_node("process");

        let node = graph.nodes.get(node_id).unwrap();
        let revision = node.param_revision;

        graph.set_param(node_id, "factor", ParamValue::Float(1.0));
        let node = graph.nodes.get(node_id).unwrap();
        assert_eq!(node.param_revision, revision + 1);

        graph.set_param(node_id, "factor", ParamValue::Float(2.0));
        let node = graph.nodes.get(node_id).unwrap();
        assert_eq!(node.param_revision, revision + 2);
    }

    #[test]
    fn test_clear_dirty() {
        let mut graph = Graph::new();
        let node_id = graph.add_node("input");

        assert!(graph.is_dirty(node_id));
        graph.clear_dirty(node_id);
        assert!(!graph.is_dirty(node_id));
    }
}
