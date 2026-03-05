import { createAnthropic } from '@ai-sdk/anthropic';
import { ToolLoopAgent, DirectChatTransport } from 'ai';
import type { NodeSpec } from '../store/types';
import { cascadeTools } from './tools';
import { buildSystemPrompt } from './systemPrompt';
import { useGraphStore } from '../store/graphStore';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function createCascadeTransport(
  apiKey: string,
  model: string,
  nodeSpecs: NodeSpec[],
) {
  const anthropic = createAnthropic({
    apiKey,
    // Anthropic supports direct browser access via the special header below.
    // No CORS proxy needed (unlike Replicate). Tauri calls the API directly
    // from Rust, so no baseURL override needed for desktop builds.
    headers: isTauri() ? undefined : { 'anthropic-dangerous-direct-browser-access': 'true' },
  });

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
