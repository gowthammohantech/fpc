import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    // `env` is parsed once at import time, so a flag set inside a hook comes
    // too late. The connector suite replaces Microsoft through the driver
    // seams, so enabling it here costs nothing and never reaches the network.
    env: { OUTLOOK_ENABLED: 'true' },
  },
});
