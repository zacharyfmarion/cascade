const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.error === 'string') return record.error;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
};

const extractLineNumber = (message: string): number | null => {
  const lineMatch = message.match(/\bline\s+(\d+)\b/i);
  if (lineMatch) return Number(lineMatch[1]);

  const glslMatch = message.match(/\b\d+:(\d+):\d+\b/);
  if (glslMatch) return Number(glslMatch[1]);

  const genericMatch = message.match(/:(\d+):/);
  if (genericMatch) return Number(genericMatch[1]);

  return null;
};

const extractKernel = (manifestJson?: string): string | null => {
  if (!manifestJson) return null;
  try {
    const parsed = JSON.parse(manifestJson) as { kernel?: unknown };
    if (typeof parsed.kernel === 'string') return parsed.kernel;
  } catch {
    return null;
  }
  return null;
};

const formatSourceSnippet = (kernel: string, lineNumber: number): string | null => {
  const lines = kernel.split(/\r?\n/);
  if (lineNumber < 1 || lineNumber > lines.length) return null;
  const start = Math.max(1, lineNumber - 1);
  const end = Math.min(lines.length, lineNumber + 1);
  const snippet = lines.slice(start - 1, end).map((line, idx) => {
    const number = start + idx;
    const marker = number === lineNumber ? '>' : ' ';
    return `${marker} ${number} | ${line}`;
  });
  return `Source:\n${snippet.join('\n')}`;
};

export const formatGpuScriptCompileError = (error: unknown, manifestJson?: string): string => {
  const message = extractErrorMessage(error);
  const lineNumber = extractLineNumber(message);
  const kernel = extractKernel(manifestJson);
  const snippet = lineNumber && kernel ? formatSourceSnippet(kernel, lineNumber) : null;

  if (lineNumber) {
    return [
      `GLSL error at line ${lineNumber}: ${message}`,
      snippet,
    ].filter(Boolean).join('\n');
  }

  return `GPU script compile error: ${message}`;
};
