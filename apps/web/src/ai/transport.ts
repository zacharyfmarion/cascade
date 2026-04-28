import { createAnthropic } from '@ai-sdk/anthropic';
import { ToolLoopAgent, DirectChatTransport } from 'ai';
import type { NodeSpec } from '../store/types';
import { cascadeTools } from './tools';
import { buildSystemPrompt } from './systemPrompt';
import { useGraphStore } from '../store/graphStore';
import { createAnthropicProviderSettings } from './anthropic';

export function createCascadeTransport(
  apiKey: string,
  model: string,
  nodeSpecs: NodeSpec[],
) {
  const anthropic = createAnthropic(createAnthropicProviderSettings(apiKey));

  const agent = new ToolLoopAgent({
    model: anthropic(model),
    instructions: buildSystemPrompt(nodeSpecs),
    tools: cascadeTools,
    experimental_onStart: async () => {
      await useGraphStore.getState().beginAiAction();
    },
    onFinish: () => {
      useGraphStore.getState().endAiAction();
    },
  });

  return new DirectChatTransport({ agent });
}
