import { describe, expect, it } from 'vitest';
import { ABOUT_MODAL_COPY, ABOUT_MODAL_LINKS } from '../components/AboutModal';
import { APP_VERSION, REPOSITORY_URL, getMacDownloadUrl } from '../constants/release';

describe('AboutModal content', () => {
  it('uses the requested product description and CTA copy', () => {
    expect(ABOUT_MODAL_COPY.version).toBe(`v${APP_VERSION}`);
    expect(ABOUT_MODAL_COPY.description).toBe(
      'A node-based image editor that runs entirely in your browser. Inspired by Nuke and Blender.'
    );
    expect(ABOUT_MODAL_COPY.downloadLabel).toBe('Download Cascade for Mac');
  });

  it('points the icon actions at the repository and release download metadata', () => {
    expect(ABOUT_MODAL_LINKS.github).toMatchObject({
      href: REPOSITORY_URL,
      ariaLabel: 'View GitHub Repository',
    });
    expect(ABOUT_MODAL_LINKS.download).toMatchObject({
      ariaLabel: 'Download Cascade for Mac',
    });
    expect(getMacDownloadUrl('aarch64')).toContain('Cascade_latest_aarch64.dmg');
    expect(getMacDownloadUrl('x64')).toContain('Cascade_latest_x64.dmg');
  });
});
