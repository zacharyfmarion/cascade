use thiserror::Error;

#[derive(Error, Debug)]
pub enum CompositorError {
    #[error("Node not found: {0:?}")]
    NodeNotFound(crate::graph::NodeId),
    #[error("Missing input: {0}")]
    MissingInput(String),
    #[error("Missing parameter: {0}")]
    MissingParam(String),
    #[error("Type mismatch: expected {expected}, got {got}")]
    TypeMismatch { expected: String, got: String },
    #[error("Cycle detected in graph")]
    CycleDetected,
    #[error("Invalid connection: {0}")]
    InvalidConnection(String),
    #[error("Image decode error: {0}")]
    ImageDecode(String),
    #[error("Port not found: {node_type}.{port_name}")]
    PortNotFound {
        node_type: String,
        port_name: String,
    },
    #[error("{0}")]
    Other(String),
}
