import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { ReconnectableHandle } from './ReconnectableHandle';
import type { NodeProps } from '@xyflow/react';
import type { NodeSpec, PortSpec } from '../../store/types';
import { getPortColor } from './BaseNode';
import { ADD_INPUT_PORT } from '../../store/graphStore';

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
        {spec.inputs.map((input: PortSpec) => {
          const isAddPort = input.name === ADD_INPUT_PORT;
          if (isAddPort) {
            return (
              <div key={input.name} className="node-port" style={{ gap: 4 }}>
                <Handle
                  type="target"
                  position={Position.Left}
                  id={input.name}
                  className="node-port__handle"
                  style={{
                    left: '-11px',
                    background: 'transparent',
                    border: '2px dashed var(--text-muted)',
                    width: '10px',
                    height: '10px',
                  }}
                  title="Connect to add a new output"
                />
                <span
                  className="node-port__label"
                  style={{ flex: 1, opacity: 0.45, fontStyle: 'italic' }}
                >
                  {input.label}
                </span>
              </div>
            );
          }
          return (
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
          );
        })}
      </div>
    </div>
  );
};
