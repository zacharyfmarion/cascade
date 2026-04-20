import packageJson from '../../package.json';

export type MacArch = 'aarch64' | 'x64';

export const APP_VERSION = packageJson.version;
export const REPOSITORY_URL = 'https://github.com/zacharyfmarion/cascade';
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;
export const RELEASE_BASE = `${RELEASES_URL}/latest/download`;
export const HOMEBREW_TAP = 'zacharyfmarion/homebrew-cascade';
export const RELEASE_ASSETS: Record<MacArch, string> = {
  aarch64: 'Cascade_latest_aarch64.dmg',
  x64: 'Cascade_latest_x64.dmg',
};

export function getMacDownloadUrl(arch: MacArch): string {
  return `${RELEASE_BASE}/${RELEASE_ASSETS[arch]}`;
}
