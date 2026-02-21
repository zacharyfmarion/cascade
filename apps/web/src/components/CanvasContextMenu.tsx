import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import type { NodeSpec } from '../store/types';
import { useGraphStore } from '../store/graphStore';

export type ContextMenuState =
  | { type: 'pane'; x: number; y: number }
  | { type: 'selection'; x: number; y: number; nodeIds: string[] };

interface CanvasContextMenuProps {
  menu: ContextMenuState;
  nodeSpecs: NodeSpec[];
  onAddNode: (typeId: string) => void;
  onFrameSelection: (nodeIds: string[]) => void;
  onClose: () => void;
}

const menuContainerStyle: React.CSSProperties = {
  position: 'fixed',
  width: 250,
  maxHeight: 400,
  backgroundColor: 'var(--bg-secondary)',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  boxShadow: 'var(--shadow-contextMenu)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  zIndex: 1000,
};

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  border: 'none',
  background: 'transparent',
  textAlign: 'left',
  padding: '6px 12px',
  cursor: 'pointer',
  fontSize: '0.85rem',
  color: 'var(--text-primary)',
  transition: 'background-color 0.1s',
  fontFamily: 'inherit',
};

const menuItemHover = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.backgroundColor = 'var(--bg-surface)';
  e.currentTarget.style.color = 'var(--accent-primary)';
};

const menuItemLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.backgroundColor = 'transparent';
  e.currentTarget.style.color = 'var(--text-primary)';
};

const disabledItemStyle: React.CSSProperties = {
  ...menuItemStyle,
  color: 'var(--text-muted)',
  cursor: 'default',
};

const MenuItem: React.FC<{
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}> = ({ label, shortcut, disabled, onClick }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    style={disabled ? disabledItemStyle : menuItemStyle}
    onMouseEnter={disabled ? undefined : menuItemHover}
    onMouseLeave={disabled ? undefined : menuItemLeave}
  >
    <span style={{ flex: 1 }}>{label}</span>
    {shortcut && (
      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 12 }}>
        {shortcut}
      </span>
    )}
  </button>
);

const Separator: React.FC = () => (
  <div style={{ height: 1, backgroundColor: 'var(--border-default)', margin: '4px 0' }} />
);

const SelectionMenu: React.FC<{
  nodeIds: string[];
  onFrameSelection: (nodeIds: string[]) => void;
  onClose: () => void;
}> = ({ nodeIds, onFrameSelection, onClose }) => {
  const createGroup = useGraphStore(s => s.createGroup);
  const ungroupNode = useGraphStore(s => s.ungroupNode);
  const enterGroup = useGraphStore(s => s.enterGroup);
  const removeNode = useGraphStore(s => s.removeNode);
  const toggleMuteSelected = useGraphStore(s => s.toggleMuteSelected);
  const nodes = useGraphStore(s => s.nodes);

  const hasMultiple = nodeIds.length >= 2;
  const singleNode = nodeIds.length === 1 ? nodes.get(nodeIds[0]) : null;
  const isGroupNode = singleNode?.typeId.startsWith('group::') ?? false;
  const allMuted = nodeIds.every(id => nodes.get(id)?.muted);

  const UNMUTABLE_TYPES = new Set([
    'load_image', 'load_image_sequence', 'load_video',
    'viewer', 'export_image', 'export_image_sequence', 'export_video',
    'group_input', 'group_output',
  ]);
  const canMute = nodeIds.some(id => {
    const node = nodes.get(id);
    return node && !UNMUTABLE_TYPES.has(node.typeId);
  });

  const handleGroup = useCallback(() => {
    createGroup(nodeIds);
    onClose();
  }, [createGroup, nodeIds, onClose]);

  const handleFrameSelection = useCallback(() => {
    onFrameSelection(nodeIds);
    onClose();
  }, [onFrameSelection, nodeIds, onClose]);

  const handleUngroup = useCallback(() => {
    if (singleNode) {
      ungroupNode(singleNode.id);
    }
    onClose();
  }, [ungroupNode, singleNode, onClose]);

  const handleEnterGroup = useCallback(() => {
    if (singleNode) {
      enterGroup(singleNode.id);
    }
    onClose();
  }, [enterGroup, singleNode, onClose]);

  const handleMute = useCallback(() => {
    toggleMuteSelected();
    onClose();
  }, [toggleMuteSelected, onClose]);

  const handleDelete = useCallback(() => {
    for (const id of nodeIds) {
      removeNode(id);
    }
    onClose();
  }, [removeNode, nodeIds, onClose]);

  return (
    <div style={{ padding: '4px 0' }}>
      <MenuItem
        label="Group"
        shortcut="⌘G"
        disabled={!hasMultiple}
        onClick={handleGroup}
      />
      <MenuItem
        label="Frame Selection"
        shortcut="F"
        disabled={nodeIds.length === 0}
        onClick={handleFrameSelection}
      />
      <MenuItem
        label="Ungroup"
        shortcut="⌘⌥G"
        disabled={!isGroupNode}
        onClick={handleUngroup}
      />
      <MenuItem
        label="Enter Group"
        shortcut="Tab"
        disabled={!isGroupNode}
        onClick={handleEnterGroup}
      />
      <Separator />
      <MenuItem
        label={allMuted ? 'Unmute' : 'Mute'}
        shortcut="M"
        disabled={!canMute}
        onClick={handleMute}
      />
      <MenuItem
        label={nodeIds.length > 1 ? `Delete ${nodeIds.length} Nodes` : 'Delete Node'}
        shortcut="⌫"
        onClick={handleDelete}
      />
    </div>
  );
};

