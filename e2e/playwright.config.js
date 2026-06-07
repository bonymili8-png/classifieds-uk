import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT || 3099;

// Запускає сам застосунок (без залежностей) на час тестів.
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: `node ../server.js`,
    env: { PORT: String(PORT), HOST: '127.0.0.1', DISABLE_RATE_LIMIT: '1' },
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
});
