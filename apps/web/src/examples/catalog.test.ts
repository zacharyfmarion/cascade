import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { CASCADE_EXAMPLES } from './catalog';
import { dslShadowMatchesGraph, hydrateDslShadowMetadata } from '../ai/dsl/shadow';
import { mockSpecs } from '../ai/dsl/__tests__/helpers';
import type { Connection, DslShadowDocument, NodeInstance } from '../store/types';

const publicPathForUrl = (url: string): string => {
  const pathname = new URL(url, 'https://cascade.local').pathname.replace(/^\/+/, '');
  return join(process.cwd(), 'public', pathname);
};

const redButtonExampleIds = new Set([
  'batch-resize-export',
  'watermark-overlay',
  'social-media-variants',
]);

type PackageNode = {
  id: string;
  type_id: string;
  params?: NodeInstance['params'];
  input_defaults?: NodeInstance['inputDefaults'];
  position?: [number, number];
  muted?: boolean;
};

type PackageConnection = {
  from_node: string;
  from_port: string;
  to_node: string;
  to_port: string;
};

const nodeMapFromPackage = (nodes: PackageNode[] = []): Map<string, NodeInstance> => new Map(nodes.map(node => [
  node.id,
  {
    id: node.id,
    typeId: node.type_id,
    params: node.params ?? {},
    inputDefaults: node.input_defaults ?? {},
    position: {
      x: node.position?.[0] ?? 0,
      y: node.position?.[1] ?? 0,
    },
    muted: node.muted ?? false,
  },
]));

const connectionsFromPackage = (connections: PackageConnection[] = []): Connection[] => connections.map((connection, index) => ({
  id: `conn-${index}`,
  fromNode: connection.from_node,
  fromPort: connection.from_port,
  toNode: connection.to_node,
  toPort: connection.to_port,
}));

