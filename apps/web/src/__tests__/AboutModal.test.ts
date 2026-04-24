import { describe, expect, it } from 'vitest';
import { ABOUT_MODAL_COPY } from '../components/AboutModal';
import { APP_VERSION, REPOSITORY_URL, getMacDownloadUrl } from '../constants/release';

describe('AboutModal content', () => {
  it('uses the requested product description and CTA copy', () => {
    expect(ABOUT_MODAL_COPY.version).toBe(`v${APP_VERSION}`);
    expect(ABOUT_MODAL_COPY.description).toBe(
      'A node-based image editor that runs entirely in your browser. Inspired by Nuke and Blender.'
    );
    expect(ABOUT_MODAL_COPY.downloadLabel).toBe('Download Cascade for Mac');
  });

  it('release constants point at the correct download URL', () => {
    expect(REPOSITORY_URL).toContain('github.com');
    expect(getMacDownloadUrl()).toContain('Cascade_latest_aarch64.dmg');
  });
});
