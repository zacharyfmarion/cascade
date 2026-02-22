import React, { useState } from 'react';

interface ToolAction {
  toolCallId: string;
  toolName: string;
  state: string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
}

const ACTION_LABELS: Record<string, (input?: Record<string, unknown>) => { pending: string; done: string }> = {
  read_graph: () => ({
    pending: 'Reading graph...',
    done: 'Read graph',
  }),
  edit_graph: (input) => {
    const oldText = typeof input?.old_text === 'string' ? input.old_text : '';
    const preview = oldText.length > 40 ? oldText.substring(0, 40) + '…' : oldText;
    return {
      pending: `Editing graph${preview ? ` (${preview})` : ''}...`,
      done: `Edited graph${preview ? ` (${preview})` : ''}`,
    };
  },
  write_graph: () => ({
    pending: 'Writing graph...',
    done: 'Wrote graph',
  }),
  view_current_image: () => ({
    pending: 'Capturing viewer...',
    done: 'Captured viewer',
  }),
  get_node_types: () => ({
    pending: 'Listing node types...',
    done: 'Listed node types',
  }),
  // Legacy imperative tools (kept for backward compat)
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

function formatPayload(value: unknown): string {
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isImageOutput(output: unknown): output is { type: 'image'; data: string } {
  return (
    typeof output === 'object' &&
    output !== null &&
    'type' in output &&
    (output as Record<string, unknown>).type === 'image' &&
    'data' in output &&
    typeof (output as Record<string, unknown>).data === 'string'
  );
}

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
        <AiActionItem key={action.toolCallId} action={action} />
      ))}
    </div>
  );
};

interface AiActionItemProps {
  action: ToolAction;
}

export const AiActionItem: React.FC<AiActionItemProps> = ({ action }) => {
  const [expanded, setExpanded] = useState(false);
  const completed = isCompleted(action.state);
  const hasDetails = action.input !== undefined || action.output !== undefined || action.errorText;

  return (
    <div style={{ padding: '1px 0' }}>
      <div
        role={hasDetails ? 'button' : undefined}
        tabIndex={hasDetails ? 0 : undefined}
        onClick={hasDetails ? () => setExpanded(prev => !prev) : undefined}
        onKeyDown={hasDetails ? (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(prev => !prev);
          }
        } : undefined}
        style={{
          fontSize: '0.7rem',
          fontFamily: 'monospace',
          color: isError(action) ? 'var(--status-error)' : completed ? 'var(--text-muted)' : 'var(--text-secondary)',
          lineHeight: 1.4,
          cursor: hasDetails ? 'pointer' : 'default',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}>
        {hasDetails && (
          <span style={{
            display: 'inline-block',
            width: '8px',
            fontSize: '0.55rem',
            color: 'var(--text-muted)',
            flexShrink: 0,
          }}>
            {expanded ? '▼' : '▶'}
          </span>
        )}
        <span>{getLabel(action)}</span>
      </div>

      {expanded && hasDetails && (
        <div style={{
          marginTop: '2px',
          marginLeft: '12px',
          padding: '6px 8px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-default)',
          borderRadius: '4px',
          fontSize: '0.65rem',
          lineHeight: 1.4,
          maxHeight: '200px',
          overflowY: 'auto',
          userSelect: 'text',
          cursor: 'auto',
        }}>
          {action.input !== undefined && Object.keys(action.input).length > 0 && (
            <div>
              <div style={{
                color: 'var(--text-muted)',
                marginBottom: '2px',
                fontWeight: 600,
                fontSize: '0.6rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                Input
              </div>
              <pre style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                color: 'var(--text-secondary)',
                fontFamily: 'monospace',
              }}>
                {formatPayload(action.input)}
              </pre>
            </div>
          )}

          {action.output !== undefined && (
            <div style={{ marginTop: action.input ? '6px' : 0 }}>
              <div style={{
                color: isError(action) ? 'var(--status-error)' : 'var(--text-muted)',
                marginBottom: '2px',
                fontWeight: 600,
                fontSize: '0.6rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                Output
              </div>
              {isImageOutput(action.output) ? (
                <img
                  src={`data:image/jpeg;base64,${(action.output as { data: string }).data}`}
                  alt="Viewer capture"
                  style={{
                    maxWidth: '100%',
                    borderRadius: '3px',
                    display: 'block',
                  }}
                />
              ) : (
                <pre style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: isError(action) ? 'var(--status-error)' : 'var(--text-secondary)',
                  fontFamily: 'monospace',
                }}>
                  {formatPayload(action.output)}
                </pre>
              )}
            </div>
          )}

          {action.errorText && (
            <div style={{ marginTop: action.input || action.output ? '6px' : 0 }}>
              <div style={{
                color: 'var(--status-error)',
                marginBottom: '2px',
                fontWeight: 600,
                fontSize: '0.6rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                Error
              </div>
              <pre style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                color: 'var(--status-error)',
                fontFamily: 'monospace',
              }}>
                {action.errorText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export type { ToolAction };
