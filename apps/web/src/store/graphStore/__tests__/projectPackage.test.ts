import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  createBundledProjectBlob,
  isBundledProjectBytes,
  readCascadeProjectFile,
} from '../projectPackage';

const blobBytes = async (blob: Blob): Promise<Uint8Array> => (
  new Uint8Array(await blob.arrayBuffer())
);

describe('projectPackage', () => {
  it('detects zip-backed Cascade projects by magic bytes', () => {
    expect(isBundledProjectBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(isBundledProjectBytes(new Uint8Array([0x7b, 0x22, 0x63, 0x61]))).toBe(false);
  });

  it('reads plain JSON .casc files unchanged', async () => {
    const doc = { cascade: { format_version: '1.3.0' }, graph: { nodes: [] }, assets: {} };
    const file = new File([JSON.stringify(doc)], 'plain.casc', { type: 'application/json' });

    await expect(readCascadeProjectFile(file)).resolves.toEqual(doc);
  });

  it('creates a zip-backed .casc with cascade.json and packed assets', async () => {
    const doc = {
      cascade: { format_version: '1.3.0' },
      graph: { nodes: [] },
      assets: {
        load1: {
          type: 'image',
          source: 'embedded',
          data: btoa('image-bytes'),
          original_filename: 'plate.png',
          hash: '',
        },
      },
    };

    const blob = await createBundledProjectBlob(doc);
    const bytes = await blobBytes(blob);
    expect(isBundledProjectBytes(bytes)).toBe(true);

    const zip = await JSZip.loadAsync(bytes);
    const manifest = zip.file('cascade.json');
    expect(manifest).not.toBeNull();
    const packedDoc = JSON.parse(await manifest!.async('text')) as typeof doc;
    const asset = packedDoc.assets.load1 as Record<string, unknown>;
    expect(asset.source).toBe('packed');
    expect(asset.data).toBeUndefined();
    expect(asset.path).toMatch(/^assets\/[a-f0-9]{64}\.png$/);
    expect(zip.file(asset.path as string)).not.toBeNull();
  });

  it('removes stale loader paths from graph params when assets are packed', async () => {
    const blob = await createBundledProjectBlob({
      cascade: { format_version: '1.3.0' },
      dsl: {
        version: 1,
        text: 'load1 = LoadImage(path: image("file:///Users/me/plate.png"))',
        graph_hash: 'stale',
        handles: [],
        custom_definition_names: [],
      },
      graph: {
        nodes: [
          {
            id: 'load1',
            type_id: 'load_image',
            params: {
              path: { String: 'file:///Users/me/plate.png' },
              image_data: { String: btoa('duplicated-image') },
            },
            input_defaults: {},
            position: [0, 0],
            muted: false,
          },
          {
            id: 'seq1',
            type_id: 'load_image_sequence',
            params: {
              directory: { String: '/Users/me/frames' },
              pattern: { String: 'frame_{frame}.png' },
            },
            input_defaults: {},
            position: [0, 0],
            muted: false,
          },
          {
            id: 'video1',
            type_id: 'load_video',
            params: { file_path: { String: '/Users/me/clip.mov' } },
            input_defaults: {},
            position: [0, 0],
            muted: false,
          },
        ],
      },
      assets: {
        load1: {
          type: 'image',
          source: 'embedded',
          data: btoa('image-bytes'),
          original_filename: 'plate.png',
          hash: '',
        },
        'seq1:frame_0001.png': {
          type: 'image_sequence_frame',
          source: 'embedded',
          data: btoa('frame-bytes'),
          original_filename: 'frame_0001.png',
          hash: '',
        },
        video1: {
          type: 'video',
          source: 'embedded',
          data: btoa('video-bytes'),
          original_filename: 'clip.mov',
          hash: '',
        },
      },
    });

    const zip = await JSZip.loadAsync(await blobBytes(blob));
    const packedDoc = JSON.parse(await zip.file('cascade.json')!.async('text')) as {
      graph: { nodes: Array<{ id: string; params: Record<string, unknown> }> };
      assets: Record<string, { source: string; path: string }>;
      dsl?: unknown;
    };

    expect(packedDoc.assets.load1.source).toBe('packed');
    expect(packedDoc.assets['seq1:frame_0001.png'].source).toBe('packed');
    expect(packedDoc.assets.video1.source).toBe('packed');
    expect(packedDoc.graph.nodes.find(node => node.id === 'load1')?.params).toEqual({});
    expect(packedDoc.graph.nodes.find(node => node.id === 'seq1')?.params).toEqual({});
    expect(packedDoc.graph.nodes.find(node => node.id === 'video1')?.params).toEqual({});
    expect(packedDoc.dsl).toBeUndefined();
  });

  it('deduplicates identical asset bytes inside the package', async () => {
    const data = btoa('same-media');
    const blob = await createBundledProjectBlob({
      cascade: { format_version: '1.3.0' },
      graph: { nodes: [] },
      assets: {
        a: { type: 'image', source: 'embedded', data, original_filename: 'a.png', hash: '' },
        b: { type: 'image', source: 'embedded', data, original_filename: 'b.png', hash: '' },
      },
    });
    const zip = await JSZip.loadAsync(await blobBytes(blob));
    const packedDoc = JSON.parse(await zip.file('cascade.json')!.async('text')) as {
      assets: Record<string, { path: string }>;
    };

    expect(packedDoc.assets.a.path).toBe(packedDoc.assets.b.path);
    expect(Object.keys(zip.files).filter(name => name.startsWith('assets/') && !name.endsWith('/'))).toHaveLength(1);
  });

  it('hydrates packed asset bytes back to base64 for existing web import code', async () => {
    const sourceDoc = {
      cascade: { format_version: '1.3.0' },
      graph: { nodes: [] },
      assets: {
        load1: {
          type: 'image',
          source: 'embedded',
          data: btoa('roundtrip-image'),
          original_filename: 'plate.jpg',
          hash: '',
        },
      },
    };
    const blob = await createBundledProjectBlob(sourceDoc);
    const file = new File([blob], 'bundled.casc');

    const loaded = await readCascadeProjectFile(file);
    expect((loaded.assets as Record<string, { data: string }>).load1.data).toBe(btoa('roundtrip-image'));
  });

  it('fails clearly when a bundled project is missing cascade.json', async () => {
    const zip = new JSZip();
    zip.file('other.json', '{}');
    const file = new File([await zip.generateAsync({ type: 'blob' })], 'broken.casc');

    await expect(readCascadeProjectFile(file)).rejects.toThrow('missing cascade.json');
  });
});
