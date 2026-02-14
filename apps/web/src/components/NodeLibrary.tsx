import React, { useCallback, useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';
import { useGraphStore } from '../store/graphStore';
import type { NodeSpec } from '../store/types';
import { getNodeIcon, getCategoryIcon } from './nodes/nodeIcons';

export const NodeLibrary: React.FC = () => {
  const nodeSpecs = useGraphStore(s => s.nodeSpecs);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    Input: true,
    Color: true,
    Filter: true,
    Output: true,
    Composite: true,
    Transform: true,
    Generator: true,
    Matte: true,
    GPU: true,
    Utility: true,
  });

  const grouped = useMemo(() => {
    const groups: Record<string, NodeSpec[]> = {};
    nodeSpecs.forEach(spec => {
      if (!groups[spec.category]) groups[spec.category] = [];
      if (spec.display_name.toLowerCase().includes(search.toLowerCase())) {
        groups[spec.category].push(spec);
      }
    });
    return groups;
  }, [nodeSpecs, search]);

  const addNode = useGraphStore(s => s.addNode);

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onDoubleClick = useCallback((nodeType: string) => {
    addNode(nodeType, { x: 250, y: 250 });
  }, [addNode]);

  const toggleCategory = (cat: string) => {
    setExpanded(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <div className="panel" style={{ width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '8px', borderBottom: '1px solid var(--border-default)' }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          background: 'var(--bg-primary)', 
          border: '1px solid var(--border-default)',
          borderRadius: '4px',
          padding: '4px 8px'
        }}>
          <Search size={14} style={{ color: 'var(--text-muted)', marginRight: '8px', flexShrink: 0 }} />
          <input 
            type="text" 
            placeholder="Search nodes..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              width: '100%',
              outline: 'none',
              fontSize: '0.85rem'
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {Object.entries(grouped).map(([category, specs]) => (
          <div key={category} style={{ marginBottom: '8px' }}>
            <button 
              type="button"
              onClick={() => toggleCategory(category)}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '4px 0',
                marginBottom: '4px'
              }}
            >
              {expanded[category] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span style={{ marginLeft: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {getCategoryIcon(category)}
                {category.toUpperCase()}
              </span>
            </button>
            
            {expanded[category] && (
              <div style={{ paddingLeft: '8px' }}>
                {specs.map(spec => (
                  <div
                    key={spec.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, spec.id)}
                    onDoubleClick={() => onDoubleClick(spec.id)}
                    role="button"
                    tabIndex={0}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '8px',
                      background: 'var(--bg-surface)',
                      marginBottom: '4px',
                      borderRadius: '4px',
                      cursor: 'grab',
                      border: '1px solid transparent',
                      transition: 'border-color 0.2s',
                      width: '100%',
                      textAlign: 'left',
                      color: 'var(--text-primary)',
                      userSelect: 'none',
                    }}
                    title={spec.description}
                  >
                    <div style={{ 
                      color: 'var(--accent-primary)', 
                      marginRight: '8px',
                      display: 'flex',
                      alignItems: 'center'
                    }}>
                      {getNodeIcon(spec.id, spec.category)}
                    </div>
                    <div style={{ fontSize: '0.85rem' }}>{spec.display_name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
