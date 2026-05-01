import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { CASCADE_EXAMPLES } from './catalog';

const publicPathForUrl = (url: string): string => {
  const pathname = new URL(url, 'https://cascade.local').pathname.replace(/^\/+/, '');
  return join(process.cwd(), 'public', pathname);
};

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
      expect(example.requiredNodeTypes).toContain('export_image');
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

  it('includes an export image node below each packaged example viewer', async () => {
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
      const exportNode = (doc.graph?.nodes ?? []).find(node => node.type_id === 'export_image');

      expect(viewer).toBeDefined();
      expect(exportNode).toBeDefined();
      expect(exportNode!.position[1]).toBeGreaterThan(viewer!.position[1]);
      expect(doc.graph?.connections).toContainEqual(expect.objectContaining({
        to_node: exportNode!.id,
        to_port: 'image',
      }));
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
