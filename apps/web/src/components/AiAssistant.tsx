import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chat, useChat } from '@ai-sdk/react';
import { isToolUIPart, getToolName } from 'ai';
import { getAuthoringNodeSpecs } from '../platform/features';
import { getRuntimeSurface } from '../platform/runtime';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { createCascadeTransport } from '../ai/transport';
import { captureViewerThumbnail } from '../ai/viewerSnapshot';
import { AiActionItem } from './AiActionFeed';
import type { ToolAction } from './AiActionFeed';
import { MarkdownMessage } from './MarkdownMessage';

interface AiAssistantProps {
  isOpen: boolean;
  onToggle: () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

type ToolUiPart = Parameters<typeof getToolName>[0];

const toToolAction = (part: ToolUiPart): ToolAction => {
  const input = 'input' in part && isRecord(part.input) ? part.input : undefined;
  const output = 'output' in part ? part.output : undefined;
  const errorText = 'errorText' in part && typeof part.errorText === 'string' ? part.errorText : undefined;
  return {
    toolCallId: part.toolCallId,
    toolName: getToolName(part),
    state: part.state,
    input,
    output,
    errorText,
  };
};

export const AiAssistant: React.FC<AiAssistantProps> = ({ isOpen, onToggle }) => {
  const apiKey = useSettingsStore(s => s.anthropicApiKey);
  const model = useSettingsStore(s => s.aiAssistantModel);
  const openSettings = useSettingsStore(s => s.openSettings);
  const nodeSpecs = useGraphStore(s => s.nodeSpecs);
  const runtimeSurface = getRuntimeSurface();
  const authoringNodeSpecs = useMemo(
    () => getAuthoringNodeSpecs(nodeSpecs, runtimeSurface),
    [nodeSpecs, runtimeSurface],
  );
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(() => {
    if (!apiKey) return null;
    return createCascadeTransport(apiKey, model, authoringNodeSpecs);
  }, [apiKey, model, authoringNodeSpecs]);

  const chat = useMemo(() => {
    if (!transport) return null;
    return new Chat({ transport });
  }, [transport]);

  const chatOptions = useMemo(() => (chat ? { chat } : undefined), [chat]);
  const { messages, sendMessage, status, stop, error } = useChat(chatOptions);

  const isConfigured = Boolean(apiKey);
  const isLoading = status === 'submitted' || status === 'streaming';

  // Safety net: if AI finishes with error/abort and onFinish didn't fire,
  // ensure the render barrier is released
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    const wasLoading = prev === 'submitted' || prev === 'streaming';
    if (wasLoading && !isLoading) {
      const store = useGraphStore.getState();
      if (store.aiActionInProgress) {
        store.endAiAction();
      }
    }
  }, [status, isLoading]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && messages.length > 0) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !isConfigured || isLoading) return;

    const thumbnail = captureViewerThumbnail();

    if (thumbnail) {
      sendMessage({
        text: input.trim(),
        files: [{ type: 'file', mediaType: 'image/jpeg', url: thumbnail }],
      });
    } else {
      sendMessage({ text: input.trim() });
    }

    setInput('');
  }, [input, isConfigured, isLoading, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggle}
        style={{
          position: 'absolute',
          bottom: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 50,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-default)',
          borderRadius: '16px',
          padding: '6px 14px',
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          boxShadow: '0 2px 8px var(--shadow-overlay)',
        }}
      >
        ✦ AI
      </button>
    );
  }

  return (
    <div style={{
      position: 'absolute',
      bottom: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 50,
      width: '560px',
      maxHeight: '400px',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-default)',
      borderRadius: '8px',
      boxShadow: '0 4px 16px var(--shadow-overlay)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        borderBottom: '1px solid var(--border-default)',
        fontSize: '0.7rem',
        color: 'var(--text-muted)',
      }}>
        <span>AI Assistant</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            color: error ? 'var(--status-error)' : isLoading ? 'var(--accent-primary)' : 'var(--text-muted)',
          }}>
            {error ? 'Error' : isLoading ? 'Thinking...' : 'Ready'}
          </span>
          <button
            type="button"
            onClick={onToggle}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '0.8rem',
              padding: '2px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          minHeight: '100px',
          maxHeight: '280px',
          userSelect: 'text',
          cursor: 'auto',
        }}
      >
        {!isConfigured && (
          <div style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            textAlign: 'center',
            padding: '20px 0',
          }}>
            Set your Anthropic API key in{' '}
            <button
              type="button"
              onClick={() => openSettings('ai')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-primary)',
                cursor: 'pointer',
                fontSize: 'inherit',
                fontFamily: 'inherit',
                padding: 0,
                textDecoration: 'underline',
              }}
            >
              Settings → AI
            </button>
            {' '}to get started.
          </div>
        )}


        {isConfigured && messages.length === 0 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px 16px 16px',
            gap: '16px',
            flex: 1,
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
            }}>
              <span style={{
                fontSize: '1.2rem',
                opacity: 0.5,
                lineHeight: 1,
              }}>
                ✦
              </span>
              <span style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
              }}>
                What would you like to build?
              </span>
            </div>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              justifyContent: 'center',
            }}>
              {[
                'Add a gaussian blur to the selected node',
                'Create a color grading pipeline',
                'Set up a composite with alpha over',
                'Build a sharpen and contrast workflow',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    const thumbnail = captureViewerThumbnail();
                    if (thumbnail) {
                      sendMessage({
                        text: suggestion,
                        files: [{ type: 'file', mediaType: 'image/jpeg', url: thumbnail }],
                      });
                    } else {
                      sendMessage({ text: suggestion });
                    }
                  }}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-default)',
                    borderRadius: '12px',
                    padding: '4px 10px',
                    fontSize: '0.7rem',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'border-color 0.15s, color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-primary)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-default)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === 'user') {
            const textContent = (msg.parts ?? [])
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map(p => p.text)
              .join('');
            return (
              <div key={msg.id} style={{
                fontSize: '0.75rem',
                color: 'var(--text-primary)',
                padding: '6px 10px',
                background: 'var(--bg-surface)',
                borderRadius: '6px',
                alignSelf: 'flex-end',
                maxWidth: '85%',
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
              }}>
                {textContent}
              </div>
            );
          }

          if (msg.role === 'assistant') {
            return (
              <div key={msg.id} style={{
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                maxWidth: '95%',
              }}>
                {(msg.parts ?? []).map((part) => {
                  const partKey = part.type === 'text'
                    ? `${msg.id}-text-${part.text ?? ''}`
                    : isToolUIPart(part)
                      ? part.toolCallId
                      : `${msg.id}-${part.type}`;
                  if (part.type === 'text' && part.text) {
                    return (
                      <div key={partKey} className="ai-markdown" style={{
                        wordBreak: 'break-word',
                        lineHeight: 1.5,
                      }}>
                        <MarkdownMessage content={part.text} />
                      </div>
                    );
                  }
                  if (isToolUIPart(part)) {
                    return <AiActionItem key={partKey} action={toToolAction(part)} />;
                  }
                  return null;
                })}
              </div>
            );
          }

          return null;
        })}

        {error && (
          <div style={{
            fontSize: '0.7rem',
            color: 'var(--status-error)',
            padding: '4px 8px',
            background: 'var(--bg-surface)',
            borderRadius: '4px',
          }}>
            {error.message}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{
        display: 'flex',
        gap: '6px',
        padding: '8px 12px',
        borderTop: '1px solid var(--border-default)',
      }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConfigured ? 'Describe what you want to build...' : 'API key required'}
          disabled={!isConfigured}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-default)',
            borderRadius: '4px',
            padding: '6px 8px',
            fontSize: '0.75rem',
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            outline: 'none',
            minHeight: '28px',
            maxHeight: '80px',
          }}
        />
        {isLoading ? (
          <button
            type="button"
            onClick={() => stop()}
            style={{
              background: 'var(--status-error)',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 12px',
              fontSize: '0.7rem',
              color: 'var(--bg-primary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || !isConfigured}
            style={{
              background: input.trim() && isConfigured ? 'var(--accent-primary)' : 'var(--bg-surface)',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 12px',
              fontSize: '0.7rem',
              color: input.trim() && isConfigured ? 'var(--bg-primary)' : 'var(--text-muted)',
              cursor: input.trim() && isConfigured ? 'pointer' : 'default',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
};
