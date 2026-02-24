import React, { useCallback, useRef } from 'react';
import { Handle } from '@xyflow/react';
import type { HandleProps } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';

/**
 * A Handle wrapper that implements Nuke-style "steal connection" behavior.
 * When the user drags from an input (target) handle that already has a connection,
 * the existing edge is disconnected and React Flow's normal connection drag
 * proceeds from that input — so the user can plug it into a different source.
 */
export const ReconnectableHandle: React.FC<HandleProps & { nodeId: string }> = ({
  nodeId,
  ...handleProps
}) => {
  const handleRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback(
    (_e: React.MouseEvent) => {
      // Only intercept target (input) handles
      if (handleProps.type !== 'target') return;

      const handleId = handleProps.id;
      if (!handleId) return;

      const { connections, disconnect } = useGraphStore.getState();
      const existing = connections.find(
        (c) => c.toNode === nodeId && c.toPort === handleId
      );

      // No existing connection — let React Flow handle it normally (new connection)
      if (!existing) return;

      // Disconnect the existing edge. Don't stop propagation — let React Flow's
      // default mousedown proceed so it starts a normal connection drag from
      // this target handle.
      disconnect(existing.id);
    },
    [nodeId, handleProps.type, handleProps.id]
  );

  return (
    <Handle
      ref={handleRef}
      {...handleProps}
      onMouseDown={onMouseDown}
    />
  );
};
