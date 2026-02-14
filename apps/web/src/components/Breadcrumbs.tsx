import React from 'react';
import { useGraphStore } from '../store/graphStore';

export const Breadcrumbs: React.FC = () => {
  const editingStack = useGraphStore(s => s.editingStack);
  const navigateToBreadcrumb = useGraphStore(s => s.navigateToBreadcrumb);

  if (editingStack.length <= 1) return null;

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
        return (
          <React.Fragment key={ctx.id + (ctx.groupNodeId ?? '')}>
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
            {!isLast && (
              <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>›</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
