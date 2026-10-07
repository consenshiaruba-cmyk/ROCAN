import { defineConfig, devices } from '@playwright/test';

// E2E runs against the real app in mock mode. Start services first (`pnpm services:up`,
// `pnpm db:reset`); Playwright starts the web app unless one is already running.
// PLAYWRIGHT_CHROMIUM_PATH lets sandboxes reuse a preinstalled Chromium build.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    // Pixel 7 is a Chromium device; iPhone/WebKit and desktop join the nightly matrix later.
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm --filter @rocan/web dev',
    url: 'http://localhost:3000/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { MOCK_MODE: '1', NEXT_TELEMETRY_DISABLED: '1' },
  },
});
