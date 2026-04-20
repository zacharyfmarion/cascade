import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import posthog from 'posthog-js';
import { PostHogProvider } from '@posthog/react';
import './index.css';
import App from './App.tsx';
import { captureAppOpened, initializePostHog } from './analytics/bootstrap';
import { AnalyticsRuntimeProvider } from './analytics/runtime';
import { loadSettings } from './store/settingsStore';

const analyticsEnabled = loadSettings().analyticsEnabled;
const posthogReady = initializePostHog(posthog, { analyticsEnabled });

if (posthogReady && analyticsEnabled) {
  captureAppOpened(posthog, { analyticsEnabled });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PostHogProvider client={posthog}>
      <AnalyticsRuntimeProvider>
        <App />
      </AnalyticsRuntimeProvider>
    </PostHogProvider>
  </StrictMode>,
);
