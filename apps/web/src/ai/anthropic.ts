import { isDesktopRuntime } from '../platform/runtime';

export const ANTHROPIC_PROXY_BASE_URL = '/api/anthropic/v1';
export const ANTHROPIC_PROXY_MESSAGES_URL = `${ANTHROPIC_PROXY_BASE_URL}/messages`;
export const ANTHROPIC_DIRECT_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

export type AnthropicProviderSettings = {
  apiKey: string;
  baseURL?: string;
};

export type AnthropicMessagesRequest = {
  url: string;
  headers: Record<string, string>;
};

export function createAnthropicProviderSettings(
  apiKey: string,
  desktop = isDesktopRuntime(),
): AnthropicProviderSettings {
  return desktop ? { apiKey } : { apiKey, baseURL: ANTHROPIC_PROXY_BASE_URL };
}

export function createAnthropicMessagesRequest(
  apiKey: string,
  desktop = isDesktopRuntime(),
): AnthropicMessagesRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  if (desktop) {
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }

  return {
    url: desktop ? ANTHROPIC_DIRECT_MESSAGES_URL : ANTHROPIC_PROXY_MESSAGES_URL,
    headers,
  };
}
