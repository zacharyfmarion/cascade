use crate::error::CascadeError;
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
    pub input_defaults: HashMap<String, ParamValue>,
    pub position: (f64, f64),
    pub param_revision: u64,
    pub muted: bool,
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
    from == to
        || *to == ValueType::Any
        || *from == ValueType::Any
        || (*from == ValueType::Field && (*to == ValueType::Image || *to == ValueType::Mask))
        || (*from == ValueType::Int && *to == ValueType::Float)
        || (*from == ValueType::Float && *to == ValueType::Int)
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
            input_defaults: HashMap::new(),
            position: (0.0, 0.0),
            param_revision: 0,
            muted: false,
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

        let all_inputs = spec.all_inputs();
        let input_names: HashSet<&str> = all_inputs.iter().map(|p| p.name.as_str()).collect();
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
    ) -> Result<(), CascadeError> {
        let from_instance = self
            .nodes
            .get(from_node)
            .ok_or(CascadeError::NodeNotFound(from_node))?;
        let to_instance = self
            .nodes
            .get(to_node)
            .ok_or(CascadeError::NodeNotFound(to_node))?;

        let from_spec = registry.get_spec(&from_instance.type_id).ok_or_else(|| {
            CascadeError::InvalidConnection(format!("Unknown node type: {}", from_instance.type_id))
        })?;
        let to_spec = registry.get_spec(&to_instance.type_id).ok_or_else(|| {
            CascadeError::InvalidConnection(format!("Unknown node type: {}", to_instance.type_id))
        })?;

        let from_port_spec = from_spec
            .outputs
            .iter()
            .find(|p| p.name == from_port)
            .ok_or_else(|| CascadeError::PortNotFound {
                node_type: from_instance.type_id.clone(),
                port_name: from_port.to_string(),
            })?;
        let to_all_inputs = to_spec.all_inputs();
        let to_port_spec = to_all_inputs
            .iter()
            .find(|p| p.name == to_port)
            .ok_or_else(|| CascadeError::PortNotFound {
                node_type: to_instance.type_id.clone(),
                port_name: to_port.to_string(),
            })?;

        if !types_compatible(&from_port_spec.ty, &to_port_spec.ty) {
            return Err(CascadeError::TypeMismatch {
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
            return Err(CascadeError::CycleDetected);
        }

        let to_port_string = to_port.to_string();
        let to_key = (to_node, to_port_string.clone());
        if let Some((prev_from_node, prev_from_port)) = self.inputs.remove(&to_key) {
            if let Some(conns) = self.outputs.get_mut(&prev_from_node) {
                conns.retain(|c| {
                    !(c.to_node == to_node && c.to_port == to_port && c.from_port == prev_from_port)
                });
                if conns.is_empty() {
                    self.outputs.remove(&prev_from_node);
                }
            }
        }

        self.inputs.insert(
            (to_node, to_port_string),
            (from_node, from_port.to_string()),
        );
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

    pub fn set_input_default(&mut self, node_id: NodeId, port_name: &str, value: ParamValue) {
        if let Some(node) = self.nodes.get_mut(node_id) {
            node.input_defaults.insert(port_name.to_string(), value);
            node.param_revision = node.param_revision.saturating_add(1);
            self.mark_dirty(node_id);
        }
    }

    pub fn set_position(&mut self, node_id: NodeId, x: f64, y: f64) {
        if let Some(node) = self.nodes.get_mut(node_id) {
            node.position = (x, y);
        }
    }

    pub fn set_muted(&mut self, node_id: NodeId, muted: bool) {
        if let Some(node) = self.nodes.get_mut(node_id) {
            node.muted = muted;
            self.mark_dirty(node_id);
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

    /// Node type IDs that act as output/viewer nodes for selective invalidation.
    pub const VIEWER_TYPE_IDS: &'static [&'static str] = &[
        "viewer",
        "export_image",
        "export_image_sequence",
        "export_video",
        "export_image_batch",
    ];

    /// Returns all viewer/output nodes downstream of `changed_node_id`.
    /// If `changed_node_id` is itself a viewer, it is included.
    /// Returns an empty Vec if the node doesn't exist or has no downstream viewers.
    pub fn get_affected_viewers(&self, changed_node_id: NodeId) -> Vec<NodeId> {
        // Check if the changed node itself is a viewer
        let mut viewers = Vec::new();
        if let Some(instance) = self.nodes.get(changed_node_id) {
            if Self::VIEWER_TYPE_IDS.contains(&instance.type_id.as_str()) {
                viewers.push(changed_node_id);
            }
        } else {
            return viewers; // Node doesn't exist
        }

        // Check all downstream nodes
        for downstream_id in self.get_downstream(changed_node_id) {
            if let Some(instance) = self.nodes.get(downstream_id) {
                if Self::VIEWER_TYPE_IDS.contains(&instance.type_id.as_str()) {
                    viewers.push(downstream_id);
                }
            }
        }

        viewers
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
                    ..Default::default()
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
                    ..Default::default()
                }],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Float,
                    ..Default::default()
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
                    promotable: true,
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
                    ..Default::default()
                }],
                outputs: vec![],
                params: vec![],
            };
            Arc::new(TestNode { spec })
        });
        registry.register("viewer", || {
            let spec = NodeSpec {
                id: "viewer".to_string(),
                display_name: "Viewer".to_string(),
                category: "Output".to_string(),
                description: "Test viewer".to_string(),
                inputs: vec![PortSpec {
                    name: "input".to_string(),
                    label: "Input".to_string(),
                    ty: ValueType::Float,
                    ..Default::default()
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
        ) -> Pin<Box<dyn Future<Output = Result<HashMap<String, Value>, CascadeError>> + Send + 'a>>
        {
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
        assert!(matches!(result, Err(CascadeError::PortNotFound { .. })));
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
                    ..Default::default()
                }],
                params: vec![],
            };
            Arc::new(TestNode { spec })
        });

        let image_out_id = graph.add_node("image_output");
        let process_id = graph.add_node("process");

        let result = graph.connect(&registry, image_out_id, "output", process_id, "input");
        assert!(matches!(result, Err(CascadeError::TypeMismatch { .. })));
    }

    #[test]
    fn test_cycle_detection_self_loop() {
        let mut graph = Graph::new();
        let registry = create_test_registry();

        let process_id = graph.add_node("process");

        let result = graph.connect(&registry, process_id, "output", process_id, "input");
        assert!(matches!(result, Err(CascadeError::CycleDetected)));
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
        assert!(matches!(result, Err(CascadeError::CycleDetected)));
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

    #[test]
    fn test_connect_int_to_float_succeeds() {
        let mut graph = Graph::new();
        let mut registry = create_test_registry();

        registry.register("int_output", || {
            let spec = NodeSpec {
                id: "int_output".to_string(),
                display_name: "Int Output".to_string(),
                category: "Input".to_string(),
                description: "Test int output".to_string(),
                inputs: vec![],
                outputs: vec![PortSpec {
                    name: "output".to_string(),
                    label: "Output".to_string(),
                    ty: ValueType::Int,
                    ..Default::default()
                }],
                params: vec![],
            };
            Arc::new(TestNode { spec })
        });

        let int_out_id = graph.add_node("int_output");
        let process_id = graph.add_node("process"); // expects Float input

        // Int -> Float should succeed (implicit conversion)
        let result = graph.connect(&registry, int_out_id, "output", process_id, "input");
        assert!(result.is_ok(), "Int -> Float connection should be allowed");
    }

    #[test]
    fn test_types_compatible() {
        // Same types always compatible
        assert!(types_compatible(&ValueType::Float, &ValueType::Float));
        assert!(types_compatible(&ValueType::Int, &ValueType::Int));
        assert!(types_compatible(&ValueType::Image, &ValueType::Image));

        // Int <-> Float are compatible
        assert!(types_compatible(&ValueType::Int, &ValueType::Float));
        assert!(types_compatible(&ValueType::Float, &ValueType::Int));

        // Field -> Image/Mask are compatible
        assert!(types_compatible(&ValueType::Field, &ValueType::Image));
        assert!(types_compatible(&ValueType::Field, &ValueType::Mask));

        // Incompatible types
        assert!(!types_compatible(&ValueType::Image, &ValueType::Float));
        assert!(!types_compatible(&ValueType::Float, &ValueType::Image));
        assert!(!types_compatible(&ValueType::Bool, &ValueType::Float));
        assert!(!types_compatible(&ValueType::String, &ValueType::Int));
    }

    #[test]
    fn test_get_affected_viewers_linear_chain() {
        let registry = create_test_registry();
        let mut graph = Graph::new();
        let a = graph.add_node("process");
        let b = graph.add_node("process");
        let viewer = graph.add_node("viewer");
        graph.connect(&registry, a, "output", b, "input").unwrap();
        graph
            .connect(&registry, b, "output", viewer, "input")
            .unwrap();

        let affected = graph.get_affected_viewers(a);
        assert_eq!(affected, vec![viewer]);

        let affected = graph.get_affected_viewers(b);
        assert_eq!(affected, vec![viewer]);
    }

    #[test]
    fn test_get_affected_viewers_diamond_graph() {
        let registry = create_test_registry();
        let mut graph = Graph::new();
        let a = graph.add_node("process");
        let b = graph.add_node("process");
        let c = graph.add_node("process");
        let d = graph.add_node("process");
        let viewer = graph.add_node("viewer");
        graph.connect(&registry, a, "output", b, "input").unwrap();
        graph.connect(&registry, a, "output", c, "input").unwrap();
        graph.connect(&registry, b, "output", d, "input").unwrap();
        // c -> viewer directly, d also has output but not connected to viewer
        graph
            .connect(&registry, d, "output", viewer, "input")
            .unwrap();

        let affected = graph.get_affected_viewers(a);
        assert_eq!(affected, vec![viewer]);
    }

    #[test]
    fn test_get_affected_viewers_no_viewers() {
        let registry = create_test_registry();
        let mut graph = Graph::new();
        let a = graph.add_node("process");
        let b = graph.add_node("process");
        graph.connect(&registry, a, "output", b, "input").unwrap();

        let affected = graph.get_affected_viewers(a);
        assert!(affected.is_empty());
    }

    #[test]
    fn test_get_affected_viewers_viewer_itself() {
        let _registry = create_test_registry();
        let mut graph = Graph::new();
        let viewer = graph.add_node("viewer");

        let affected = graph.get_affected_viewers(viewer);
        assert_eq!(affected, vec![viewer]);
    }

    #[test]
    fn test_get_affected_viewers_invalid_node() {
        let graph = Graph::new();
        // Use a default NodeId that doesn't exist
        let fake_id = slotmap::KeyData::from_ffi(u64::MAX).into();
        let affected = graph.get_affected_viewers(fake_id);
        assert!(affected.is_empty());
    }

    #[test]
    fn test_get_affected_viewers_multiple_viewers() {
        let registry = create_test_registry();
        let mut graph = Graph::new();
        let a = graph.add_node("process");
        let viewer1 = graph.add_node("viewer");
        let viewer2 = graph.add_node("viewer");
        graph
            .connect(&registry, a, "output", viewer1, "input")
            .unwrap();
        graph
            .connect(&registry, a, "output", viewer2, "input")
            .unwrap();

        let mut affected = graph.get_affected_viewers(a);
        affected.sort_by_key(|id| id.0);
        let mut expected = vec![viewer1, viewer2];
        expected.sort_by_key(|id| id.0);
        assert_eq!(affected, expected);
    }

    #[test]
    fn test_get_affected_viewers_disconnected_subgraph() {
        let registry = create_test_registry();
        let mut graph = Graph::new();
        // Branch 1: a -> viewer1
        let a = graph.add_node("process");
        let viewer1 = graph.add_node("viewer");
        graph
            .connect(&registry, a, "output", viewer1, "input")
            .unwrap();
        // Branch 2: b -> viewer2 (disconnected)
        let b = graph.add_node("process");
        let viewer2 = graph.add_node("viewer");
        graph
            .connect(&registry, b, "output", viewer2, "input")
            .unwrap();

        // Changing a should only affect viewer1
        let affected = graph.get_affected_viewers(a);
        assert_eq!(affected, vec![viewer1]);

        // Changing b should only affect viewer2
        let affected = graph.get_affected_viewers(b);
        assert_eq!(affected, vec![viewer2]);
    }
}
