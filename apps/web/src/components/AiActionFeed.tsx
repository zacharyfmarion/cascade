import React from 'react';

interface ToolAction {
  toolCallId: string;
  toolName: string;
  state: string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
}

const ACTION_LABELS: Record<string, (input?: Record<string, unknown>) => { pending: string; done: string }> = {
  inspect_graph: () => ({
    pending: 'Inspecting graph...',
    done: 'Inspected graph',
  }),
  get_node_spec: (input) => ({
    pending: `Looking up ${input?.typeId ?? 'node'} spec...`,
    done: `Looked up ${input?.typeId ?? 'node'} spec`,
  }),
  list_node_types: () => ({
    pending: 'Listing node types...',
    done: 'Listed node types',
  }),
  add_node: (input) => ({
    pending: `Adding ${input?.typeId ?? 'node'}...`,
    done: `Added ${input?.typeId ?? 'node'}`,
  }),
  remove_node: () => ({
    pending: 'Removing node...',
    done: 'Removed node',
  }),
  connect: (input) => ({
    pending: `Connecting ${input?.fromNode ?? '?'} → ${input?.toNode ?? '?'}...`,
    done: `Connected ${input?.fromNode ?? '?'} → ${input?.toNode ?? '?'}`,
  }),
  disconnect: () => ({
    pending: 'Disconnecting...',
    done: 'Disconnected',
  }),
  set_param: (input) => ({
    pending: `Setting ${input?.paramKey ?? 'param'}...`,
    done: `Set ${input?.paramKey ?? 'param'}`,
  }),
  insert_node: (input) => ({
    pending: `Inserting ${input?.typeId ?? 'node'}...`,
    done: `Inserted ${input?.typeId ?? 'node'}`,
  }),
  duplicate_node: () => ({
    pending: 'Duplicating node...',
    done: 'Duplicated node',
  }),
};

const isCompleted = (state: string): boolean =>
  state === 'output-available' || state === 'output-error' || state === 'output-denied';

const isError = (action: ToolAction): boolean =>
  action.state === 'output-error' || action.state === 'output-denied';

const getLabel = (action: ToolAction): string => {
  const labelFn = ACTION_LABELS[action.toolName];
  if (!labelFn) {
    return isCompleted(action.state) ? `✓ ${action.toolName}` : `⏳ ${action.toolName}...`;
  }
  const labels = labelFn(action.input);
  if (isCompleted(action.state)) {
    return isError(action) ? `✗ ${labels.done}` : `✓ ${labels.done}`;
  }
  return `⏳ ${labels.pending}`;
};

interface AiActionFeedProps {
  actions: ToolAction[];
}

export const AiActionFeed: React.FC<AiActionFeedProps> = ({ actions }) => {
  if (actions.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      padding: '4px 0',
      fontSize: '0.7rem',
      color: 'var(--text-muted)',
      fontFamily: 'monospace',
    }}>
      {actions.map((action) => (
          <div
            key={action.toolCallId}
            style={{
              color: isError(action) ? 'var(--status-error)' : isCompleted(action.state) ? 'var(--text-muted)' : 'var(--text-secondary)',
              lineHeight: 1.4,
            }}
          >
            {getLabel(action)}
          </div>
      ))}
    </div>
  );
};

export type { ToolAction };
