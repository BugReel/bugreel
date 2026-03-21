import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/__tests__/**/*.test.js'],
    setupFiles: ['server/__tests__/setup.js'],
    testTimeout: 10000,
  },
});
