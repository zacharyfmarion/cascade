import { useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';

export function ShortcutsModal() {
  const isOpen = useSettingsStore(s => s.isShortcutsOpen);
  const close = useSettingsStore(s => s.closeShortcuts);

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

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl';

  const categories = [
    {
      title: 'General',
      items: [
        { action: 'Save Project', shortcut: [mod, 'S'] },
        { action: 'Open Project', shortcut: [mod, 'O'] },
        { action: 'Settings', shortcut: [mod, ','] },
        { action: 'Undo', shortcut: [mod, 'Z'] },
        { action: 'Redo', shortcut: [mod, 'Shift', 'Z'] },
        { action: 'Select All', shortcut: [mod, 'A'] },
        { action: 'Delete Selected', shortcut: ['Del'] },
      ]
    },
    {
      title: 'Node Graph',
      items: [
        { action: 'Copy', shortcut: [mod, 'C'] },
        { action: 'Cut', shortcut: [mod, 'X'] },
        { action: 'Paste', shortcut: [mod, 'V'] },
        { action: 'Group Nodes', shortcut: [mod, 'G'] },
        { action: 'Ungroup', shortcut: [mod, 'Alt', 'G'] },
        { action: 'Enter / Exit Group', shortcut: ['Tab'] },
        { action: 'Frame Selection', shortcut: ['F'] },
        { action: 'Mute / Unmute', shortcut: ['M'] },
        { action: 'Link to Viewer', shortcut: [mod, 'Shift', 'Click'] },
      ]
    },
    {
      title: 'Viewer',
      items: [
        { action: 'Zoom In', shortcut: [mod, '='] },
        { action: 'Zoom Out', shortcut: [mod, '-'] },
        { action: 'Fit to View', shortcut: [mod, '0'] },
        { action: 'Actual Size (100%)', shortcut: [mod, '1'] },
      ]
    },
    {
      title: 'Playback',
      items: [
        { action: 'Play / Pause', shortcut: ['Space'] },
        { action: 'Step Back', shortcut: ['←'] },
        { action: 'Step Forward', shortcut: ['→'] },
        { action: 'Go to Start', shortcut: ['Home'] },
        { action: 'Go to End', shortcut: ['End'] },
        { action: 'Toggle Loop', shortcut: ['L'] },
      ]
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard Shortcuts"
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
          width: 520,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-default)',
          borderRadius: '8px',
          boxShadow: '0 8px 32px var(--shadow-contextMenu)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '85vh',
        }}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
      >
        <div
          style={{
            fontSize: '1.1rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: '20px',
            textAlign: 'center',
          }}
        >
          Keyboard Shortcuts
        </div>

        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: '24px',
          overflowY: 'auto',
          paddingRight: '4px' 
        }}>
          {categories.map((cat, idx) => (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  letterSpacing: '0.05em',
                  marginBottom: '4px',
                  borderBottom: '1px solid var(--border-default)',
                  paddingBottom: '4px',
                }}
              >
                {cat.title}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {cat.items.map((item, itemIdx) => (
                  <div key={itemIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {item.action}
                    </span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {item.shortcut.map((key, keyIdx) => (
                        <kbd
                          key={keyIdx}
                          style={{
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border-default)',
                            borderRadius: '3px',
                            padding: '2px 6px',
                            fontSize: '0.7rem',
                            fontFamily: 'inherit',
                            color: 'var(--text-secondary)',
                            minWidth: '1.2em',
                            textAlign: 'center',
                          }}
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={close}
          style={{
            marginTop: '24px',
            background: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
            borderRadius: '4px',
            fontSize: '0.8rem',
            padding: '6px 24px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            alignSelf: 'center',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
