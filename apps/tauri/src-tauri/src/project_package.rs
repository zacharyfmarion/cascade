use cascade_runtime::CascadeDocument;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;

pub const MANIFEST_NAME: &str = "cascade.json";

#[derive(Debug, Clone)]
pub struct AssetBlob {
    pub package_path: String,
    pub hash: String,
    pub bytes: Vec<u8>,
}

pub struct PackageRead {
    pub document: CascadeDocument,
    pub assets: HashMap<String, Vec<u8>>,
}

pub fn is_zip_project_bytes(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08")
}

pub fn asset_extension(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            ext.chars()
                .filter(|ch| ch.is_ascii_alphanumeric())
                .collect::<String>()
                .to_ascii_lowercase()
        })
        .filter(|ext| !ext.is_empty())
        .unwrap_or_else(|| "bin".to_string())
}

pub fn make_asset_blob(path: &Path, bytes: Vec<u8>) -> AssetBlob {
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hash = format!("{:x}", hasher.finalize());
    let ext = asset_extension(path);
    let package_path = format!("assets/{hash}.{ext}");
    AssetBlob {
        package_path,
        hash,
        bytes,
    }
}

pub fn read_asset_blob(path: &Path) -> Result<AssetBlob, String> {
    let bytes =
        std::fs::read(path).map_err(|e| format!("Failed to read asset {}: {e}", path.display()))?;
    Ok(make_asset_blob(path, bytes))
}

pub fn strip_packed_asset_params(document: &mut CascadeDocument) -> bool {
    let mut packed_types_by_node: HashMap<String, Vec<String>> = HashMap::new();
    for (key, asset_ref) in &document.assets {
        if asset_ref.source != "packed" {
            continue;
        }
        let node_id = key
            .split_once(':')
            .map_or(key.as_str(), |(node_id, _)| node_id);
        packed_types_by_node
            .entry(node_id.to_string())
            .or_default()
            .push(asset_ref.asset_type.clone());
    }

    let mut stripped = false;
    for node in &mut document.graph.nodes {
        let Some(packed_types) = packed_types_by_node.get(&node.id) else {
            continue;
        };
        match node.type_id.as_str() {
            "load_image" if packed_types.iter().any(|asset_type| asset_type == "image") => {
                stripped = node.params.remove("path").is_some() || stripped;
                stripped = node.params.remove("image_data").is_some() || stripped;
            }
            "load_image_sequence"
                if packed_types.iter().any(|asset_type| {
                    asset_type == "image_sequence" || asset_type == "image_sequence_frame"
                }) =>
            {
                stripped = node.params.remove("directory").is_some() || stripped;
                stripped = node.params.remove("pattern").is_some() || stripped;
            }
            "load_video" if packed_types.iter().any(|asset_type| asset_type == "video") => {
                stripped = node.params.remove("file_path").is_some() || stripped;
            }
            "load_image_batch"
                if packed_types
                    .iter()
                    .any(|asset_type| asset_type == "image_batch") =>
            {
                stripped = node.params.remove("files").is_some() || stripped;
            }
            _ => {}
        }
    }
    stripped
}

