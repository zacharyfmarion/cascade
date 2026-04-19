import { describe, expect, it } from 'vitest';
import { ABOUT_MODAL_COPY, ABOUT_MODAL_LINKS } from '../components/AboutModal';

describe('AboutModal content', () => {
  it('uses the requested product description and CTA copy', () => {
    expect(ABOUT_MODAL_COPY.description).toBe(
      'A node-based image editor that runs entirely in your browser. Inspired by Nuke and Blender.'
    );
    expect(ABOUT_MODAL_COPY.downloadLabel).toBe('Download Cascade for Mac');
  });

  it('points the icon actions at the repository and latest Mac release entrypoint', () => {
    expect(ABOUT_MODAL_LINKS.github).toMatchObject({
      href: 'https://github.com/zacharyfmarion/cascade',
      ariaLabel: 'View GitHub Repository',
    });
    expect(ABOUT_MODAL_LINKS.download).toMatchObject({
      href: 'https://github.com/zacharyfmarion/cascade/releases/latest',
      ariaLabel: 'Download Cascade for Mac',
    });
  });
});
