import { applyPackedAssetUrisToDocument, assetUriFromHash, isRecord } from './assetReferences';

const MANIFEST_NAME = 'cascade.json';

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
  applyPackedAssetUrisToDocument(data);
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
      uri: assetUriFromHash(hash),
    };
  }

  const sequenceFramesByNode = new Map<string, Array<Record<string, unknown>>>();
  for (const [key, rawAsset] of Object.entries(packedAssets)) {
    if (
      !isRecord(rawAsset)
      || (rawAsset.type !== 'image_sequence_frame' && rawAsset.asset_type !== 'image_sequence_frame')
    ) continue;
    const nodeId = key.split(':', 1)[0] ?? key;
    const frames = sequenceFramesByNode.get(nodeId) ?? [];
    frames.push({
      filename: rawAsset.original_filename,
      path: rawAsset.path,
      hash: rawAsset.hash,
      uri: rawAsset.uri,
    });
    sequenceFramesByNode.set(nodeId, frames);
  }
  for (const [nodeId, frames] of sequenceFramesByNode) {
    if (
      isRecord(packedAssets[nodeId])
      && (packedAssets[nodeId].type === 'image_sequence' || packedAssets[nodeId].asset_type === 'image_sequence')
    ) continue;
    frames.sort((a, b) => String(a.filename ?? '').localeCompare(String(b.filename ?? '')));
    const manifestBytes = new TextEncoder().encode(JSON.stringify({ frames }));
    const hash = await hashBytes(manifestBytes);
    const packagePath = `assets/${hash}.sequence.json`;
    if (!writtenPaths.has(packagePath)) {
      zip.file(packagePath, manifestBytes);
      writtenPaths.add(packagePath);
    }
    packedAssets[nodeId] = {
      type: 'image_sequence',
      source: 'packed',
      path: packagePath,
      original_filename: '',
      hash,
      uri: assetUriFromHash(hash),
    };
  }

  doc.assets = packedAssets;
  applyPackedAssetUrisToDocument(doc);
  doc.asset_storage = 'bundled';
  zip.file(MANIFEST_NAME, JSON.stringify(doc, null, 2));
  return zip.generateAsync({ type: 'blob' });
};
