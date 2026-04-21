# Analytics

Cascade uses PostHog for in-app product analytics in the web app.

## Environment

- `VITE_PUBLIC_POSTHOG_KEY`
- `VITE_PUBLIC_POSTHOG_HOST`

If either value is missing, analytics initialization is skipped and the app continues without capture.

## Consent

- Analytics are enabled by default.
- Users can disable analytics in Settings > Privacy.
- The preference is stored locally in `cascade-settings`.
- Turning analytics off stops future capture for that browser or desktop profile and clears the locally stored anonymous analytics identifier.

## Events

The current launch analytics contract intentionally tracks only high-signal events:

- `app opened`
- `node added`
- `node removed`
- `nodes connected`
- `nodes disconnected`
- `node muted`
- `node linked to viewer`
- `analytics preference changed`

## Privacy Rules

Analytics payloads must not include:

- parameter values
- prompt or transcript text
- API keys, tokens, or secrets
- file paths
- freeform user content

When adding new events, prefer enums, booleans, bounded counts, and stable IDs over raw content.
