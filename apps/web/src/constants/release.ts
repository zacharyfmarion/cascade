import packageJson from '../../package.json';

export const APP_VERSION = packageJson.version;
export const REPOSITORY_URL = 'https://github.com/zacharyfmarion/cascade';
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;
export const RELEASE_BASE = `${RELEASES_URL}/latest/download`;
export const HOMEBREW_TAP = 'zacharyfmarion/homebrew-cascade';

// Only Apple Silicon (aarch64) builds are currently published.
export const MAC_DMG_FILENAME = 'Cascade_latest_aarch64.dmg';

export function getMacDownloadUrl(): string {
  return `${RELEASE_BASE}/${MAC_DMG_FILENAME}`;
}
