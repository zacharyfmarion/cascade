import React, { useState, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { NodeSpec, PortSpec, ValueType } from '../../store/types';
import { useGraphStore } from '../../store/graphStore';
import { getPortColor } from './BaseNode';
import { AddPortForm, NodeButton } from './NodePrimitives';

const VALUE_TYPES: ValueType[] = ['Image', 'Mask', 'Float', 'Int', 'Bool', 'Color', 'Field'];

export const GroupInputNode: React.FC<NodeProps> = ({ data, selected }) => {
  const spec = data.spec as NodeSpec;
  const [showAddForm, setShowAddForm] = useState(false);
  const updateGroupInterface = useGraphStore(s => s.updateGroupInterface);
  const editingStack = useGraphStore(s => s.editingStack);
  const isInsideGroup = editingStack.length > 1;

  const handleAddPort = useCallback((name: string, type: string) => {
    if (!isInsideGroup) return;
    const newPort: PortSpec = { name: name.toLowerCase().replace(/\s+/g, '_'), label: name, ty: type as ValueType };
    const currentInputs = [...spec.outputs.map(o => ({ name: o.name, label: o.label, ty: o.ty })), newPort];
    updateGroupInterface(currentInputs, null);
    setShowAddForm(false);
  }, [isInsideGroup, spec.outputs, updateGroupInterface]);

  const handleRemovePort = useCallback((portName: string) => {
    if (!isInsideGroup) return;
    const remainingInputs = spec.outputs
      .filter(o => o.name !== portName)
      .map(o => ({ name: o.name, label: o.label, ty: o.ty }));
    updateGroupInterface(remainingInputs, null);
  }, [isInsideGroup, spec.outputs, updateGroupInterface]);

  return (
    <div
      className={`base-node${selected ? ' base-node--selected' : ''}`}
      style={{ minWidth: '160px', maxWidth: '200px' }}
    >
      <div
        className="base-node__header"
        style={{ background: 'var(--node-header-groupInput)' }}
      >
        <span className="base-node__title">Group Input</span>
        <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>▶</span>
      </div>

      <div className="base-node__body">
        {spec.outputs.map((output: PortSpec) => (
          <div key={output.name} className="node-port node-port--output" style={{ gap: 4 }}>
            <button
              type="button"
              className="node-port__remove"
              onClick={() => handleRemovePort(output.name)}
              title={`Remove ${output.label}`}
            >
              ×
            </button>
            <span className="node-port__label">
              {output.label}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={output.name}
              className="node-port__handle"
              style={{
                background: getPortColor(output.ty),
                right: '-11px',
              }}
              title={`${output.label} (${output.ty})`}
            />
          </div>
        ))}

        {!showAddForm && (
          <NodeButton
            onClick={() => setShowAddForm(true)}
            variant="dashed"
            fullWidth
          >
            + Add Output
          </NodeButton>
        )}

        {showAddForm && (
          <AddPortForm
            onAdd={handleAddPort}
            onCancel={() => setShowAddForm(false)}
            availableTypes={VALUE_TYPES}
          />
        )}
      </div>
    </div>
  );
};
