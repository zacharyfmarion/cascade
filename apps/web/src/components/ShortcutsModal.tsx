import { useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { Button } from './ui/Button';
import { SHORTCUT_REGISTRY } from '../shortcuts/registry';
import { groupByCategory } from '../shortcuts/formatDisplay';

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

  const categories = groupByCategory(SHORTCUT_REGISTRY);

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
          {categories.map((cat) => (
            <div key={cat.title} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                {cat.items.map((item) => (
                  <div key={item.action} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {item.action}
                    </span>
                    <kbd
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
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.shortcut}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <Button
          size="md"
          variant="secondary"
          onClick={close}
          style={{
            marginTop: '24px',
            alignSelf: 'center',
          }}
        >
          Close
        </Button>
      </div>
    </div>
  );
}
