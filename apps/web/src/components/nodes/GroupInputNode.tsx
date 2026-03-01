import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { NodeSpec, PortSpec } from '../../store/types';
import { getPortColor } from './BaseNode';
import { ADD_OUTPUT_PORT } from '../../store/graphStore';

export const GroupInputNode: React.FC<NodeProps> = ({ data, selected }) => {
  const spec = data.spec as NodeSpec;

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
        {spec.outputs.map((output: PortSpec) => {
          const isAddPort = output.name === ADD_OUTPUT_PORT;
          return (
            <div key={output.name} className="node-port node-port--output" style={{ gap: 4 }}>
              <span
                className="node-port__label"
                style={isAddPort ? { opacity: 0.45, fontStyle: 'italic' } : undefined}
              >
                {output.label}
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={output.name}
                className="node-port__handle"
                style={isAddPort ? {
                  right: '-11px',
                  background: 'transparent',
                  border: '2px dashed var(--text-muted)',
                  width: '10px',
                  height: '10px',
                } : {
                  background: getPortColor(output.ty),
                  right: '-11px',
                }}
                title={isAddPort ? 'Connect to add a new input' : `${output.label} (${output.ty})`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
