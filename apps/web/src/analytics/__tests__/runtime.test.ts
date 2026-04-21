import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnalyticsApi } from '../runtime';

function createMockClient() {
  return {
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    register: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  };
}

describe('analytics runtime', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('tracks events only when analytics is enabled', () => {
    const client = createMockClient();
    const analytics = createAnalyticsApi({
      client,
      sharedProperties: { app_version: '0.1.0', runtime_surface: 'web', analytics_enabled: true },
      analyticsEnabled: true,
    });

    analytics.track('node added', {
      node_type_id: 'curves',
      category: 'Color',
      api_key: 'should-be-removed',
    });

    expect(client.capture).toHaveBeenCalledWith('node added', {
      app_version: '0.1.0',
      runtime_surface: 'web',
      analytics_enabled: true,
      node_type_id: 'curves',
      category: 'Color',
    });
  });

  it('does not track events when analytics is disabled', () => {
    const client = createMockClient();
    const analytics = createAnalyticsApi({
      client,
      sharedProperties: { app_version: '0.1.0', runtime_surface: 'web', analytics_enabled: false },
      analyticsEnabled: false,
    });

    analytics.track('node added', { node_type_id: 'curves' });

    expect(client.capture).not.toHaveBeenCalled();
  });

  it('opting in enables capture and assigns a stable anonymous id', () => {
    const client = createMockClient();
    const analytics = createAnalyticsApi({
      client,
      sharedProperties: { app_version: '0.1.0', runtime_surface: 'web', analytics_enabled: false },
      analyticsEnabled: false,
    });

    analytics.setAnalyticsEnabled(true, { capturePreferenceChange: true });

    expect(client.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
    expect(client.identify).toHaveBeenCalledTimes(1);
    expect(client.capture).toHaveBeenCalledWith('analytics preference changed', {
      app_version: '0.1.0',
      runtime_surface: 'web',
      analytics_enabled: true,
      enabled: true,
    });
  });

  it('opting out captures the preference change and resets the client', () => {
    const client = createMockClient();
    const analytics = createAnalyticsApi({
      client,
      sharedProperties: { app_version: '0.1.0', runtime_surface: 'web', analytics_enabled: true },
      analyticsEnabled: true,
    });

    analytics.setAnalyticsEnabled(false, { capturePreferenceChange: true });

    expect(client.capture).toHaveBeenCalledWith('analytics preference changed', {
      app_version: '0.1.0',
      runtime_surface: 'web',
      analytics_enabled: true,
      enabled: false,
    });
    expect(client.reset).toHaveBeenCalledTimes(1);
    expect(client.opt_out_capturing).toHaveBeenCalledTimes(1);
  });
});
