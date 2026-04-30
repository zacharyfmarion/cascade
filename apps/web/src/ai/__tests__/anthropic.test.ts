import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANTHROPIC_DIRECT_MESSAGES_URL,
  ANTHROPIC_BROWSER_ACCESS_HEADER,
  ANTHROPIC_PROXY_BASE_URL,
  ANTHROPIC_PROXY_MESSAGES_URL,
  createAnthropicMessagesRequest,
  createAnthropicProviderSettings,
} from '../anthropic';
import { generateGlslKernel } from '../gpuScript';

describe('Anthropic transport settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the local Vite proxy for dev chat requests', () => {
    expect(createAnthropicProviderSettings('test-key', true)).toEqual({
      apiKey: 'test-key',
      baseURL: ANTHROPIC_PROXY_BASE_URL,
      headers: { [ANTHROPIC_BROWSER_ACCESS_HEADER]: 'true' },
    });
  });

  it('keeps production chat requests on the direct browser-access endpoint', () => {
    expect(createAnthropicProviderSettings('test-key', false)).toEqual({
      apiKey: 'test-key',
      headers: { [ANTHROPIC_BROWSER_ACCESS_HEADER]: 'true' },
    });
  });

  it('routes dev message requests through the proxy with Anthropic browser-access headers', () => {
    const request = createAnthropicMessagesRequest('test-key', true);

    expect(request.url).toBe(ANTHROPIC_PROXY_MESSAGES_URL);
    expect(request.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
      [ANTHROPIC_BROWSER_ACCESS_HEADER]: 'true',
    });
  });

  it('keeps production message requests direct with Anthropic browser-access headers', () => {
    const request = createAnthropicMessagesRequest('test-key', false);

    expect(request.url).toBe(ANTHROPIC_DIRECT_MESSAGES_URL);
    expect(request.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
      [ANTHROPIC_BROWSER_ACCESS_HEADER]: 'true',
    });
  });

  it('uses the proxy path when generating GPU script kernels in web runtime', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{
          text: JSON.stringify({
            inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
            outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
            params: [],
            kernel: 'return color;',
          }),
        }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await generateGlslKernel('brighten image', 'test-key');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ANTHROPIC_PROXY_MESSAGES_URL);
    expect(init.headers).toHaveProperty(ANTHROPIC_BROWSER_ACCESS_HEADER, 'true');
  });
});
