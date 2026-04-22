import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAnalyticsDebugState,
  instrumentPostHogClient,
  recordAnalyticsCapture,
  resetAnalyticsDebugForTests,
  updateAnalyticsBootstrap,
} from '../debug';

describe('analytics debug surface', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      configurable: true,
    });
    resetAnalyticsDebugForTests();
  });

  it('enables verbose mode from the debug query param', () => {
    Object.defineProperty(globalThis, 'location', {
      value: { search: '?__cascade_analytics_debug=true' },
      configurable: true,
    });

    const state = getAnalyticsDebugState();

    expect(state.enabled).toBe(true);
  });

  it('records bootstrap state and captured events on the window global', () => {
    updateAnalyticsBootstrap({
      analyticsEnabled: true,
      keyPresent: true,
      hostPresent: true,
      host: 'https://us.i.posthog.com',
    });
    recordAnalyticsCapture('runtime.track', 'node added', { node_type_id: 'curves' }, true);

    const snapshot = getAnalyticsDebugState().getSnapshot();
    expect(snapshot.bootstrap.analyticsEnabled).toBe(true);
    expect(snapshot.bootstrap.host).toBe('https://us.i.posthog.com');
    expect(snapshot.captures).toHaveLength(1);
    expect(snapshot.captures[0]).toMatchObject({
      source: 'runtime.track',
      eventName: 'node added',
      allowed: true,
    });
  });

  it('records PostHog send-request attempts and responses when instrumented', () => {
    const callback = vi.fn();
    const client: {
      init: (token: string, config: Record<string, unknown>) => void;
      capture: (eventName: string, properties?: Record<string, unknown>) => void;
      identify: (distinctId: string) => void;
      register: (properties: Record<string, unknown>) => void;
      opt_in_capturing: (options?: Record<string, unknown>) => void;
      opt_out_capturing: () => void;
      _send_request?: (request: {
        url?: string;
        method?: string;
        transport?: string;
        data?: Record<string, unknown>;
        callback?: (response: { statusCode: number }) => void;
      }) => void;
    } = {
      init: vi.fn((_: string, __: Record<string, unknown>) => {
        client._send_request = vi.fn((request: { callback?: (response: { statusCode: number }) => void }) => {
          request.callback?.({ statusCode: 200 });
        });
      }),
      capture: vi.fn(),
      identify: vi.fn(),
      register: vi.fn(),
      opt_in_capturing: vi.fn(),
      opt_out_capturing: vi.fn(),
      _send_request: undefined,
    };

    instrumentPostHogClient(client);
    client.init('token', { api_host: 'https://us.i.posthog.com' });
    client.capture('app opened', { runtime_surface: 'web' });
    client._send_request?.({
      url: 'https://us.i.posthog.com/e/',
      method: 'POST',
      transport: 'sendBeacon',
      data: { event: 'app opened' },
      callback,
    });

    const snapshot = getAnalyticsDebugState().getSnapshot();
    expect(snapshot.captures.some(capture => capture.eventName === 'app opened')).toBe(true);
    expect(snapshot.requests).toHaveLength(2);
    expect(snapshot.requests[0]).toMatchObject({
      stage: 'attempt',
      url: 'https://us.i.posthog.com/e/',
      method: 'POST',
      transport: 'sendBeacon',
      hasData: true,
    });
    expect(snapshot.requests[1]).toMatchObject({
      stage: 'response',
      statusCode: 200,
    });
    expect(callback).toHaveBeenCalledWith({ statusCode: 200 });
  });
});
