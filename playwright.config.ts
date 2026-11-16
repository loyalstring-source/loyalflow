import { defineConfig, devices } from 'playwright/test';

const PORT = Number(process.env.E2E_PORT || 3100);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: BASE, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ }
  ],
  webServer: {
    command: `node --no-warnings=ExperimentalWarning src/server.ts`,
    url: `${BASE}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PORT: String(PORT), BASE_URL: BASE, DATA_DIR: './data-e2e', DATABASE_PATH: ':memory:', LOYALFLOW_DEMO: '1', SCHEDULER: '0', LOG_LEVEL: 'warn', SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-1234' }
  }
});
