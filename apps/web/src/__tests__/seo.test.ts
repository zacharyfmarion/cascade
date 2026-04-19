import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readWebFile = (...parts: string[]) => fs.readFileSync(path.join(webRoot, ...parts), 'utf8');

const getPngDimensions = (filePath: string) => {
  const buffer = fs.readFileSync(filePath);
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`Expected PNG file: ${filePath}`);
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
};

describe('static SEO surface', () => {
  it('ships a production-ready head in index.html', () => {
    const html = readWebFile('index.html');

    expect(html).toContain('<title>Cascade | Repeatable Image Workflows in Your Browser</title>');
    expect(html).toMatch(/<meta\s+name="description"/);
    expect(html).toContain('<link rel="canonical" href="https://cascade-editor.pages.dev/" />');
    expect(html).toContain('max-image-preview:large');
    expect(html).toContain('<meta property="og:url" content="https://cascade-editor.pages.dev/" />');
    expect(html).toContain('<meta property="og:image" content="https://cascade-editor.pages.dev/og-image.png" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />');
    expect(html).toContain('<h1>Create repeatable image workflows in your browser.</h1>');
    expect(html).toContain('JavaScript powers the full interactive editor');
  });

  it('includes valid SoftwareApplication structured data', () => {
    const html = readWebFile('index.html');
    const match = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);

    expect(match?.[1]).toBeTruthy();

    const schema = JSON.parse(match![1]) as {
      '@type': string;
      name: string;
      url: string;
      codeRepository: string;
      featureList: string[];
      offers: { price: string; priceCurrency: string };
    };

    expect(schema['@type']).toBe('SoftwareApplication');
    expect(schema.name).toBe('Cascade');
    expect(schema.url).toBe('https://cascade-editor.pages.dev/');
    expect(schema.codeRepository).toBe('https://github.com/zacharyfmarion/cascade');
    expect(schema.offers.price).toBe('0');
    expect(schema.offers.priceCurrency).toBe('USD');
    expect(schema.featureList.length).toBeGreaterThanOrEqual(4);
  });

  it('ships crawl and install assets', () => {
    const robots = readWebFile('public', 'robots.txt');
    const sitemap = readWebFile('public', 'sitemap.xml');
    const manifest = JSON.parse(readWebFile('public', 'site.webmanifest')) as {
      start_url: string;
      scope: string;
      icons: Array<{ src: string; sizes: string }>;
    };

    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Sitemap: https://cascade-editor.pages.dev/sitemap.xml');
    expect(sitemap).toContain('<loc>https://cascade-editor.pages.dev/</loc>');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icon-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: '/icon-512.png', sizes: '512x512' }),
      ]),
    );
  });

  it('ships correctly sized preview and manifest icons', () => {
    const ogImage = getPngDimensions(path.join(webRoot, 'public', 'og-image.png'));
    const icon192 = getPngDimensions(path.join(webRoot, 'public', 'icon-192.png'));
    const icon512 = getPngDimensions(path.join(webRoot, 'public', 'icon-512.png'));

    expect(ogImage).toEqual({ width: 1200, height: 630 });
    expect(icon192).toEqual({ width: 192, height: 192 });
    expect(icon512).toEqual({ width: 512, height: 512 });
  });
});
