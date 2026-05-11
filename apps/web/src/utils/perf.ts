type PerfFields = Record<string, unknown>;

export const perfNow = (): number => (
  typeof performance !== 'undefined' ? performance.now() : Date.now()
);

const shouldLogPerf = (): boolean => import.meta.env.DEV && import.meta.env.MODE !== 'test';

export const perfLog = (label: string, fields: PerfFields = {}): void => {
  if (!shouldLogPerf()) return;
  console.debug(`[perf] ${label}`, fields);
};

export const perfLogDuration = (
  label: string,
  start: number,
  fields: PerfFields = {},
): void => {
  if (!shouldLogPerf()) return;
  console.debug(`[perf] ${label} ${(perfNow() - start).toFixed(1)}ms`, fields);
};
