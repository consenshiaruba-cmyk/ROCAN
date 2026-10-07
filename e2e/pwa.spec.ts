// SPEC §15 Phase 2: installable PWA, no serious accessibility violations, no third-party requests.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices, expect, test, type Page } from '@playwright/test';
import { FIXTURES, LANGS, asNewClient } from './support';

async function axe(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map(
      (v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

for (const lang of LANGS) {
  test(`no serious or critical axe violations on public pages (${lang})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await asNewClient(page, context, lang, baseURL!);
    for (const path of ['/', '/track', '/about', '/privacy']) {
      await page.goto(path);
      await axe(page, `${lang} ${path}`);
    }
    // Every wizard step.
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 12.5545, longitude: -70.056 });
    await page.goto('/report');
    await axe(page, `${lang} /report step 1`);
    await page.getByTestId('photo-input').setInputFiles(FIXTURES.turtle);
    await axe(page, `${lang} /report step 1 with photo`);
    await page.getByTestId('next').click();
    await page.getByTestId('use-gps').click();
    await expect(page.getByTestId('location-status')).not.toBeEmpty();
    await axe(page, `${lang} /report step 2`);
    await page.getByTestId('next').click();
    await page.getByRole('radio').first().check();
    await axe(page, `${lang} /report step 3`);
    await page.getByTestId('next').click();
    await axe(page, `${lang} /report step 4`);
    // Done page with a stored report.
    await page.evaluate(() =>
      sessionStorage.setItem(
        'rocan.lastReport',
        JSON.stringify({ code: 'RC-7KQ2-M9XD', secret: 'abandon ability able about above absent' }),
      ),
    );
    await page.goto('/report/done');
    await axe(page, `${lang} /report/done`);
  });
}

test('the app is installable (manifest, icons, service worker)', async ({
  browserName,
  baseURL,
}) => {
  test.skip(browserName !== 'chromium', 'installability is checked through Chromium DevTools');
  // Default contexts are incognito, where Chrome never offers installation: use a real profile.
  const dir = mkdtempSync(join(tmpdir(), 'rocan-pwa-'));
  const context = await chromium.launchPersistentContext(dir, {
    ...devices['Pixel 7'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}),
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(baseURL!);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    const manifest = await (await page.request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({ display: 'standalone', start_url: '/', short_name: 'ROCAN' });
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    expect(installabilityErrors).toEqual([]);
  } finally {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('public pages make no third-party requests (SPEC §13.1)', async ({
  page,
  context,
  baseURL,
}) => {
  const origins = new Set<string>();
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.protocol.startsWith('http')) origins.add(u.origin);
  });
  await asNewClient(page, context, 'pap', baseURL!);
  for (const path of ['/', '/report', '/track', '/about', '/privacy']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect([...origins]).toEqual([new URL(baseURL!).origin]);
});
