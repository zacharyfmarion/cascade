import React, { useState, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { NodeSpec, PortSpec, ValueType } from '../../store/types';
import { useGraphStore } from '../../store/graphStore';
import { getPortColor } from './BaseNode';
import { AddPortForm, NodeButton } from './NodePrimitives';

const VALUE_TYPES: ValueType[] = ['Image', 'Mask', 'Float', 'Int', 'Bool', 'Color', 'Field'];

export const GroupOutputNode: React.FC<NodeProps> = ({ data, selected }) => {
  const spec = data.spec as NodeSpec;
  const [showAddForm, setShowAddForm] = useState(false);
  const updateGroupInterface = useGraphStore(s => s.updateGroupInterface);
  const editingStack = useGraphStore(s => s.editingStack);
  const isInsideGroup = editingStack.length > 1;

  const handleAddPort = useCallback((name: string, type: string) => {
    if (!isInsideGroup) return;
    const newPort: PortSpec = { name: name.toLowerCase().replace(/\s+/g, '_'), label: name, ty: type as ValueType };
    const currentOutputs = [...spec.inputs.map(i => ({ name: i.name, label: i.label, ty: i.ty })), newPort];
    updateGroupInterface(null, currentOutputs);
    setShowAddForm(false);
  }, [isInsideGroup, spec.inputs, updateGroupInterface]);

  const handleRemovePort = useCallback((portName: string) => {
    if (!isInsideGroup) return;
    const remainingOutputs = spec.inputs
      .filter(i => i.name !== portName)
      .map(i => ({ name: i.name, label: i.label, ty: i.ty }));
    updateGroupInterface(null, remainingOutputs);
  }, [isInsideGroup, spec.inputs, updateGroupInterface]);

  return (
    <div
      className={`base-node${selected ? ' base-node--selected' : ''}`}
      style={{ minWidth: '160px', maxWidth: '200px' }}
    >
      <div
        className="base-node__header"
        style={{ background: 'var(--node-header-groupOutput)' }}
      >
        <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>◀</span>
        <span className="base-node__title">Group Output</span>
      </div>

      <div className="base-node__body">
        {spec.inputs.map((input: PortSpec) => (
          <div key={input.name} className="node-port" style={{ gap: 4 }}>
            <Handle
              type="target"
              position={Position.Left}
              id={input.name}
              className="node-port__handle"
              style={{
                background: getPortColor(input.ty),
                left: '-11px',
              }}
              title={`${input.label} (${input.ty})`}
            />
            <span className="node-port__label" style={{ flex: 1 }}>
              {input.label}
            </span>
            <button
              type="button"
              className="node-port__remove"
              onClick={() => handleRemovePort(input.name)}
              title={`Remove ${input.label}`}
            >
              ×
            </button>
          </div>
        ))}

        {!showAddForm && (
          <NodeButton
            onClick={() => setShowAddForm(true)}
            variant="dashed"
            fullWidth
          >
            + Add Input
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