pub fn write_project_package(
    path: &Path,
    document: &CascadeDocument,
    assets: &[AssetBlob],
) -> Result<(), String> {
    let file =
        File::create(path).map_err(|e| format!("Failed to create {}: {e}", path.display()))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    writer
        .start_file(MANIFEST_NAME, options)
        .map_err(|e| e.to_string())?;
    let json = serde_json::to_vec_pretty(document).map_err(|e| e.to_string())?;
    writer.write_all(&json).map_err(|e| e.to_string())?;

    let mut written = std::collections::HashSet::new();
    for asset in assets {
        if !written.insert(asset.package_path.clone()) {
            continue;
        }
        writer
            .start_file(&asset.package_path, options)
            .map_err(|e| e.to_string())?;
        writer.write_all(&asset.bytes).map_err(|e| e.to_string())?;
    }

    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn read_project_package(path: &Path) -> Result<PackageRead, String> {
    let bytes = std::fs::read(path)
        .map_err(|e| format!("Failed to read project {}: {e}", path.display()))?;
    read_project_package_bytes(&bytes)
}

pub fn read_project_package_bytes(bytes: &[u8]) -> Result<PackageRead, String> {
    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
    let mut manifest = String::new();
    archive
        .by_name(MANIFEST_NAME)
        .map_err(|e| format!("Missing {MANIFEST_NAME}: {e}"))?
        .read_to_string(&mut manifest)
        .map_err(|e| e.to_string())?;
    let document: CascadeDocument = serde_json::from_str(&manifest).map_err(|e| e.to_string())?;

    let mut assets = HashMap::new();
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        if !name.starts_with("assets/") || name.ends_with('/') {
            continue;
        }
        let mut asset_bytes = Vec::new();
        file.read_to_end(&mut asset_bytes)
            .map_err(|e| e.to_string())?;
        assets.insert(name, asset_bytes);
    }

    Ok(PackageRead { document, assets })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cascade_runtime::{
        AssetReference, DocumentHeader, ParamValue, ProjectMetadata, SerializableConnection,
        SerializableGraph, SerializableNode,
    };
    use std::collections::HashMap;

    fn empty_document() -> CascadeDocument {
        CascadeDocument {
            cascade: DocumentHeader {
                format_version: "1.4.0".to_string(),
                app_version: String::new(),
                created_at: String::new(),
                modified_at: String::new(),
            },
            project: ProjectMetadata {
                name: "Test".to_string(),
                author: String::new(),
                description: String::new(),
            },
            graph: SerializableGraph {
                nodes: vec![SerializableNode {
                    id: "load".to_string(),
                    type_id: "load_image".to_string(),
                    params: HashMap::new(),
                    input_defaults: HashMap::new(),
                    position: (0.0, 0.0),
                    muted: false,
                }],
                connections: Vec::<SerializableConnection>::new(),
                group_definitions: vec![],
            },
            assets: HashMap::new(),
            scripts: HashMap::new(),
            view: None,
            dsl: None,
        }
    }

    fn asset_ref(asset_type: &str, source: &str, path: &str) -> AssetReference {
        AssetReference {
            asset_type: asset_type.to_string(),
            source: source.to_string(),
            path: path.to_string(),
            original_filename: String::new(),
            hash: String::new(),
        }
    }

    #[test]
    fn detects_zip_project_magic_bytes() {
        assert!(is_zip_project_bytes(b"PK\x03\x04abc"));
        assert!(is_zip_project_bytes(b"PK\x05\x06"));
        assert!(!is_zip_project_bytes(br#"{"cascade":{}}"#));
    }

    #[test]
    fn asset_blob_uses_content_hash_and_sanitized_extension() {
        let blob = make_asset_blob(Path::new("/tmp/Plate.PNG"), b"same bytes".to_vec());
        let duplicate = make_asset_blob(Path::new("/other/name.png"), b"same bytes".to_vec());

        assert_eq!(blob.hash, duplicate.hash);
        assert_eq!(blob.package_path, duplicate.package_path);
        assert!(blob.package_path.starts_with("assets/"));
        assert!(blob.package_path.ends_with(".png"));
    }

    #[test]
    fn zip_package_roundtrips_manifest_and_deduped_assets() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("project.casc");
        let document = empty_document();
        let a = make_asset_blob(Path::new("a.png"), vec![1, 2, 3, 4]);
        let b = make_asset_blob(Path::new("b.png"), vec![1, 2, 3, 4]);
        let c = make_asset_blob(Path::new("c.jpg"), vec![9, 8, 7]);

        write_project_package(&path, &document, &[a.clone(), b, c.clone()]).expect("write package");

        let raw = std::fs::read(&path).expect("read package");
        assert!(is_zip_project_bytes(&raw));
        let package = read_project_package_bytes(&raw).expect("read package bytes");
        assert_eq!(package.document.project.name, "Test");
        assert_eq!(package.assets.len(), 2);
        assert_eq!(package.assets.get(&a.package_path), Some(&vec![1, 2, 3, 4]));
        assert_eq!(package.assets.get(&c.package_path), Some(&vec![9, 8, 7]));
    }

    #[test]
    fn strip_packed_asset_params_removes_active_loader_paths() {
        let mut document = empty_document();
        document.graph.nodes[0].params.insert(
            "path".to_string(),
            ParamValue::String("file:///Users/me/plate.png".to_string()),
        );
        document.graph.nodes[0].params.insert(
            "image_data".to_string(),
            ParamValue::String("duplicated-bytes".to_string()),
        );
        document.graph.nodes.push(SerializableNode {
            id: "seq".to_string(),
            type_id: "load_image_sequence".to_string(),
            params: HashMap::from([
                (
                    "directory".to_string(),
                    ParamValue::String("/Users/me/frames".to_string()),
                ),
                (
                    "pattern".to_string(),
                    ParamValue::String("frame_{frame}.png".to_string()),
                ),
            ]),
            input_defaults: HashMap::new(),
            position: (0.0, 0.0),
            muted: false,
        });
        document.graph.nodes.push(SerializableNode {
            id: "video".to_string(),
            type_id: "load_video".to_string(),
            params: HashMap::from([(
                "file_path".to_string(),
                ParamValue::String("/Users/me/clip.mov".to_string()),
            )]),
            input_defaults: HashMap::new(),
            position: (0.0, 0.0),
            muted: false,
        });
        document.assets.insert(
            "load".to_string(),
            asset_ref("image", "packed", "assets/image.png"),
        );
        document.assets.insert(
            "seq:frame_0001.png".to_string(),
            asset_ref("image_sequence_frame", "packed", "assets/frame.png"),
        );
        document.assets.insert(
            "video".to_string(),
            asset_ref("video", "packed", "assets/clip.mov"),
        );

        assert!(strip_packed_asset_params(&mut document));

        let image_params = &document.graph.nodes[0].params;
        assert!(!image_params.contains_key("path"));
        assert!(!image_params.contains_key("image_data"));
        let sequence_params = &document
            .graph
            .nodes
            .iter()
            .find(|node| node.id == "seq")
            .expect("sequence node")
            .params;
        assert!(!sequence_params.contains_key("directory"));
        assert!(!sequence_params.contains_key("pattern"));
        let video_params = &document
            .graph
            .nodes
            .iter()
            .find(|node| node.id == "video")
            .expect("video node")
            .params;
        assert!(!video_params.contains_key("file_path"));
    }

    #[test]
    fn strip_packed_asset_params_leaves_external_loader_paths() {
        let mut document = empty_document();
        document.graph.nodes[0].params.insert(
            "path".to_string(),
            ParamValue::String("/Users/me/plate.png".to_string()),
        );
        document.assets.insert(
            "load".to_string(),
            asset_ref("image", "external", "/Users/me/plate.png"),
        );

        assert!(!strip_packed_asset_params(&mut document));

        assert!(document.graph.nodes[0].params.contains_key("path"));
    }

    #[test]
    fn missing_manifest_is_reported() {
        let mut cursor = Cursor::new(Vec::<u8>::new());
        {
            let mut writer = zip::ZipWriter::new(&mut cursor);
            let options = SimpleFileOptions::default();
            writer
                .start_file("not-cascade.json", options)
                .expect("start");
            writer.write_all(b"{}").expect("write");
            writer.finish().expect("finish");
        }

        let err = match read_project_package_bytes(&cursor.into_inner()) {
            Ok(_) => panic!("missing manifest should fail"),
            Err(err) => err,
        };
        assert!(err.contains("Missing cascade.json"));
    }
}
