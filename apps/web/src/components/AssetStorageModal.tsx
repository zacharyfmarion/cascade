import type { CSSProperties } from 'react';
import { useGraphStore } from '../store/graphStore';
import { Button } from './ui/Button';

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
          <Button size="md" variant="secondary" onClick={dismiss}>
            Cancel
          </Button>
          <Button size="md" variant="secondary" onClick={() => void resolve('external')}>
            Reference files
          </Button>
          <Button size="md" variant="primary" onClick={() => void resolve('bundled')}>
            Bundle assets
          </Button>
        </div>
      </div>
    </div>
  );
}
