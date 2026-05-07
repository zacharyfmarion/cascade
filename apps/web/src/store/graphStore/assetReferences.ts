import type { ParamValue } from '../types';

export type ProjectAssetStorage = 'external' | 'bundled';

export type ProjectAssetRecord = {
  type?: string;
  asset_type?: string;
  source?: string;
  path?: string;
  uri?: string;
  hash?: string;
  data?: string;
  original_filename?: string;
};

export const ASSET_URI_PREFIX = 'asset://sha256/';

export const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

export const assetUriFromHash = (hash: string): string => `${ASSET_URI_PREFIX}${hash}`;

export const isAssetUri = (value: string): boolean => value.startsWith(ASSET_URI_PREFIX);

export const assetHashFromUri = (value: string): string | null => (
  isAssetUri(value) ? value.slice(ASSET_URI_PREFIX.length) : null
);

export const assetTypeOf = (asset: ProjectAssetRecord): string => asset.type ?? asset.asset_type ?? '';

export const assetUriOf = (asset: ProjectAssetRecord): string => {
  if (typeof asset.uri === 'string' && asset.uri) return asset.uri;
  if (typeof asset.hash === 'string' && asset.hash) return assetUriFromHash(asset.hash);
  return '';
};

export const stringParam = (value: string): ParamValue => ({ String: value });

export const packedAssetNodeId = (key: string): string => key.split(':', 1)[0] ?? key;

export const collectProjectAssets = (assets: unknown): Record<string, ProjectAssetRecord> => {
  if (!isRecord(assets)) return {};
  const next: Record<string, ProjectAssetRecord> = {};
  for (const [key, value] of Object.entries(assets)) {
    if (isRecord(value)) {
      next[key] = value as ProjectAssetRecord;
    }
  }
  return next;
};

export const hasAssetBackedNodes = (graphData: unknown, assets: unknown): boolean => {
  if (Object.keys(collectProjectAssets(assets)).length > 0) return true;
  const graph = isRecord(graphData) && isRecord(graphData.graph) ? graphData.graph : graphData;
  if (!isRecord(graph) || !Array.isArray(graph.nodes)) return false;
  return graph.nodes.some((node) => {
    if (!isRecord(node) || !isRecord(node.params)) return false;
    const params = node.params;
    const candidates = [params.path, params.directory, params.file_path, params.files];
    return candidates.some(value => isRecord(value) && typeof value.String === 'string' && value.String.length > 0);
  });
};

export const findAssetByUri = (
  assets: Record<string, ProjectAssetRecord>,
  uri: string,
): [string, ProjectAssetRecord] | null => {
  const hash = assetHashFromUri(uri);
  for (const [key, asset] of Object.entries(assets)) {
    if (assetUriOf(asset) === uri || (hash && asset.hash === hash)) {
      return [key, asset];
    }
  }
  return null;
};

const replaceDslAssetText = (doc: Record<string, unknown>, replacements: Map<string, string>): void => {
  if (!isRecord(doc.dsl) || typeof doc.dsl.text !== 'string') return;
  let text = doc.dsl.text;
  for (const [from, to] of replacements) {
    if (!from || from === to) continue;
    text = text.split(from).join(to);
  }
  doc.dsl = { ...doc.dsl, text };
};

export const applyPackedAssetUrisToDocument = (doc: Record<string, unknown>): boolean => {
  if (!isRecord(doc.assets) || !isRecord(doc.graph) || !Array.isArray(doc.graph.nodes)) return false;
  const assets = collectProjectAssets(doc.assets);
  const replacements = new Map<string, string>();
  let changed = false;

  const packedTypesByNode = new Map<string, Set<string>>();
  for (const [key, asset] of Object.entries(assets)) {
    if (asset.source !== 'packed') continue;
    const uri = assetUriOf(asset);
    if (!uri) continue;
    const nodeId = packedAssetNodeId(key);
    const types = packedTypesByNode.get(nodeId) ?? new Set<string>();
    types.add(assetTypeOf(asset));
    packedTypesByNode.set(nodeId, types);
  }

  for (const rawNode of doc.graph.nodes) {
    if (!isRecord(rawNode) || typeof rawNode.id !== 'string' || typeof rawNode.type_id !== 'string') continue;
    const packedTypes = packedTypesByNode.get(rawNode.id);
    if (!packedTypes) continue;
    const params = isRecord(rawNode.params) ? rawNode.params : {};
    rawNode.params = params;

    const setStringParam = (key: string, uri: string) => {
      const current = isRecord(params[key]) && typeof params[key].String === 'string'
        ? params[key].String
        : '';
      if (current) replacements.set(current, uri);
      if (current !== uri) {
        params[key] = stringParam(uri);
        changed = true;
      }
    };

    if (rawNode.type_id === 'load_image' && packedTypes.has('image')) {
      const asset = assets[rawNode.id];
      const uri = asset ? assetUriOf(asset) : '';
      if (uri) setStringParam('path', uri);
      delete params.image_data;
    } else if (rawNode.type_id === 'load_video' && packedTypes.has('video')) {
      const asset = assets[rawNode.id];
      const uri = asset ? assetUriOf(asset) : '';
      if (uri) setStringParam('file_path', uri);
    } else if (
      rawNode.type_id === 'load_image_sequence'
      && (packedTypes.has('image_sequence') || packedTypes.has('image_sequence_frame'))
    ) {
      const sequenceAsset = assets[rawNode.id];
      const uri = sequenceAsset && assetTypeOf(sequenceAsset) === 'image_sequence'
        ? assetUriOf(sequenceAsset)
        : Object.entries(assets)
          .filter(([key, asset]) => packedAssetNodeId(key) === rawNode.id && assetTypeOf(asset) === 'image_sequence_frame')
          .map(([, asset]) => assetUriOf(asset))
          .filter(Boolean)
          .sort()[0] ?? '';
      if (uri) setStringParam('directory', uri);
      if ('pattern' in params) {
        delete params.pattern;
        changed = true;
      }
    } else if (rawNode.type_id === 'load_image_batch' && packedTypes.has('image_batch')) {
      const asset = assets[rawNode.id];
      const uri = asset && assetTypeOf(asset) === 'image_batch' ? assetUriOf(asset) : '';
      const directory = isRecord(params.directory) && typeof params.directory.String === 'string'
        ? params.directory.String
        : '';
      const files = isRecord(params.files) && typeof params.files.String === 'string'
        ? params.files.String
        : '';
      if (uri && !directory && !files) setStringParam('files', uri);
    }
  }

  replaceDslAssetText(doc, replacements);
  return changed;
};
