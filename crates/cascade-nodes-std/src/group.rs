use crate::input::LoadImage;
use cascade_core::error::CascadeError;
use cascade_core::eval::Evaluator;
use cascade_core::graph::{Graph, NodeId};
use cascade_core::group::{GroupDefinition, GroupInterface, InternalConnection, InternalNode};
use cascade_core::node::{EvalContext, Node, NodeFuture, NodeRegistry};
use cascade_core::types::*;
use std::any::Any;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, RwLock};

pub struct GroupInputNode {
    outputs: Vec<PortSpec>,
    injected: RwLock<HashMap<String, Value>>,
}

impl GroupInputNode {
    pub fn new(outputs: Vec<PortSpec>) -> Self {
        Self {
            outputs,
            injected: RwLock::new(HashMap::new()),
        }
    }

    pub fn inject_inputs(&self, inputs: HashMap<String, Value>) -> Result<(), CascadeError> {
        let mut guard = self
            .injected
            .write()
            .map_err(|_| CascadeError::Other("Group input lock poisoned".to_string()))?;
        *guard = inputs;
        Ok(())
    }
}

impl Node for GroupInputNode {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "group_input".to_string(),
            display_name: "Group Input".to_string(),
            category: "Group".to_string(),
            description: "Group input".to_string(),
            inputs: vec![],
            outputs: self.outputs.clone(),
            params: vec![],
        }
    }

    fn evaluate<'a>(&'a self, _ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let guard = self
                .injected
                .read()
                .map_err(|_| CascadeError::Other("Group input lock poisoned".to_string()))?;
            let mut outputs = HashMap::new();
            for port in &self.outputs {
                let value = guard.get(&port.name).cloned().unwrap_or(Value::None);
                outputs.insert(port.name.clone(), value);
            }
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

pub struct GroupOutputNode {
    ports: Vec<PortSpec>,
}

impl GroupOutputNode {
    pub fn new(ports: Vec<PortSpec>) -> Self {
        Self { ports }
    }
}

impl Node for GroupOutputNode {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "group_output".to_string(),
            display_name: "Group Output".to_string(),
            category: "Group".to_string(),
            description: "Group output".to_string(),
            inputs: self.ports.clone(),
            outputs: self.ports.clone(),
            params: vec![],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let mut outputs = HashMap::new();
            for port in &self.ports {
                let value = ctx.inputs.get(&port.name).cloned().unwrap_or(Value::None);
                outputs.insert(port.name.clone(), value);
            }
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

pub struct GroupNode {
    definition: Arc<GroupDefinition>,
    interface: GroupInterface,
    state: Mutex<GroupNodeState>,
    group_input_id: NodeId,
    group_output_id: NodeId,
    id_map: HashMap<String, NodeId>,
}

#[derive(Clone, Debug)]
pub struct InternalNodeState {
    pub params: HashMap<String, ParamValue>,
    pub input_defaults: HashMap<String, ParamValue>,
}

struct GroupNodeState {
    internal_graph: Graph,
    internal_nodes: HashMap<NodeId, Arc<dyn Node>>,
    internal_evaluator: Evaluator,
    internal_registry: NodeRegistry,
}

struct GroupStateRestore<'a> {
    state_mutex: &'a Mutex<GroupNodeState>,
    internal_graph: Graph,
    internal_nodes: HashMap<NodeId, Arc<dyn Node>>,
    internal_registry: NodeRegistry,
    internal_evaluator: Evaluator,
}

impl<'a> GroupStateRestore<'a> {
    fn new(
        state_mutex: &'a Mutex<GroupNodeState>,
        internal_graph: Graph,
        internal_nodes: HashMap<NodeId, Arc<dyn Node>>,
        internal_registry: NodeRegistry,
        internal_evaluator: Evaluator,
    ) -> Self {
        Self {
            state_mutex,
            internal_graph,
            internal_nodes,
            internal_registry,
            internal_evaluator,
        }
    }
}

impl Drop for GroupStateRestore<'_> {
    fn drop(&mut self) {
        let mut state = match self.state_mutex.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        state.internal_graph = std::mem::replace(&mut self.internal_graph, Graph::new());
        state.internal_nodes = std::mem::take(&mut self.internal_nodes);
        state.internal_registry =
            std::mem::replace(&mut self.internal_registry, NodeRegistry::new());
        state.internal_evaluator =
            std::mem::replace(&mut self.internal_evaluator, Evaluator::new());
    }
}

