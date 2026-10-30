import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3101',
    launchOptions: existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/start-e2e-server.js',
    url: 'http://127.0.0.1:3101/api/health',
    reuseExistingServer: false,
    env: { NODE_ENV: 'production' },
  },
});
