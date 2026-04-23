import { useEffect, type CSSProperties } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { APP_VERSION } from '../constants/release';
import { useMacDownloadUrl } from '../hooks/useMacDownloadUrl';
import { isFeatureVisible } from '../platform/features';
import { getRuntimeSurface } from '../platform/runtime';

export const ABOUT_MODAL_COPY = {
  title: 'Cascade',
  version: `v${APP_VERSION}`,
  description:
    'A node-based image editor that runs entirely in your browser. Inspired by Nuke and Blender.',
  downloadLabel: 'Download Cascade for Mac',
} as const;

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--shadow-overlay)',
};

const dialogStyle: CSSProperties = {
  position: 'relative',
  width: 'min(420px, calc(100vw - 32px))',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-default)',
  borderRadius: '8px',
  boxShadow: '0 8px 32px var(--shadow-contextMenu)',
  padding: '32px',
  textAlign: 'center',
};

const logoStyle: CSSProperties = {
  width: '72px',
  height: '72px',
  marginBottom: '12px',
  borderRadius: '16px',
};

const descriptionStyle: CSSProperties = {
  fontSize: '0.9rem',
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
  marginBottom: '24px',
};

const primaryLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  minHeight: '44px',
  borderRadius: '6px',
  background: 'var(--accent-primary)',
  color: 'var(--text-on-accent)',
  textDecoration: 'none',
  fontSize: '0.95rem',
  fontWeight: 600,
  marginBottom: '20px',
};

const closeButtonStyle: CSSProperties = {
  background: 'var(--bg-surface)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-default)',
  borderRadius: '4px',
  fontSize: '0.8rem',
  padding: '6px 24px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export function AboutModal() {
  const isOpen = useSettingsStore(s => s.isAboutOpen);
  const close = useSettingsStore(s => s.closeAbout);
  const runtimeSurface = getRuntimeSurface();
  const showDownloadCta = isFeatureVisible('macDownloadCta', runtimeSurface);
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
      style={overlayStyle}
      onClick={close}
      onKeyDown={e => {
        if (e.key === 'Escape') close();
      }}
    >
      <div
        role="document"
        style={dialogStyle}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
      >
        <img src="/favicon.png" alt="Cascade icon" style={logoStyle} />

        <div
          style={{
            fontSize: '1.2rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: '4px',
          }}
        >
          {ABOUT_MODAL_COPY.title}
        </div>

        <div
          style={{
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            marginBottom: '16px',
          }}
        >
          {ABOUT_MODAL_COPY.version}
        </div>

        <div style={descriptionStyle}>{ABOUT_MODAL_COPY.description}</div>

        {showDownloadCta && (
          <a href={downloadUrl} target="_blank" rel="noreferrer" style={primaryLinkStyle}>
            {ABOUT_MODAL_COPY.downloadLabel}
          </a>
        )}

        <button type="button" onClick={close} style={closeButtonStyle}>
          Close
        </button>
      </div>
    </div>
  );
}
