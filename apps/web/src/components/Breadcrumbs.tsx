import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PencilLine } from 'lucide-react';
import { useGraphStore } from '../store/graphStore';

export const Breadcrumbs: React.FC = () => {
  const editingStack = useGraphStore(s => s.editingStack);
  const navigateToBreadcrumb = useGraphStore(s => s.navigateToBreadcrumb);
  const renameGroup = useGraphStore(s => s.renameGroup);

  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (editingStack.length <= 1) return null;

  const startRename = (index: number) => {
    setRenameValue(editingStack[index].label);
    setRenamingIndex(index);
  };

  const commitRename = () => {
    if (renamingIndex === null) return;
    const ctx = editingStack[renamingIndex];
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== ctx.label && ctx.groupNodeId) {
      renameGroup(ctx.groupNodeId, trimmed);
    }
    setRenamingIndex(null);
  };

  const cancelRename = () => {
    setRenamingIndex(null);
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        left: 10,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-default)',
        borderRadius: 6,
        padding: '4px 8px',
        boxShadow: 'var(--node-shadow)',
        fontSize: '0.8rem',
        userSelect: 'none',
      }}
    >
      {editingStack.map((ctx, i) => {
        const isLast = i === editingStack.length - 1;
        const isRenaming = renamingIndex === i;
        const isGroupLevel = ctx.groupNodeId != null;

        return (
          <React.Fragment key={ctx.id + (ctx.groupNodeId ?? '')}>
            {isRenaming ? (
              <BreadcrumbRenameInput
                ref={inputRef}
                value={renameValue}
                onChange={setRenameValue}
                onCommit={commitRename}
                onCancel={cancelRename}
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => navigateToBreadcrumb(i)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '2px 6px',
                    borderRadius: 3,
                    cursor: isLast ? 'default' : 'pointer',
                    color: isLast ? 'var(--text-primary)' : 'var(--accent-primary)',
                    fontWeight: isLast ? 600 : 400,
                    fontSize: '0.8rem',
                    fontFamily: 'inherit',
                    transition: 'background-color 0.1s',
                  }}
                  onMouseEnter={e => {
                    if (!isLast) {
                      e.currentTarget.style.backgroundColor = 'var(--bg-surface)';
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  disabled={isLast}
                >
                  {ctx.label}
                </button>
                {isLast && isGroupLevel && (
                  <button
                    type="button"
                    onClick={() => startRename(i)}
                    title="Rename group"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '2px',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      borderRadius: 2,
                      transition: 'color 0.1s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.color = 'var(--text-primary)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = 'var(--text-muted)';
                    }}
                  >
                    <PencilLine size={12} />
                  </button>
                )}
              </>
            )}
            {!isLast && (
              <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>›</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const BreadcrumbRenameInput = React.forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (v: string) => void;
    onCommit: () => void;
    onCancel: () => void;
  }
>(({ value, onChange, onCommit, onCancel }, ref) => {
  const localRef = useRef<HTMLInputElement>(null);
  const inputEl = (ref as React.RefObject<HTMLInputElement>) ?? localRef;

  useEffect(() => {
    if (inputEl.current) {
      inputEl.current.focus();
      inputEl.current.select();
    }
  }, [inputEl]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onCommit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [onCommit, onCancel]);

  return (
    <input
      ref={inputEl}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={handleKeyDown}
      style={{
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        border: '1px solid var(--accent-primary)',
        borderRadius: 3,
        padding: '2px 6px',
        fontSize: '0.8rem',
        fontFamily: 'inherit',
        fontWeight: 600,
        outline: 'none',
        width: '120px',
      }}
    />
  );
});
BreadcrumbRenameInput.displayName = 'BreadcrumbRenameInput';
