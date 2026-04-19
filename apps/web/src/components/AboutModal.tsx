import { useEffect, useState } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { APP_VERSION, HOMEBREW_TAP, RELEASES_URL, getMacDownloadUrl, type MacArch } from '../constants/release';

function detectMacArch(): MacArch {
  if (!navigator.userAgent.includes('Mac')) return 'aarch64';
  if (navigator.userAgent.includes('Intel')) return 'x64';
  return 'aarch64';
}

function useMacDownloadUrl(): string {
  const [arch, setArch] = useState<MacArch>(() => detectMacArch());

  useEffect(() => {
    if (!navigator.userAgent.includes('Mac')) return;

    const uaData = (
      navigator as Navigator & {
        userAgentData?: {
          getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
        };
      }
    ).userAgentData;

    if (uaData?.getHighEntropyValues) {
      void uaData.getHighEntropyValues(['architecture']).then((values) => {
        if (values.architecture === 'x86') {
          setArch('x64');
        }
      });
    }
  }, []);

  return getMacDownloadUrl(arch);
}

export function AboutModal() {
  const isOpen = useSettingsStore(s => s.isAboutOpen);
  const close = useSettingsStore(s => s.closeAbout);
  const downloadUrl = useMacDownloadUrl();

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="About Cascade"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--shadow-overlay)',
      }}
      onClick={close}
      onKeyDown={e => { if (e.key === 'Escape') close(); }}
    >
      <div
        role="document"
        style={{
          width: 360,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-default)',
          borderRadius: '8px',
          boxShadow: '0 8px 32px var(--shadow-contextMenu)',
          padding: '32px',
          textAlign: 'center',
        }}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
      >
        <img
          src="/favicon.png"
          alt="Cascade icon"
          style={{
            width: 64,
            height: 64,
            marginBottom: '12px',
            borderRadius: '12px',
          }}
        />
        <div
          style={{
            fontSize: '1.2rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: '4px',
          }}
        >
          Cascade
        </div>
        <div
          style={{
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            marginBottom: '16px',
          }}
        >
          v{APP_VERSION}
        </div>
        <div
          style={{
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            marginBottom: '16px',
          }}
        >
          A node-based image editor inspired by Nuke and Blender.
          Rust core with WASM for the browser and Tauri for native desktop.
        </div>
        <div
          style={{
            display: 'grid',
            gap: '8px',
            marginBottom: '16px',
          }}
        >
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              background: 'var(--accent-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--accent-primary)',
              borderRadius: '4px',
              fontSize: '0.8rem',
              padding: '8px 14px',
              textDecoration: 'none',
            }}
          >
            Download macOS DMG
          </a>
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.78rem',
              textDecoration: 'none',
            }}
          >
            View GitHub releases
          </a>
        </div>
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            lineHeight: 1.5,
            marginBottom: '24px',
          }}
        >
          Homebrew: <code>brew tap {HOMEBREW_TAP} && brew install --cask cascade</code>
        </div>
        <button
          type="button"
          onClick={close}
          style={{
            background: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
            borderRadius: '4px',
            fontSize: '0.8rem',
            padding: '6px 24px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
