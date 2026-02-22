import { createAnthropic } from '@ai-sdk/anthropic';
import { ToolLoopAgent, DirectChatTransport } from 'ai';
import type { NodeSpec } from '../store/types';
import { compositorTools } from './tools';
import { buildSystemPrompt } from './systemPrompt';
import { useGraphStore } from '../store/graphStore';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function createCompositorTransport(
  apiKey: string,
  model: string,
  nodeSpecs: NodeSpec[],
) {
  const anthropic = createAnthropic({
    apiKey,
    baseURL: isTauri() ? undefined : '/api/anthropic/v1',
    headers: isTauri() ? undefined : { 'anthropic-dangerous-direct-browser-access': 'true' },
  });

  const agent = new ToolLoopAgent({
    model: anthropic(model),
    instructions: buildSystemPrompt(nodeSpecs),
    tools: compositorTools,
    experimental_onStart: async () => {
      await useGraphStore.getState().beginAiAction();
    },
    onFinish: () => {
      useGraphStore.getState().endAiAction();
    },
  });

  return new DirectChatTransport({ agent });
}
