import { useEffect, type CSSProperties } from 'react';
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
  width: 'min(440px, calc(100vw - 32px))',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-default)',
  borderRadius: '8px',
  boxShadow: '0 8px 32px var(--shadow-contextMenu)',
  padding: '24px',
};

const titleStyle: CSSProperties = {
  margin: '0 0 8px',
  color: 'var(--text-primary)',
  fontSize: '1rem',
  fontWeight: 700,
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

export function UnsavedChangesModal() {
  const prompt = useGraphStore(s => s.unsavedChangesPrompt);
  const projectName = useGraphStore(s => s.currentProjectName);
  const resolve = useGraphStore(s => s.resolveUnsavedChanges);
  const dismiss = useGraphStore(s => s.dismissUnsavedChangesPrompt);

  useEffect(() => {
    if (!prompt) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [dismiss, prompt]);

  if (!prompt) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Unsaved changes"
      style={overlayStyle}
      onClick={dismiss}
      onKeyDown={event => {
        if (event.key === 'Escape') dismiss();
      }}
    >
      <div
        role="document"
        style={dialogStyle}
        onClick={event => event.stopPropagation()}
        onKeyDown={event => event.stopPropagation()}
      >
        <h2 style={titleStyle}>Save changes to {projectName || 'Untitled'}?</h2>
        <p style={bodyStyle}>
          Your current project has unsaved changes. Save them before continuing, discard them,
          or cancel to return to the project.
        </p>
        <div style={actionsStyle}>
          <Button size="md" variant="secondary" onClick={() => void resolve('cancel')}>
            Cancel
          </Button>
          <Button size="md" variant="secondary" onClick={() => void resolve('discard')}>
            Discard
          </Button>
          <Button size="md" variant="primary" onClick={() => void resolve('save')}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
