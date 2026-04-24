import { describe, expect, it } from 'vitest';
import { formatGpuScriptCompileError } from '../gpuScriptErrors';

describe('formatGpuScriptCompileError', () => {
  it('extracts message from structured engine errors', () => {
    const manifestJson = JSON.stringify({
      kernel: 'float x = 1.0;\nreturn color;\n',
    });

    const message = formatGpuScriptCompileError(
      { message: '0:2:5: error: unexpected identifier', code: 'RUNTIME_ERROR' },
      manifestJson,
    );

    expect(message).toContain('unexpected identifier');
    expect(message).toContain('GLSL error at line 2');
    expect(message).toContain('2 | return color;');
  });
});
