export const ANTHROPIC_PROXY_BASE_URL = '/api/anthropic/v1';
export const ANTHROPIC_PROXY_MESSAGES_URL = `${ANTHROPIC_PROXY_BASE_URL}/messages`;
export const ANTHROPIC_DIRECT_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_BROWSER_ACCESS_HEADER = 'anthropic-dangerous-direct-browser-access';

export type AnthropicProviderSettings = {
  apiKey: string;
  baseURL?: string;
  headers?: Record<string, string>;
};

export type AnthropicMessagesRequest = {
  url: string;
  headers: Record<string, string>;
};

export function createAnthropicProviderSettings(
  apiKey: string,
  dev = import.meta.env.DEV,
): AnthropicProviderSettings {
  if (dev) {
    return {
      apiKey,
      baseURL: ANTHROPIC_PROXY_BASE_URL,
      headers: { [ANTHROPIC_BROWSER_ACCESS_HEADER]: 'true' },
    };
  }

  return {
    apiKey,
    headers: { [ANTHROPIC_BROWSER_ACCESS_HEADER]: 'true' },
  };
}

export function createAnthropicMessagesRequest(
  apiKey: string,
  dev = import.meta.env.DEV,
): AnthropicMessagesRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  headers[ANTHROPIC_BROWSER_ACCESS_HEADER] = 'true';

  return {
    url: dev ? ANTHROPIC_PROXY_MESSAGES_URL : ANTHROPIC_DIRECT_MESSAGES_URL,
    headers,
  };
}
