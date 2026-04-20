import { APP_VERSION } from '../constants/release';
import { scrubAndFilterEvent, sanitizeAnalyticsProperties } from './sanitize';
import { getOrCreateStableId } from './stableId';

export interface PostHogClientLike {
  init: (token: string, config: Record<string, unknown>) => void;
  capture: (eventName: string, properties?: Record<string, unknown>) => void;
  register: (properties: Record<string, unknown>) => void;
  identify: (distinctId: string) => void;
  opt_in_capturing: (options?: Record<string, unknown>) => void;
  opt_out_capturing: () => void;
}

interface BootstrapOptions {
  analyticsEnabled: boolean;
}

interface PostHogEnvironment {
  VITE_PUBLIC_POSTHOG_KEY?: string;
  VITE_PUBLIC_POSTHOG_HOST?: string;
  DEV?: boolean;
}

function getRuntimeSurface() {
  return '__TAURI_INTERNALS__' in window ? 'desktop' : 'web';
}

export function getBootstrapSharedProperties(options: BootstrapOptions) {
  return sanitizeAnalyticsProperties({
    app_version: APP_VERSION,
    runtime_surface: getRuntimeSurface(),
    analytics_enabled: options.analyticsEnabled,
  });
}

export function initializePostHog(
  client: PostHogClientLike,
  options: BootstrapOptions,
  env?: PostHogEnvironment
): boolean {
  const resolvedEnv = env ?? import.meta.env;
  const key = resolvedEnv.VITE_PUBLIC_POSTHOG_KEY;
  const host = resolvedEnv.VITE_PUBLIC_POSTHOG_HOST;

  if (!key || !host) {
    if (resolvedEnv.DEV) {
      console.info('[analytics] PostHog disabled: missing VITE_PUBLIC_POSTHOG_KEY or VITE_PUBLIC_POSTHOG_HOST');
    }
    return false;
  }

  client.init(key, {
    api_host: host,
    defaults: '2026-01-30',
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: false,
    capture_dead_clicks: false,
    rageclick: false,
    disable_session_recording: true,
    disable_surveys: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    person_profiles: 'identified_only',
    before_send: scrubAndFilterEvent,
  });

  client.register(getBootstrapSharedProperties(options));

  if (options.analyticsEnabled) {
    client.opt_in_capturing({ captureEventName: false });
    client.identify(getOrCreateStableId());
  } else {
    client.opt_out_capturing();
  }

  return true;
}

export function captureAppOpened(
  client: Pick<PostHogClientLike, 'capture'>,
  options: BootstrapOptions
) {
  client.capture('app opened', getBootstrapSharedProperties(options));
}
