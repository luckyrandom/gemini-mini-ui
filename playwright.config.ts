import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['TEST_PORT'] ?? 3999);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 20_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `tsx server/index.ts`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 15_000,
    env: {
      GEMINI_MINI_UI_FAKE: '1',
      PORT: String(PORT),
    },
  },
});
