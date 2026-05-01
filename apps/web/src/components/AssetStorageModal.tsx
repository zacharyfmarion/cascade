import type { CSSProperties } from 'react';
import { useGraphStore } from '../store/graphStore';

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--shadow-overlay)',
};

const dialogStyle: CSSProperties = {
  width: 'min(460px, calc(100vw - 32px))',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-default)',
  borderRadius: '8px',
  boxShadow: '0 8px 32px var(--shadow-contextMenu)',
  padding: '24px',
};

const bodyStyle: CSSProperties = {
  margin: '0 0 20px',
  color: 'var(--text-secondary)',
  fontSize: '0.9rem',
  lineHeight: 1.5,
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
};

const buttonStyle: CSSProperties = {
  minHeight: '34px',
  borderRadius: '4px',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  padding: '0 14px',
  font: 'inherit',
  cursor: 'pointer',
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  borderColor: 'var(--accent-primary)',
  background: 'var(--accent-primary)',
  color: 'var(--text-on-accent)',
};

export function AssetStorageModal() {
  const prompt = useGraphStore(s => s.assetStoragePrompt);
  const resolve = useGraphStore(s => s.resolveAssetStoragePrompt);
  const dismiss = useGraphStore(s => s.dismissAssetStoragePrompt);

  if (!prompt) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Asset storage" style={overlayStyle} onClick={dismiss}>
      <div role="document" style={dialogStyle} onClick={event => event.stopPropagation()}>
        <h2 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: '1rem', fontWeight: 700 }}>
          How should Cascade save project assets?
        </h2>
        <p style={bodyStyle}>
          Bundle assets for a portable project file, or keep references to files on this computer.
        </p>
        <div style={actionsStyle}>
          <button type="button" style={buttonStyle} onClick={dismiss}>
            Cancel
          </button>
          <button type="button" style={buttonStyle} onClick={() => void resolve('external')}>
            Reference files
          </button>
          <button type="button" style={primaryButtonStyle} onClick={() => void resolve('bundled')}>
            Bundle assets
          </button>
        </div>
      </div>
    </div>
  );
}