impl GroupNode {
    pub fn from_definition(
        definition: Arc<GroupDefinition>,
        registry: &NodeRegistry,
    ) -> Result<Self, String> {
        let interface = Self::derive_interface(&definition, registry)?;
        let (state, group_input_id, group_output_id, id_map) =
            Self::build_state(&definition, &interface, registry)?;
        Ok(Self {
            definition,
            interface,
            state: Mutex::new(state),
            group_input_id,
            group_output_id,
            id_map,
        })
    }

    pub fn build_spec(definition: &GroupDefinition, interface: &GroupInterface) -> NodeSpec {
        NodeSpec {
            id: definition.id.clone(),
            display_name: definition.name.clone(),
            category: definition.category.clone(),
            description: definition.description.clone(),
            inputs: interface.inputs.clone(),
            outputs: interface.outputs.clone(),
            params: definition
                .promotions
                .iter()
                .map(|promo| promo.spec.clone())
                .collect(),
        }
    }

    pub fn snapshot_internal_state(
        &self,
    ) -> Result<HashMap<String, InternalNodeState>, CascadeError> {
        let state = self
            .state
            .lock()
            .map_err(|_| CascadeError::Other("Group state lock poisoned".to_string()))?;
        let mut snapshot = HashMap::new();
        for (internal_id, node_id) in &self.id_map {
            let node = state.internal_graph.nodes.get(*node_id).ok_or_else(|| {
                CascadeError::Other(format!("Internal node not found: {internal_id}"))
            })?;
            snapshot.insert(
                internal_id.clone(),
                InternalNodeState {
                    params: node.params.clone(),
                    input_defaults: node.input_defaults.clone(),
                },
            );
        }
        Ok(snapshot)
    }

    pub fn derive_interface(
        definition: &GroupDefinition,
        registry: &NodeRegistry,
    ) -> Result<GroupInterface, String> {
        if let (Some(explicit_in), Some(explicit_out)) =
            (&definition.explicit_inputs, &definition.explicit_outputs)
        {
            let mut inputs = explicit_in.clone();
            let mut outputs = explicit_out.clone();

            let (group_input_id, group_output_id) = Self::find_group_nodes(definition)?;
            for conn in &definition.internal_graph.connections {
                if conn.from_node == group_input_id
                    && !inputs.iter().any(|p| p.name == conn.from_port)
                {
                    if let Ok(spec) = Self::derive_input_port(definition, registry, conn) {
                        inputs.push(spec);
                    }
                }
                if conn.to_node == group_output_id
                    && !outputs.iter().any(|p| p.name == conn.to_port)
                {
                    if let Ok(spec) = Self::derive_output_port(definition, registry, conn) {
                        outputs.push(spec);
                    }
                }
            }

            return Ok(GroupInterface { inputs, outputs });
        }

        let (group_input_id, group_output_id) = Self::find_group_nodes(definition)?;
        let mut inputs: Vec<PortSpec> = Vec::new();
        let mut outputs: Vec<PortSpec> = Vec::new();
        for conn in &definition.internal_graph.connections {
            if conn.from_node == group_input_id && !inputs.iter().any(|p| p.name == conn.from_port)
            {
                let input_spec = Self::derive_input_port(definition, registry, conn)?;
                inputs.push(input_spec);
            }
            if conn.to_node == group_output_id && !outputs.iter().any(|p| p.name == conn.to_port) {
                let output_spec = Self::derive_output_port(definition, registry, conn)?;
                outputs.push(output_spec);
            }
        }
        Ok(GroupInterface { inputs, outputs })
    }

