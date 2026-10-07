// SPEC §15 Phase 2: Lighthouse performance ≥ 80 on mobile emulation, against a production build.
// Usage: pnpm build && pnpm test:lighthouse   (starts `next start` on :3100 unless LH_BASE_URL is set)
// CHROME_PATH (or PLAYWRIGHT_CHROMIUM_PATH) selects the browser; defaults to Playwright's Chromium.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chromium } from '@playwright/test';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const PAGES = ['/', '/report', '/track', '/privacy'];
const MIN = Number(process.env.LH_MIN_PERFORMANCE ?? 80);
const chromePath =
  process.env.CHROME_PATH ?? process.env.PLAYWRIGHT_CHROMIUM_PATH ?? chromium.executablePath();

let server;
let base = process.env.LH_BASE_URL;
if (!base) {
  base = 'http://localhost:3100';
  server = spawn('pnpm', ['--filter', '@rocan/web', 'exec', 'next', 'start', '--port', '3100'], {
    stdio: 'inherit',
    // A production server refuses the development upload secret, so give it a throwaway one.
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MOCK_MODE: '0',
      UPLOAD_TOKEN_SECRET: randomBytes(32).toString('hex'),
    },
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const chrome = await chromeLauncher.launch({
  chromePath,
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
});
let failed = false;
try {
  for (const path of PAGES) {
    const result = await lighthouse(`${base}${path}`, {
      port: chrome.port,
      onlyCategories: ['performance', 'accessibility', 'best-practices'],
      formFactor: 'mobile',
      screenEmulation: {
        mobile: true,
        width: 412,
        height: 823,
        deviceScaleFactor: 1.75,
        disabled: false,
      },
      throttlingMethod: 'simulate',
      logLevel: 'error',
    });
    const c = result.lhr.categories;
    const score = (k) => Math.round((c[k]?.score ?? 0) * 100);
    const perf = score('performance');
    console.log(
      `${path.padEnd(10)} performance ${perf}  accessibility ${score('accessibility')}  best-practices ${score('best-practices')}`,
    );
    if (perf < MIN) failed = true;
  }
} finally {
  await chrome.kill();
  server?.kill();
}
if (failed) {
  console.error(`Performance below ${MIN} on at least one page`);
  process.exit(1);
}