describe('examples catalog', () => {
  it('has unique example ids', () => {
    const ids = CASCADE_EXAMPLES.map(example => example.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every example at bundled project and thumbnail assets', () => {
    for (const example of CASCADE_EXAMPLES) {
      expect(example.projectUrl).toMatch(/\.casc$/);
      expect(example.thumbnailUrl).toMatch(/\.webp$/);
      expect(existsSync(publicPathForUrl(example.projectUrl))).toBe(true);
      expect(existsSync(publicPathForUrl(example.thumbnailUrl))).toBe(true);
    }
  });

  it('declares required node types for GPU-only examples', () => {
    const photoGrade = CASCADE_EXAMPLES.find(example => example.id === 'photo-grade');
    const pixelate = CASCADE_EXAMPLES.find(example => example.id === 'pixel-art-palette-grade');
    const customEffects = CASCADE_EXAMPLES.filter(example => example.section === 'Custom Effects');

    expect(photoGrade?.requiredNodeTypes).toContain('group::photo_adjust');
    expect(photoGrade?.requiredNodeTypes).toContain('compare_viewer');
    expect(pixelate?.requiredNodeTypes).toContain('gpu_kernel::pixelate');
    for (const example of CASCADE_EXAMPLES) {
      expect(
        example.requiredNodeTypes.includes('export_image')
        || example.requiredNodeTypes.includes('export_image_batch'),
      ).toBe(true);
    }
    for (const example of customEffects) {
      expect(example.requiredNodeTypes).toContain('gpu_script');
    }
  });

  it('connects packaged examples to the current viewer input port', async () => {
    for (const example of CASCADE_EXAMPLES) {
      const bytes = await readFile(publicPathForUrl(example.projectUrl));
      const zip = await JSZip.loadAsync(bytes);
      const manifest = zip.file('cascade.json');
      expect(manifest).not.toBeNull();
      const doc = JSON.parse(await manifest!.async('text')) as {
        graph?: {
          nodes?: Array<{ id: string; type_id: string }>;
          connections?: Array<{ to_node: string; to_port: string }>;
        };
      };
      const viewerIds = new Set((doc.graph?.nodes ?? [])
        .filter(node => node.type_id === 'viewer')
        .map(node => node.id));
      const compareViewerIds = new Set((doc.graph?.nodes ?? [])
        .filter(node => node.type_id === 'compare_viewer')
        .map(node => node.id));

      for (const connection of doc.graph?.connections ?? []) {
        if (viewerIds.has(connection.to_node)) {
          expect(connection.to_port).toBe('value');
        }
        if (compareViewerIds.has(connection.to_node)) {
          expect(['before', 'after']).toContain(connection.to_port);
        }
      }
    }
  });

  it('includes an export node below each packaged example viewer', async () => {
    for (const example of CASCADE_EXAMPLES) {
      const bytes = await readFile(publicPathForUrl(example.projectUrl));
      const zip = await JSZip.loadAsync(bytes);
      const manifest = zip.file('cascade.json');
      expect(manifest).not.toBeNull();
      const doc = JSON.parse(await manifest!.async('text')) as {
        graph?: {
          nodes?: Array<{ id: string; type_id: string; position: [number, number] }>;
          connections?: Array<{ from_node: string; from_port: string; to_node: string; to_port: string }>;
        };
      };
      const viewer = (doc.graph?.nodes ?? []).find(node => node.type_id === 'viewer' || node.type_id === 'compare_viewer');
      const exportNode = (doc.graph?.nodes ?? [])
        .find(node => node.type_id === 'export_image' || node.type_id === 'export_image_batch');

      expect(viewer).toBeDefined();
      expect(exportNode).toBeDefined();
      expect(exportNode!.position[1]).toBeGreaterThan(viewer!.position[1]);
      expect(doc.graph?.connections).toContainEqual(expect.objectContaining({
        to_node: exportNode!.id,
        to_port: 'image',
      }));
    }
  });

  it('ships red button examples with valid DSL shadows and bundled asset URIs', async () => {
    for (const example of CASCADE_EXAMPLES.filter(item => redButtonExampleIds.has(item.id))) {
      const bytes = await readFile(publicPathForUrl(example.projectUrl));
      const zip = await JSZip.loadAsync(bytes);
      const manifest = zip.file('cascade.json');
      expect(manifest).not.toBeNull();
      const doc = JSON.parse(await manifest!.async('text')) as {
        graph?: {
          nodes?: PackageNode[];
          connections?: PackageConnection[];
        };
        assets?: Record<string, { type?: string; source?: string; uri?: string; path?: string }>;
        dsl?: {
          version?: number;
          text?: string;
          graph_hash?: string;
          handles?: Array<{ node_id?: string; handle?: string }>;
          custom_definition_names?: unknown[];
        };
      };

      expect(doc.dsl?.version).toBe(1);
      expect(doc.dsl?.text).toContain('graph {');
      expect(doc.dsl?.text).toContain('asset://sha256/');
      expect(Object.values(doc.assets ?? {}).every(asset => asset.source === 'packed')).toBe(true);

      const assetUris = new Set(
        Object.values(doc.assets ?? {})
          .filter(asset => asset.type !== 'image_batch')
          .map(asset => asset.uri)
          .filter((uri): uri is string => typeof uri === 'string'),
      );
      const serializedGraph = JSON.stringify(doc.graph ?? {});
      for (const uri of assetUris) {
        expect(serializedGraph.includes(uri) || doc.dsl?.text?.includes(uri)).toBe(true);
      }

      const nodes = nodeMapFromPackage(doc.graph?.nodes);
      const connections = connectionsFromPackage(doc.graph?.connections);
      const hydrated = hydrateDslShadowMetadata(doc.dsl, nodes, connections, mockSpecs, 0);
      expect(hydrated?.status).toBe('valid');
      expect(dslShadowMatchesGraph(hydrated as DslShadowDocument, nodes, connections, mockSpecs)).toBe(true);
    }
  });

  it('keeps Pexels source credits for bundled example images', async () => {
    const creditsPath = join(process.cwd(), 'public', 'examples', 'credits.json');
    const credits = JSON.parse(await readFile(creditsPath, 'utf8')) as {
      license?: { url?: string };
      assets?: Array<{
        filename?: string;
        sourceUrl?: string;
        usedBy?: string[];
      }>;
    };
    const exampleIds = new Set(CASCADE_EXAMPLES.map(example => example.id));

    expect(credits.license?.url).toBe('https://www.pexels.com/license/');
    for (const asset of credits.assets ?? []) {
      expect(asset.filename).toMatch(/\.jpg$/);
      expect(asset.sourceUrl).toMatch(/^https:\/\/www\.pexels\.com\/photo\//);
      expect(existsSync(join(process.cwd(), 'public', 'examples', 'source-assets', asset.filename ?? ''))).toBe(true);
      for (const exampleId of asset.usedBy ?? []) {
        expect(exampleIds.has(exampleId)).toBe(true);
      }
    }
  });
});
