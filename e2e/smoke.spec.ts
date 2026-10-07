// Phase 1 smoke: the web app boots in mock mode, reports healthy, and renders on a phone.
import { expect, test } from '@playwright/test';

test('healthz and readyz report OK', async ({ request }) => {
  const health = await request.get('/healthz');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok', service: 'web' });

  const ready = await request.get('/readyz');
  expect(ready.status()).toBe(200);
  const body = await ready.json();
  expect(body.status).toBe('ready');
  expect(body.checks.map((c: { name: string }) => c.name)).toEqual(['database', 'storage', 'smtp']);
});

test('home page renders on a phone with privacy headers', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  expect(response?.headers()['x-powered-by']).toBeUndefined();
  await expect(page.getByRole('heading', { name: 'ROCAN' })).toBeVisible();
});

test('public pages load nothing from third-party origins (SPEC §13.1)', async ({
  page,
  baseURL,
}) => {
  const origins = new Set<string>();
  page.on('request', (req) => origins.add(new URL(req.url()).origin));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect([...origins]).toEqual([new URL(baseURL!).origin]);
});