    fn build_state(
        definition: &GroupDefinition,
        interface: &GroupInterface,
        registry: &NodeRegistry,
    ) -> Result<(GroupNodeState, NodeId, NodeId, HashMap<String, NodeId>), String> {
        if Self::internal_graph_has_cycle(definition) {
            return Err("Internal group graph contains a cycle".to_string());
        }
        let mut graph = Graph::new();
        let mut internal_nodes: HashMap<NodeId, Arc<dyn Node>> = HashMap::new();
        let mut internal_registry = NodeRegistry::new();
        let mut id_map = HashMap::new();

        let (group_input_str, group_output_str) = Self::find_group_nodes(definition)?;
        let mut group_input_id = None;
        let mut group_output_id = None;

        for node in &definition.internal_graph.nodes {
            let node_id = graph.add_node(&node.type_id);
            id_map.insert(node.id.clone(), node_id);
            for (key, value) in &node.params {
                graph.set_param(node_id, key, value.clone());
            }

            for (key, value) in &node.input_defaults {
                graph.set_input_default(node_id, key, value.clone());
            }

            let instance: Arc<dyn Node> = if node.type_id == "group_input" {
                Arc::new(GroupInputNode::new(interface.inputs.clone()))
            } else if node.type_id == "group_output" {
                Arc::new(GroupOutputNode::new(interface.outputs.clone()))
            } else {
                registry
                    .create(&node.type_id)
                    .ok_or_else(|| format!("Unknown internal node type: {}", node.type_id))?
            };

            if node.type_id == "load_image" {
                if let Some(bytes) = node.image_data.as_ref() {
                    if let Some(load_node) = instance.as_any().downcast_ref::<LoadImage>() {
                        let _ = load_node.set_image_data(bytes);
                    }
                }
            }

            if node.id == group_input_str {
                group_input_id = Some(node_id);
            }
            if node.id == group_output_str {
                group_output_id = Some(node_id);
            }

            internal_registry.register_spec(&node.type_id, instance.spec());
            internal_nodes.insert(node_id, instance);
        }

        for conn in &definition.internal_graph.connections {
            let from_id = id_map
                .get(&conn.from_node)
                .copied()
                .ok_or_else(|| format!("Unknown internal node id: {}", conn.from_node))?;
            let to_id = id_map
                .get(&conn.to_node)
                .copied()
                .ok_or_else(|| format!("Unknown internal node id: {}", conn.to_node))?;
            graph
                .connect(
                    &internal_registry,
                    from_id,
                    &conn.from_port,
                    to_id,
                    &conn.to_port,
                )
                .map_err(|err| err.to_string())?;
        }

        let group_input_id =
            group_input_id.ok_or_else(|| "Group input node not found".to_string())?;
        let group_output_id =
            group_output_id.ok_or_else(|| "Group output node not found".to_string())?;

        let state = GroupNodeState {
            internal_graph: graph,
            internal_nodes,
            internal_evaluator: Evaluator::new(),
            internal_registry,
        };
        Ok((state, group_input_id, group_output_id, id_map))
    }

    fn find_group_nodes(definition: &GroupDefinition) -> Result<(String, String), String> {
        let mut group_input_id = None;
        let mut group_output_id = None;
        for node in &definition.internal_graph.nodes {
            if node.type_id == "group_input" {
                group_input_id = Some(node.id.clone());
            }
            if node.type_id == "group_output" {
                group_output_id = Some(node.id.clone());
            }
        }
        let group_input_id =
            group_input_id.ok_or_else(|| "Group input node missing".to_string())?;
        let group_output_id =
            group_output_id.ok_or_else(|| "Group output node missing".to_string())?;
        Ok((group_input_id, group_output_id))
    }

    fn derive_input_port(
        definition: &GroupDefinition,
        registry: &NodeRegistry,
        conn: &InternalConnection,
    ) -> Result<PortSpec, String> {
        let to_node = Self::find_internal_node(definition, &conn.to_node)?;
        let to_spec = registry
            .get_spec(&to_node.type_id)
            .ok_or_else(|| format!("Unknown node type: {}", to_node.type_id))?;
        let all_inputs = to_spec.all_inputs();
        let input_port = all_inputs
            .iter()
            .find(|port| port.name == conn.to_port)
            .ok_or_else(|| format!("Unknown port: {}", conn.to_port))?;
        Ok(PortSpec {
            name: conn.from_port.clone(),
            label: conn.from_port.clone(),
            ty: input_port.ty.clone(),
            default: input_port.default.clone(),
            min: input_port.min,
            max: input_port.max,
            step: input_port.step,
            ui_hint: input_port.ui_hint.clone(),
        })
    }

    fn derive_output_port(
        definition: &GroupDefinition,
        registry: &NodeRegistry,
        conn: &InternalConnection,
    ) -> Result<PortSpec, String> {
        let from_node = Self::find_internal_node(definition, &conn.from_node)?;
        let from_spec = registry
            .get_spec(&from_node.type_id)
            .ok_or_else(|| format!("Unknown node type: {}", from_node.type_id))?;
        let output_port = from_spec
            .outputs
            .iter()
            .find(|port| port.name == conn.from_port)
            .ok_or_else(|| format!("Unknown port: {}", conn.from_port))?;
        Ok(PortSpec {
            name: conn.to_port.clone(),
            label: conn.to_port.clone(),
            ty: output_port.ty.clone(),
            default: output_port.default.clone(),
            min: output_port.min,
            max: output_port.max,
            step: output_port.step,
            ui_hint: output_port.ui_hint.clone(),
        })
    }

