# PostHog Analytics Debug Surface

## Goal

Add a temporary in-app analytics debug surface that makes it obvious whether Cascade initializes PostHog, calls capture, and attempts outbound request dispatch in production.

## Approach

- Add a small analytics debug helper that stores bootstrap/runtime/request diagnostics on `window.__CASCADE_ANALYTICS_DEBUG__`.
- Instrument the PostHog client methods and runtime helpers to record init, identify, register, capture, opt-in/out, and internal send-request attempts.
- Gate console logging behind debug flags so we can inspect behavior in production without permanently spamming all users.
- Add focused tests for the debug helper and runtime integration behavior.

## Affected Areas

- `apps/web/src/main.tsx`
- `apps/web/src/analytics/bootstrap.ts`
- `apps/web/src/analytics/runtime.tsx`
- `apps/web/src/analytics/debug.ts`
- `apps/web/src/vite-env.d.ts`
- `apps/web/src/analytics/__tests__/`
- `implementation-plans/posthog-analytics-debug-surface.md`

## Checklist

- [x] Inspect the existing analytics implementation and define the temporary debug surface
- [x] Create a repo implementation plan for this debugging pass
- [x] Implement bootstrap/runtime/client debug instrumentation and the global debug surface
- [x] Add focused frontend tests for debug state and runtime instrumentation
- [x] Run frontend validation and prepare PR handoff
