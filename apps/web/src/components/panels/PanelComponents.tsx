import React, { useCallback, useRef, useState, useEffect } from 'react';
import type { IDockviewPanelProps, IDockviewPanelHeaderProps } from 'dockview';
import { ReactFlowProvider } from '@xyflow/react';
import { NodeCanvas } from '../NodeCanvas';
import { NodeLibrary } from '../NodeLibrary';
import { Inspector } from '../Inspector';
import { Viewer } from '../Viewer';
import { Timeline } from '../Timeline';
import { Breadcrumbs } from '../Breadcrumbs';
import { AiAssistant } from '../AiAssistant';
import { DslEditor } from '../DslEditor';
import { shortcutDispatcher } from '../../shortcuts/dispatcher';

const NodeCanvasPanel: React.FC<IDockviewPanelProps> = () => {
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    const unregister = shortcutDispatcher.register('ui.toggleAi', () => {
      setAiOpen(prev => !prev);
    });
    return unregister;
  }, []);

  return (
    <ReactFlowProvider>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <Breadcrumbs />
        <NodeCanvas />
        <AiAssistant isOpen={aiOpen} onToggle={() => setAiOpen(prev => !prev)} />
      </div>
    </ReactFlowProvider>
  );
};

const NodeLibraryPanel: React.FC<IDockviewPanelProps> = () => <NodeLibrary />;
const InspectorPanel: React.FC<IDockviewPanelProps> = () => <Inspector />;
const ViewerPanel: React.FC<IDockviewPanelProps> = () => <Viewer />;
const TimelinePanel: React.FC<IDockviewPanelProps> = () => <Timeline />;
const DslEditorPanel: React.FC<IDockviewPanelProps> = () => <DslEditor />;

export const panelComponents: Record<string, React.FC<IDockviewPanelProps>> = {
  'node-canvas': NodeCanvasPanel,
  'node-library': NodeLibraryPanel,
  'inspector': InspectorPanel,
  'viewer': ViewerPanel,
  'timeline': TimelinePanel,
  'dsl-editor': DslEditorPanel,
};

export interface PanelTypeInfo {
  id: string;
  label: string;
  icon: string;
}

export const PANEL_TYPES: PanelTypeInfo[] = [
  { id: 'node-canvas', label: 'Node Editor', icon: '⬡' },
  { id: 'dsl-editor', label: 'DSL', icon: '{ }' },
  { id: 'node-library', label: 'Node Library', icon: '☰' },
  { id: 'inspector', label: 'Inspector', icon: '⚙' },
  { id: 'viewer', label: 'Viewer', icon: '◉' },
  { id: 'timeline', label: 'Timeline', icon: '▶' },
];

export const EditorTab: React.FC<IDockviewPanelHeaderProps> = (props) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const panelId = props.api.id;
  const currentType = PANEL_TYPES.find(t => t.id === panelId)
    ?? PANEL_TYPES.find(t => panelId.startsWith(t.id));
  const icon = currentType?.icon ?? '□';

  const handleTypeChange = useCallback((newTypeId: string) => {
    setMenuOpen(false);
    const newType = PANEL_TYPES.find(t => t.id === newTypeId);
    if (!newType) return;

    const containerApi = props.containerApi;
    const group = props.group;
    const oldId = props.api.id;

    const panel = containerApi.getPanel(oldId);
    if (!panel) return;

    containerApi.removePanel(panel);
    containerApi.addPanel({
      id: `${newTypeId}-${Date.now()}`,
      component: newTypeId,
      title: newType.label,
      position: { referenceGroup: group.api.id },
    });
  }, [props.api, props.containerApi, props.group]);

  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '0 8px',
        height: '100%',
        fontSize: '0.75rem',
        color: 'var(--text-secondary)',
        position: 'relative',
        userSelect: 'none',
        cursor: 'pointer',
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(!menuOpen);
        }}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '2px',
          fontSize: '0.8rem',
          lineHeight: 1,
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
        }}
        title="Change editor type"
      >
        {icon}
      </button>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {props.api.title}
      </span>

      {menuOpen && (
        <div
          ref={menuRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 1000,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-default)',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            minWidth: '160px',
            padding: '4px 0',
          }}
        >
          {PANEL_TYPES.map(type => (
            <button
              key={type.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleTypeChange(type.id);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '6px 12px',
                background: type.id === currentType?.id ? 'var(--bg-surface)' : 'transparent',
                border: 'none',
                color: type.id === currentType?.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: '0.8rem',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => {
                if (type.id !== currentType?.id) {
                  e.currentTarget.style.background = 'var(--bg-surface)';
                }
              }}
              onMouseLeave={(e) => {
                if (type.id !== currentType?.id) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <span style={{ width: '16px', textAlign: 'center' }}>{type.icon}</span>
              <span>{type.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const tabComponents: Record<string, React.FC<IDockviewPanelHeaderProps>> = {
  'editor-tab': EditorTab,
};
