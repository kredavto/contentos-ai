import { defineConfig, devices } from '@playwright/test';
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Set TEST_DATABASE_URL to a dedicated database ending in _test');
export default defineConfig({
  testDir: './tests/e2e', testMatch: '**/*.spec.ts', timeout: 90_000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://localhost:3187', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) } }],
  webServer: [
    { command: 'pnpm exec tsx tests/e2e/mail-server.ts', url: 'http://127.0.0.1:8026/health', reuseExistingServer: false, env: { NODE_ENV: 'test' } },
    { command: 'pnpm --filter @contentos/web exec next dev --port 3187', url: 'http://localhost:3187/api/health', timeout: 120_000, reuseExistingServer: false, env: { DATABASE_URL: databaseUrl, REDIS_URL: 'redis://localhost:6379', APP_URL: 'http://localhost:3187', SMTP_URL: 'smtp://127.0.0.1:1026', EMAIL_FROM: 'noreply@example.test' } },
  ],
});
