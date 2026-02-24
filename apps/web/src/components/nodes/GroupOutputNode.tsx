import React from 'react';
import { Position } from '@xyflow/react';
import { ReconnectableHandle } from './ReconnectableHandle';
import type { NodeProps } from '@xyflow/react';
import type { NodeSpec, PortSpec } from '../../store/types';
import { getPortColor } from './BaseNode';

export const GroupOutputNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const spec = data.spec as NodeSpec;

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
            <ReconnectableHandle
              nodeId={id}
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
          </div>
        ))}
      </div>
    </div>
  );
};
