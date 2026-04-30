const MANIFEST_NAME = 'cascade.json';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const bytesToHex = (bytes: Uint8Array): string => (
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
);

const hashBytes = async (bytes: Uint8Array): Promise<string> => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return bytesToHex(new Uint8Array(digest));
};

const extensionFromAsset = (asset: Record<string, unknown>): string => {
  const candidates = [asset.original_filename, asset.path]
    .filter((item): item is string => typeof item === 'string');
  for (const candidate of candidates) {
    const match = candidate.match(/\.([A-Za-z0-9]+)$/);
    if (match) return match[1].toLowerCase();
  }
  if (asset.type === 'image' || asset.asset_type === 'image') return 'image';
  return 'bin';
};

const packedAssetNodeId = (key: string): string => key.split(':', 1)[0] ?? key;

const removeStringParams = (params: Record<string, unknown> | undefined, keys: string[]): boolean => {
  if (!params) return false;
  let removed = false;
  for (const key of keys) {
    if (key in params) {
      delete params[key];
      removed = true;
    }
  }
  return removed;
};

const stripPackedAssetParams = (doc: Record<string, unknown>): boolean => {
  if (!isRecord(doc.assets) || !isRecord(doc.graph) || !Array.isArray(doc.graph.nodes)) return false;

  const packedTypesByNode = new Map<string, Set<string>>();
  for (const [key, rawAsset] of Object.entries(doc.assets)) {
    if (!isRecord(rawAsset) || rawAsset.source !== 'packed') continue;
    const assetType = typeof rawAsset.type === 'string'
      ? rawAsset.type
      : typeof rawAsset.asset_type === 'string'
        ? rawAsset.asset_type
        : '';
    const nodeId = packedAssetNodeId(key);
    const types = packedTypesByNode.get(nodeId) ?? new Set<string>();
    types.add(assetType);
    packedTypesByNode.set(nodeId, types);
  }

  let stripped = false;
  for (const rawNode of doc.graph.nodes) {
    if (!isRecord(rawNode) || typeof rawNode.id !== 'string' || typeof rawNode.type_id !== 'string') continue;
    const packedTypes = packedTypesByNode.get(rawNode.id);
    if (!packedTypes || !isRecord(rawNode.params)) continue;

    if (rawNode.type_id === 'load_image' && packedTypes.has('image')) {
      stripped = removeStringParams(rawNode.params, ['path', 'image_data']) || stripped;
    } else if (
      rawNode.type_id === 'load_image_sequence'
      && (packedTypes.has('image_sequence') || packedTypes.has('image_sequence_frame'))
    ) {
      stripped = removeStringParams(rawNode.params, ['directory', 'pattern']) || stripped;
    } else if (rawNode.type_id === 'load_video' && packedTypes.has('video')) {
      stripped = removeStringParams(rawNode.params, ['file_path']) || stripped;
    } else if (rawNode.type_id === 'load_image_batch' && packedTypes.has('image_batch')) {
      stripped = removeStringParams(rawNode.params, ['files']) || stripped;
    }
  }
  return stripped;
};

export const isBundledProjectBytes = (bytes: Uint8Array): boolean => (
  bytes.length >= 4
  && bytes[0] === 0x50
  && bytes[1] === 0x4b
  && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
);

export const readCascadeProjectFile = async (file: File): Promise<Record<string, unknown>> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isBundledProjectBytes(bytes)) {
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  }

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);
  const manifest = zip.file(MANIFEST_NAME);
  if (!manifest) {
    throw new Error(`Bundled project is missing ${MANIFEST_NAME}`);
  }
  const data = JSON.parse(await manifest.async('text')) as Record<string, unknown>;
  if (!isRecord(data.assets)) return data;

  const nextAssets: Record<string, unknown> = {};
  for (const [key, rawAsset] of Object.entries(data.assets)) {
    if (!isRecord(rawAsset) || typeof rawAsset.path !== 'string' || rawAsset.source !== 'packed') {
      nextAssets[key] = rawAsset;
      continue;
    }
    const assetFile = zip.file(rawAsset.path);
    if (!assetFile) {
      throw new Error(`Bundled project is missing asset ${rawAsset.path}`);
    }
    const assetBytes = await assetFile.async('uint8array');
    nextAssets[key] = {
      ...rawAsset,
      data: bytesToBase64(assetBytes),
    };
  }
  data.assets = nextAssets;
  return data;
};

export const createBundledProjectBlob = async (projectDoc: Record<string, unknown>): Promise<Blob> => {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const doc = JSON.parse(JSON.stringify(projectDoc)) as Record<string, unknown>;
  const assets = isRecord(doc.assets) ? doc.assets : {};
  const packedAssets: Record<string, unknown> = {};
  const writtenPaths = new Set<string>();

  for (const [key, rawAsset] of Object.entries(assets)) {
    if (!isRecord(rawAsset) || typeof rawAsset.data !== 'string') {
      packedAssets[key] = rawAsset;
      continue;
    }

    const bytes = base64ToBytes(rawAsset.data);
    const hash = await hashBytes(bytes);
    const ext = extensionFromAsset(rawAsset);
    const packagePath = `assets/${hash}.${ext}`;
    if (!writtenPaths.has(packagePath)) {
      zip.file(packagePath, bytes);
      writtenPaths.add(packagePath);
    }
    const { data: _data, ...assetWithoutData } = rawAsset;
    packedAssets[key] = {
      ...assetWithoutData,
      source: 'packed',
      path: packagePath,
      hash,
    };
  }

  doc.assets = packedAssets;
  if (stripPackedAssetParams(doc)) {
    delete doc.dsl;
  }
  zip.file(MANIFEST_NAME, JSON.stringify(doc, null, 2));
  return zip.generateAsync({ type: 'blob' });
};
