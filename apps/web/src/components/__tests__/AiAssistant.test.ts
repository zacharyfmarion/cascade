// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { AiAssistant } from '../AiAssistant';
import { useGraphStore } from '../../store/graphStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { NodeSpec } from '../../store/types';

const createdChats = vi.hoisted(() => [] as Array<{
  messages: Array<{ id: string; role: string; parts: Array<{ type: string; text: string }> }>;
  status: string;
  error: Error | undefined;
  sendMessage: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}>);

const transportMocks = vi.hoisted(() => ({
  createCascadeTransport: vi.fn((apiKey: string, model: string, nodeSpecs: NodeSpec[]) => ({
    apiKey,
    model,
    nodeSpecs,
  })),
}));

vi.mock('../../ai/transport', () => ({
  createCascadeTransport: transportMocks.createCascadeTransport,
}));

vi.mock('../../ai/viewerSnapshot', () => ({
  captureViewerThumbnail: vi.fn(() => null),
}));

vi.mock('@ai-sdk/react', () => {
  class MockChat {
    messages: Array<{ id: string; role: string; parts: Array<{ type: string; text: string }> }> = [];
    status = 'ready';
    error: Error | undefined;
    sendMessage = vi.fn();
    stop = vi.fn();

    constructor() {
      createdChats.push(this);
    }
  }

  return {
    Chat: MockChat,
    useChat: (options?: { chat?: MockChat }) => {
      const chat = options?.chat;
      return {
        messages: chat?.messages ?? [],
        sendMessage: chat?.sendMessage ?? vi.fn(),
        status: chat?.status ?? 'ready',
        stop: chat?.stop ?? vi.fn(),
        error: chat?.error,
      };
    },
  };
});

vi.mock('ai', () => ({
  isToolUIPart: vi.fn(() => false),
  getToolName: vi.fn(() => 'unknown'),
}));

const blurSpec: NodeSpec = {
  id: 'gaussian_blur',
  display_name: 'Gaussian Blur',
  category: 'Filter',
  description: 'Blur an image',
  inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  params: [],
};

const viewerSpec: NodeSpec = {
  id: 'viewer',
  display_name: 'Viewer',
  category: 'Output',
  description: 'View result',
  inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  outputs: [],
  params: [],
};

describe('AiAssistant', () => {
  let testId = 0;

  beforeEach(() => {
    testId += 1;
    createdChats.length = 0;
    transportMocks.createCascadeTransport.mockClear();
    useSettingsStore.setState({
      anthropicApiKey: 'test-key',
      aiAssistantModel: `claude-test-${testId}`,
    });
    useGraphStore.setState({
      nodeSpecs: [blurSpec],
      projectSessionRevision: 0,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the current chat when node specs change after a conversation has started', async () => {
    render(React.createElement(AiAssistant, { isOpen: true, onToggle: vi.fn() }));
    expect(createdChats).toHaveLength(1);

    createdChats[0].messages = [{
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'keep this visible' }],
    }];

    act(() => {
      useGraphStore.setState({ nodeSpecs: [blurSpec, viewerSpec] });
    });

    expect(createdChats).toHaveLength(1);
    expect(await screen.findByText('keep this visible')).toBeTruthy();
  });

  it('refreshes the chat before the first message when specs finish loading', () => {
    render(React.createElement(AiAssistant, { isOpen: true, onToggle: vi.fn() }));
    expect(createdChats).toHaveLength(1);

    act(() => {
      useGraphStore.setState({ nodeSpecs: [blurSpec, viewerSpec] });
    });

    expect(createdChats).toHaveLength(2);
  });

  it('resets the chat when the project session changes', async () => {
    render(React.createElement(AiAssistant, { isOpen: true, onToggle: vi.fn() }));
    expect(createdChats).toHaveLength(1);

    createdChats[0].messages = [{
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'old project request' }],
    }];

    act(() => {
      useGraphStore.setState({ projectSessionRevision: 1 });
    });

    expect(createdChats).toHaveLength(2);
    expect(screen.queryByText('old project request')).toBeNull();
    expect(await screen.findByText('What would you like to build?')).toBeTruthy();
  });
});