    fn find_internal_node<'a>(
        definition: &'a GroupDefinition,
        node_id: &str,
    ) -> Result<&'a InternalNode, String> {
        definition
            .internal_graph
            .nodes
            .iter()
            .find(|node| node.id == node_id)
            .ok_or_else(|| format!("Unknown internal node: {node_id}"))
    }

    fn internal_graph_has_cycle(definition: &GroupDefinition) -> bool {
        let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();
        for node in &definition.internal_graph.nodes {
            adjacency.entry(node.id.clone()).or_default();
        }
        for conn in &definition.internal_graph.connections {
            adjacency
                .entry(conn.from_node.clone())
                .or_default()
                .push(conn.to_node.clone());
        }

        let mut visiting = HashSet::new();
        let mut visited = HashSet::new();
        for node_id in adjacency.keys() {
            if Self::visit_internal_node(node_id, &adjacency, &mut visiting, &mut visited) {
                return true;
            }
        }
        false
    }

    fn visit_internal_node(
        node_id: &str,
        adjacency: &HashMap<String, Vec<String>>,
        visiting: &mut HashSet<String>,
        visited: &mut HashSet<String>,
    ) -> bool {
        if visited.contains(node_id) {
            return false;
        }
        if !visiting.insert(node_id.to_string()) {
            return true;
        }
        if let Some(neighbors) = adjacency.get(node_id) {
            for neighbor in neighbors {
                if Self::visit_internal_node(neighbor, adjacency, visiting, visited) {
                    return true;
                }
            }
        }
        visiting.remove(node_id);
        visited.insert(node_id.to_string());
        false
    }
}

impl Node for GroupNode {
    fn spec(&self) -> NodeSpec {
        Self::build_spec(&self.definition, &self.interface)
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let mut state_restore = {
                let mut state = self
                    .state
                    .lock()
                    .map_err(|_| CascadeError::Other("Group state lock poisoned".to_string()))?;

                let input_node = state
                    .internal_nodes
                    .get(&self.group_input_id)
                    .ok_or_else(|| CascadeError::Other("Group input node not found".to_string()))?;
                let group_input = input_node
                    .as_any()
                    .downcast_ref::<GroupInputNode>()
                    .ok_or_else(|| {
                        CascadeError::Other("Group input node type mismatch".to_string())
                    })?;
                group_input.inject_inputs(ctx.inputs.clone())?;
                state.internal_graph.mark_dirty(self.group_input_id);

                for promo in &self.definition.promotions {
                    if let Some(value) = ctx.params.get(&promo.group_param_key) {
                        let internal_id =
                            self.id_map.get(&promo.internal_node_id).ok_or_else(|| {
                                CascadeError::Other(format!(
                                    "Internal node {} not found",
                                    promo.internal_node_id
                                ))
                            })?;
                        state.internal_graph.set_param(
                            *internal_id,
                            &promo.internal_param_key,
                            value.clone(),
                        );
                    }
                }

                let internal_graph = std::mem::replace(&mut state.internal_graph, Graph::new());
                let internal_nodes = std::mem::take(&mut state.internal_nodes);
                let internal_registry =
                    std::mem::replace(&mut state.internal_registry, NodeRegistry::new());
                let internal_evaluator =
                    std::mem::replace(&mut state.internal_evaluator, Evaluator::new());
                GroupStateRestore::new(
                    &self.state,
                    internal_graph,
                    internal_nodes,
                    internal_registry,
                    internal_evaluator,
                )
            };

            let mut outputs = HashMap::new();
            for port in &self.interface.outputs {
                let eval_result = state_restore
                    .internal_evaluator
                    .evaluate(
                        &mut state_restore.internal_graph,
                        &state_restore.internal_registry,
                        &state_restore.internal_nodes,
                        self.group_output_id,
                        &port.name,
                        ctx.frame_time,
                        ctx.color_management,
                        ctx.ai_provider,
                        ctx.project_format,
                        &HashMap::new(),
                        ctx.preview_scale,
                    )
                    .await?;
                outputs.insert(port.name.clone(), eval_result.value);
            }

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
