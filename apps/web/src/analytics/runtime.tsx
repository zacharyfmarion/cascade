/* eslint-disable react-refresh/only-export-components -- analytics runtime intentionally exports a provider and imperative helpers from one module. */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { usePostHog } from '@posthog/react';
import { APP_VERSION } from '../constants/release';
import { useSettingsStore } from '../store/settingsStore';
import {
  recordAnalyticsCapture,
  recordAnalyticsDebug,
  syncAnalyticsDebugDistinctId,
  updateAnalyticsBootstrap,
} from './debug';
import { sanitizeAnalyticsProperties } from './sanitize';
import { clearStableId, getOrCreateStableId } from './stableId';

interface PostHogCaptureClient {
  capture: (eventName: string, properties?: Record<string, unknown>) => void;
  identify: (distinctId: string) => void;
  reset: () => void;
  register: (properties: Record<string, unknown>) => void;
  opt_in_capturing: (options?: Record<string, unknown>) => void;
  opt_out_capturing: () => void;
}

export interface AnalyticsApi {
  track: (eventName: string, properties?: Record<string, unknown>) => void;
  setAnalyticsEnabled: (enabled: boolean, options?: { capturePreferenceChange?: boolean }) => void;
}

const NOOP_ANALYTICS: AnalyticsApi = {
  track: () => {},
  setAnalyticsEnabled: () => {},
};

let runtimeAnalytics: AnalyticsApi = NOOP_ANALYTICS;

function getRuntimeSurface() {
  return '__TAURI_INTERNALS__' in window ? 'desktop' : 'web';
}

function createSharedProperties(analyticsEnabled: boolean) {
  return sanitizeAnalyticsProperties({
    app_version: APP_VERSION,
    runtime_surface: getRuntimeSurface(),
    analytics_enabled: analyticsEnabled,
  });
}

export function createAnalyticsApi(options: {
  client: PostHogCaptureClient | null;
  sharedProperties: Record<string, unknown>;
  analyticsEnabled: boolean;
}): AnalyticsApi {
  const { client, sharedProperties, analyticsEnabled } = options;

  return {
    track: (eventName, properties) => {
      const sanitizedProperties = sanitizeAnalyticsProperties({
        ...sharedProperties,
        ...properties,
      });
      const allowed = Boolean(client) && analyticsEnabled;

      recordAnalyticsCapture('runtime.track', eventName, sanitizedProperties, allowed);
      if (!client || !analyticsEnabled) return;

      client.capture(eventName, sanitizedProperties);
    },
    setAnalyticsEnabled: (enabled, runtimeOptions) => {
      recordAnalyticsDebug('runtime.setAnalyticsEnabled.called', {
        enabled,
        capturePreferenceChange: runtimeOptions?.capturePreferenceChange ?? false,
        hasClient: Boolean(client),
      });
      if (!client) return;

      if (enabled) {
        client.opt_in_capturing({ captureEventName: false });
        client.identify(getOrCreateStableId());
        syncAnalyticsDebugDistinctId();

        if (runtimeOptions?.capturePreferenceChange) {
          client.capture(
            'analytics preference changed',
            sanitizeAnalyticsProperties({
              ...sharedProperties,
              analytics_enabled: true,
              enabled: true,
            })
          );
        }
      } else {
        if (runtimeOptions?.capturePreferenceChange) {
          client.capture(
            'analytics preference changed',
            sanitizeAnalyticsProperties({
              ...sharedProperties,
              analytics_enabled: true,
              enabled: false,
            })
          );
        }

        clearStableId();
        syncAnalyticsDebugDistinctId();
        client.reset();
        client.opt_out_capturing();
      }

      client.register({
        ...sharedProperties,
        analytics_enabled: enabled,
      });
    },
  };
}

export function AnalyticsRuntimeProvider({ children }: { children: ReactNode }) {
  const posthog = usePostHog() as PostHogCaptureClient | undefined;
  const analyticsEnabled = useSettingsStore(s => s.analyticsEnabled);
  const previousEnabledRef = useRef<boolean | null>(null);

  const sharedProperties = createSharedProperties(analyticsEnabled);
  const analytics = createAnalyticsApi({
    client: posthog ?? null,
    sharedProperties,
    analyticsEnabled,
  });

  useLayoutEffect(() => {
    recordAnalyticsDebug('runtime.provider.bound', {
      hasPosthog: Boolean(posthog),
      analyticsEnabled,
      sharedProperties,
    });
    updateAnalyticsBootstrap({
      analyticsEnabled,
    });
    runtimeAnalytics = analytics;
    return () => {
      if (runtimeAnalytics === analytics) {
        runtimeAnalytics = NOOP_ANALYTICS;
      }
    };
  }, [analytics, analyticsEnabled, posthog, sharedProperties]);

  useLayoutEffect(() => {
    if (!posthog) return;
    posthog.register(sharedProperties);
  }, [posthog, sharedProperties]);

  useLayoutEffect(() => {
    if (!posthog) return;

    if (previousEnabledRef.current === null) {
      analytics.setAnalyticsEnabled(analyticsEnabled);
      previousEnabledRef.current = analyticsEnabled;
      return;
    }

    if (previousEnabledRef.current !== analyticsEnabled) {
      analytics.setAnalyticsEnabled(analyticsEnabled, { capturePreferenceChange: true });
      previousEnabledRef.current = analyticsEnabled;
    }
  }, [analytics, analyticsEnabled, posthog]);

  return <>{children}</>;
}

export function trackAnalyticsEvent(eventName: string, properties?: Record<string, unknown>) {
  recordAnalyticsDebug('runtime.trackAnalyticsEvent.called', {
    eventName,
    properties,
  });
  runtimeAnalytics.track(eventName, properties);
}

export function resetAnalyticsRuntimeForTests() {
  runtimeAnalytics = NOOP_ANALYTICS;
}
