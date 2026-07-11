import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/fixtures/e2e-server.mjs',
    url: 'http://127.0.0.1:4174/health',
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
