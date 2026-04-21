const STORAGE_KEY = 'cascade-analytics-distinct-id';

export function getOrCreateStableId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const created = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, created);
  return created;
}

export function clearStableId() {
  localStorage.removeItem(STORAGE_KEY);
}
