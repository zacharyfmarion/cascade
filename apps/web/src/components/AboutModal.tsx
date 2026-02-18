import { useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';

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
      aria-label="About Compositor"
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
        <div
          style={{
            fontSize: '1.2rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: '4px',
          }}
        >
          Compositor
        </div>
        <div
          style={{
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            marginBottom: '16px',
          }}
        >
          v0.1.0
        </div>
        <div
          style={{
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            marginBottom: '24px',
          }}
        >
          A node-based image compositor inspired by Nuke and Blender.
          Rust core with WASM for the browser and Tauri for native desktop.
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
