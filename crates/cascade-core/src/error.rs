use thiserror::Error;

#[derive(Error, Debug)]
pub enum CascadeError {
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
    #[error("Invalid image data: expected {expected} elements, got {got}")]
    InvalidImageData { expected: usize, got: usize },
    #[error("Image too large: {width}x{height} exceeds maximum dimension {max}")]
    ImageTooLarge { width: u32, height: u32, max: u32 },
    #[error("Node '{node_type}' ({node_id}) failed: {source}")]
    EvalFailed {
        node_id: String,
        node_type: String,
        #[source]
        source: Box<CascadeError>,
    },
    #[error("{0}")]
    Other(String),
    #[error("EXR metadata parse error: {0}")]
    ExrMetadata(String),
    #[error("EXR decode error: {0}")]
    ExrDecode(String),
    #[error("Unsupported EXR layer '{layer_name}': {reason}")]
    ExrUnsupportedLayer { layer_name: String, reason: String },
    #[error("No usable primary RGBA layer found in EXR file")]
    ExrNoUsablePrimaryLayer,
    #[error("EXR layer '{layer_name}' too large: {width}x{height} exceeds max {max}")]
    ExrLayerTooLarge { layer_name: String, width: u32, height: u32, max: u32 },
    #[error("Expected Bytes value, got {got}")]
    ValueNotBytes { got: String },
}