const AddNodeMenu: React.FC<{
  nodeSpecs: NodeSpec[];
  onAddNode: (typeId: string) => void;
}> = ({ nodeSpecs, onAddNode }) => {
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  const groupedNodes = useMemo(() => {
    const groups: Record<string, NodeSpec[]> = {};
    const lowerSearch = search.toLowerCase();

    nodeSpecs.forEach(spec => {
      if (lowerSearch && !spec.display_name.toLowerCase().includes(lowerSearch)) return;
      if (!groups[spec.category]) groups[spec.category] = [];
      groups[spec.category].push(spec);
    });

    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [nodeSpecs, search]);

  return (
    <>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border-default)' }}>
        <input
          ref={searchInputRef}
          placeholder="Search nodes..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-default)',
            borderRadius: 4,
            padding: '6px 8px',
            color: 'var(--text-primary)',
            outline: 'none',
            fontSize: '0.85rem',
          }}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              const allSpecs = groupedNodes.flatMap(([, specs]) => specs);
              if (allSpecs.length > 0) {
                onAddNode(allSpecs[0].id);
              }
            }
          }}
        />
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {groupedNodes.length === 0 && (
          <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
            No nodes found
          </div>
        )}
        {groupedNodes.map(([category, specs]) => (
          <div key={category}>
            <div
              style={{
                padding: '8px 12px 4px',
                fontSize: '0.7rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                letterSpacing: '0.05em',
              }}
            >
              {category}
            </div>
            {specs.map(spec => (
              <MenuItem
                key={spec.id}
                label={spec.display_name}
                onClick={() => onAddNode(spec.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </>
  );
};

export const CanvasContextMenu = React.forwardRef<HTMLDivElement, CanvasContextMenuProps>(
  ({ menu, nodeSpecs, onAddNode, onFrameSelection, onClose }, ref) => {
    return (
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        className="nopan nodrag"
        style={{ ...menuContainerStyle, left: menu.x, top: menu.y }}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
          e.stopPropagation();
        }}
      >
      {menu.type === 'pane' ? (
          <AddNodeMenu nodeSpecs={nodeSpecs} onAddNode={onAddNode} />
      ) : (
        <SelectionMenu nodeIds={menu.nodeIds} onFrameSelection={onFrameSelection} onClose={onClose} />
      )}
      </div>
    );
  }
);

CanvasContextMenu.displayName = 'CanvasContextMenu';
