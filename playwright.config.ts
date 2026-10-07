import { defineConfig, devices } from '@playwright/test';

// E2E runs against the real app in mock mode. Start services first (`pnpm services:up`,
// `pnpm storage:init`, `pnpm db:reset`); Playwright starts the web app unless one is running.
// PLAYWRIGHT_CHROMIUM_PATH lets sandboxes reuse a preinstalled Chromium build.
// E2E_WEBKIT=0 runs the iPhone profile on Chromium where WebKit is not installed (CI uses WebKit).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const chromiumLaunch = executablePath ? { launchOptions: { executablePath } } : {};
const iphoneOnChromium = process.env.E2E_WEBKIT === '0';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'pixel-7', use: { ...devices['Pixel 7'], ...chromiumLaunch } },
    {
      name: 'iphone-14',
      use: iphoneOnChromium
        ? { ...devices['iPhone 14'], browserName: 'chromium', ...chromiumLaunch }
        : { ...devices['iPhone 14'] },
    },
  ],
  webServer: {
    command: 'pnpm --filter @rocan/web dev',
    url: 'http://localhost:3000/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { MOCK_MODE: '1', NEXT_TELEMETRY_DISABLED: '1', TRUST_PROXY: '1' },
  },
});
