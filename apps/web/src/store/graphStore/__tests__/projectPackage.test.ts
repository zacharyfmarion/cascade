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

  it('rewrites packed loader params and DSL to internal asset URIs', async () => {
    const blob = await createBundledProjectBlob({
      cascade: { format_version: '1.3.0' },
      dsl: {
        version: 1,
        text: [
          'graph {',
          '  load1 = LoadImage(path: image("file:///Users/me/plate.png"))',
          '  seq1 = LoadImageSequence(directory: sequence("/Users/me/frames"), pattern: "frame_{frame}.png")',
          '  video1 = LoadVideo(file_path: video("/Users/me/clip.mov"))',
          '}',
        ].join('\n'),
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
      graph: { nodes: Array<{ id: string; params: Record<string, { String?: string }> }> };
      assets: Record<string, { source: string; path: string; uri: string; type: string }>;
      dsl?: { text: string };
    };

    expect(packedDoc.assets.load1.source).toBe('packed');
    expect(packedDoc.assets['seq1:frame_0001.png'].source).toBe('packed');
    expect(packedDoc.assets.seq1.source).toBe('packed');
    expect(packedDoc.assets.seq1.type).toBe('image_sequence');
    expect(packedDoc.assets.video1.source).toBe('packed');
    const loadUri = packedDoc.graph.nodes.find(node => node.id === 'load1')?.params.path.String;
    const sequenceUri = packedDoc.graph.nodes.find(node => node.id === 'seq1')?.params.directory.String;
    const videoUri = packedDoc.graph.nodes.find(node => node.id === 'video1')?.params.file_path.String;
    expect(loadUri).toMatch(/^asset:\/\/sha256\/[a-f0-9]{64}$/);
    expect(sequenceUri).toMatch(/^asset:\/\/sha256\/[a-f0-9]{64}$/);
    expect(videoUri).toMatch(/^asset:\/\/sha256\/[a-f0-9]{64}$/);
    expect(packedDoc.graph.nodes.find(node => node.id === 'load1')?.params.image_data).toBeUndefined();
    expect(packedDoc.graph.nodes.find(node => node.id === 'seq1')?.params.pattern).toBeUndefined();
    expect(packedDoc.dsl?.text).toContain(`image("${loadUri}")`);
    expect(packedDoc.dsl?.text).toContain(`sequence("${sequenceUri}")`);
    expect(packedDoc.dsl?.text).toContain(`video("${videoUri}")`);
    expect(packedDoc.dsl?.text).not.toContain('/Users/me/plate.png');
    expect(packedDoc.dsl?.text).not.toContain('/Users/me/frames');
    expect(packedDoc.dsl?.text).not.toContain('/Users/me/clip.mov');
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

  it('repairs older bundled manifests to internal asset URI params on load', async () => {
    const sourceDoc = {
      cascade: { format_version: '1.3.0' },
      graph: {
        nodes: [{
          id: 'load1',
          type_id: 'load_image',
          params: {},
          input_defaults: {},
          position: [0, 0],
          muted: false,
        }],
        connections: [],
      },
      assets: {
        load1: {
          type: 'image',
          source: 'embedded',
          data: btoa('legacy-image'),
          original_filename: 'plate.png',
          hash: '',
        },
      },
    };
    const blob = await createBundledProjectBlob(sourceDoc);
    const file = new File([blob], 'legacy-bundled.casc');

    const loaded = await readCascadeProjectFile(file);
    const node = (loaded.graph as { nodes: Array<{ params: Record<string, { String?: string }> }> }).nodes[0];
    expect(node.params.path.String).toMatch(/^asset:\/\/sha256\/[a-f0-9]{64}$/);
  });

  it('fails clearly when a bundled project is missing cascade.json', async () => {
    const zip = new JSZip();
    zip.file('other.json', '{}');
    const file = new File([await zip.generateAsync({ type: 'blob' })], 'broken.casc');

    await expect(readCascadeProjectFile(file)).rejects.toThrow('missing cascade.json');
  });
});
