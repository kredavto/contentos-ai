import { defineConfig, devices } from '@playwright/test';
const databaseUrl = process.env.TEST_DATABASE_URL;
const storageEnv = {STORAGE_PROVIDER:'s3',S3_REGION:'us-east-1',S3_BUCKET:'contentos-e2e',S3_ACCESS_KEY_ID:'fixture-key',S3_SECRET_ACCESS_KEY:'fixture-secret-not-a-credential',S3_ENDPOINT:'http://127.0.0.1:8027',S3_FORCE_PATH_STYLE:'true'};
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Set TEST_DATABASE_URL to a dedicated database ending in _test');
export default defineConfig({
  testDir: './tests/e2e', testMatch: '**/*.spec.ts', timeout: 240_000, fullyParallel: false, workers: 1,
  expect: { timeout: 30000 },
  use: { baseURL: 'http://localhost:3187', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) } }],
  webServer: [
    { command: 'pnpm exec tsx tests/e2e/storage-server.ts', url: 'http://127.0.0.1:8027/health', reuseExistingServer: false, env: { NODE_ENV: 'test' } },
    { command: 'pnpm --filter @contentos/worker start', url: 'http://127.0.0.1:3190/health', timeout: 60000, reuseExistingServer: false, env: { ...storageEnv, NODE_ENV: 'test', DATABASE_URL: databaseUrl, REDIS_URL: 'redis://localhost:6379/14', APP_URL: 'http://localhost:3187', AI_PROVIDER: 'mock', WORKER_HEALTH_PORT: '3190' } },
    { command: 'pnpm exec tsx tests/e2e/mail-server.ts', url: 'http://127.0.0.1:8026/health', reuseExistingServer: false, env: { NODE_ENV: 'test' } },
    { command: 'pnpm --filter @contentos/web exec next dev --port 3187', stdout: 'pipe', url: 'http://localhost:3187/api/me', timeout: 120_000, reuseExistingServer: false, env: { ...storageEnv, DATABASE_URL: databaseUrl, REDIS_URL: 'redis://localhost:6379/14', AI_PROVIDER: 'mock', APP_URL: 'http://localhost:3187', SMTP_URL: 'smtp://127.0.0.1:1026', EMAIL_FROM: 'noreply@example.test' } },
  ],
});
