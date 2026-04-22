/// <reference types="vite/client" />
import type { AnalyticsDebugGlobal } from './analytics/debug';

interface ImportMetaEnv {
  readonly VITE_PUBLIC_POSTHOG_KEY?: string;
  readonly VITE_PUBLIC_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __CASCADE_ANALYTICS_DEBUG__?: AnalyticsDebugGlobal;
}
