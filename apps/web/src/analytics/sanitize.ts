const SENSITIVE_KEY_PATTERN = /api[_-]?key|token|secret|password|prompt|content|path|file/i;

// PostHog uses 'token' inside event.properties to authenticate batch requests.
// We must restore it after sanitizing, even though it matches SENSITIVE_KEY_PATTERN.
const POSTHOG_INTERNAL_PROPERTY_KEYS = new Set(['token']);


type AnalyticsValue =
  | string
  | number
  | boolean
  | null
  | AnalyticsValue[]
  | { [key: string]: AnalyticsValue };

interface PostHogEventLike {
  properties?: Record<string, unknown>;
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function sanitizeValue(value: unknown): AnalyticsValue | undefined {
  if (value === undefined) return undefined;
  if (isPrimitive(value)) return value;

  if (Array.isArray(value)) {
    const sanitized = value
      .map(sanitizeValue)
      .filter((entry): entry is AnalyticsValue => entry !== undefined);
    return sanitized;
  }

  if (typeof value === 'object' && value !== null) {
    return sanitizeAnalyticsProperties(value as Record<string, unknown>);
  }

  return String(value);
}

export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown>
): Record<string, AnalyticsValue> {
  const sanitized: Record<string, AnalyticsValue> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;

    const safeValue = sanitizeValue(value);
    if (safeValue !== undefined) {
      sanitized[key] = safeValue;
    }
  }

  return sanitized;
}

export function scrubAndFilterEvent<T extends PostHogEventLike | null | undefined>(event: T) {
  if (!event) return event ?? null;

  const sanitized = sanitizeAnalyticsProperties(event.properties ?? {});

  for (const key of POSTHOG_INTERNAL_PROPERTY_KEYS) {
    const value = event.properties?.[key];
    if (typeof value === 'string' && value.trim()) {
      sanitized[key] = value;
    }
  }

  return {
    ...event,
    properties: sanitized,
  };
}
