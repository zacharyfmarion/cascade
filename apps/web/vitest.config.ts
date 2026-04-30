import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/ai/dsl/differ.ts',
        'src/ai/dsl/handleMap.ts',
        'src/ai/dsl/parser.ts',
        'src/ai/dsl/serializer.ts',
        'src/ai/dsl/types.ts',
        'src/ai/dsl/validator.ts',
      ],
      exclude: ['src/ai/dsl/__tests__/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 60,
        statements: 80,
      },
    },
  },
});
