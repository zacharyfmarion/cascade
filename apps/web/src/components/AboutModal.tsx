import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { TbBrandGithub, TbDownload } from 'react-icons/tb';
import { useSettingsStore } from '../store/settingsStore';

const REPOSITORY_URL = 'https://github.com/zacharyfmarion/cascade';
const MAC_DOWNLOAD_URL = 'https://github.com/zacharyfmarion/cascade/releases/latest';

export const ABOUT_MODAL_COPY = {
  title: 'Cascade',
  version: 'v0.1.0',
  description:
    'A node-based image editor that runs entirely in your browser. Inspired by Nuke and Blender.',
  downloadLabel: 'Download Cascade for Mac',
} as const;

export const ABOUT_MODAL_LINKS = {
  github: {
    href: REPOSITORY_URL,
    title: 'View GitHub Repository',
    ariaLabel: 'View GitHub Repository',
  },
  download: {
    href: MAC_DOWNLOAD_URL,
    title: 'Download Cascade for Mac',
    ariaLabel: 'Download Cascade for Mac',
  },
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

const iconActionsStyle: CSSProperties = {
  position: 'absolute',
  top: '16px',
  right: '16px',
  display: 'flex',
  gap: '8px',
};

const iconActionStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '28px',
  height: '28px',
  borderRadius: '8px',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-tertiary)',
  color: 'var(--text-secondary)',
  textDecoration: 'none',
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

interface IconLinkProps {
  href: string;
  title: string;
  ariaLabel: string;
  children: ReactNode;
}

function IconLink({ href, title, ariaLabel, children }: IconLinkProps) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      title={title}
      target="_blank"
      rel="noreferrer"
      style={iconActionStyle}
    >
      {children}
    </a>
  );
}

export function AboutModal() {
  const isOpen = useSettingsStore(s => s.isAboutOpen);
  const close = useSettingsStore(s => s.closeAbout);

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
        <div style={iconActionsStyle}>
          <IconLink {...ABOUT_MODAL_LINKS.github}>
            <TbBrandGithub size={15} aria-hidden="true" />
          </IconLink>
          <IconLink {...ABOUT_MODAL_LINKS.download}>
            <TbDownload size={15} aria-hidden="true" />
          </IconLink>
        </div>

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

        <a
          href={ABOUT_MODAL_LINKS.download.href}
          target="_blank"
          rel="noreferrer"
          style={primaryLinkStyle}
        >
          {ABOUT_MODAL_COPY.downloadLabel}
        </a>

        <button type="button" onClick={close} style={closeButtonStyle}>
          Close
        </button>
      </div>
    </div>
  );
}
