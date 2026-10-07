// SPEC §15 Phase 2: complete a report in each language; get code + secret; /track shows "Received".
import { expect, test } from '@playwright/test';
import { FIXTURES, LANGS, asNewClient, categoryName, messages, uniqueIp } from './support';

const SAVANETA = { latitude: 12.45, longitude: -69.945, accuracy: 12 };
const CURACAO = { latitude: 12.1091, longitude: -68.9316, accuracy: 12 };

for (const lang of LANGS) {
  test(`complete a report in ${lang} and track it`, async ({ page, context, baseURL }) => {
    const m = messages(lang);
    await asNewClient(page, context, lang, baseURL!);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(SAVANETA);

    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await page.getByTestId('start-report').click();

    // Step 1: photos
    await expect(page.getByTestId('step-title')).toHaveText(m.wizard.steps.photos);
    await page.getByTestId('photo-input').setInputFiles([FIXTURES.tyres, FIXTURES.turtle]);
    await expect(page.getByRole('img', { name: /2/ })).toBeVisible();
    await page.getByTestId('next').click();

    // Step 2: location via GPS
    await expect(page.getByTestId('step-title')).toHaveText(m.wizard.steps.location);
    await page.getByTestId('use-gps').click();
    await expect(page.getByTestId('location-status')).toContainText('12.45000');
    await expect(page.getByTestId('outside-error')).toHaveCount(0);
    await page.getByTestId('next').click();

    // Step 3: what
    await expect(page.getByTestId('step-title')).toHaveText(m.wizard.steps.what);
    await page.getByRole('radio', { name: categoryName('ILLEGAL_DUMPING', lang) }).check();
    await page.getByRole('textbox').fill('Tyres and a fridge left in the cunucu.');
    await page.getByTestId('next').click();

    // Step 4: review and send
    await expect(page.getByTestId('step-title')).toHaveText(m.wizard.steps.review);
    await expect(page.getByText(categoryName('ILLEGAL_DUMPING', lang))).toBeVisible();
    await page.getByTestId('send').click();
    await expect(page.locator('main [role="alert"]')).toHaveText(m.wizard.review.needConsent);
    await page.getByTestId('consent').check();
    await page.getByTestId('send').click();

    // Done: code and six secret words, shown once.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(m.done.title, {
      timeout: 30_000,
    });
    const code = (await page.getByTestId('public-code').textContent())!;
    const secret = (await page.getByTestId('secret').textContent())!;
    expect(code).toMatch(/^RC-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(secret.split(' ')).toHaveLength(6);

    // Track: prefilled from this device; status "Received" in the chosen language.
    await page.getByTestId('go-track').click();
    await expect(page.getByTestId('track-code')).toHaveValue(code);
    await page.getByTestId('track-submit').click();
    await expect(page.getByTestId('track-status')).toHaveAttribute('data-status', 'received');
    await expect(page.getByTestId('track-status')).toHaveText(m.track.statuses.received);

    // A fresh device can track it with the code and secret typed in.
    const other = await context.browser()!.newContext();
    const p2 = await other.newPage();
    await p2.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() });
    await p2.goto(`${baseURL}/track`);
    await p2.getByTestId('track-code').fill(code.toLowerCase());
    await p2.getByTestId('track-secret').fill(secret);
    await p2.getByTestId('track-submit').click();
    await expect(p2.getByTestId('track-status')).toHaveAttribute('data-status', 'received');
    await other.close();
  });
}

test('a pin outside Aruba is blocked in the wizard (GPS and typed coordinates)', async ({
  page,
  context,
  baseURL,
}) => {
  const m = messages('en');
  await asNewClient(page, context, 'en', baseURL!);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(CURACAO);
  await page.goto('/report');
  await page.getByTestId('photo-input').setInputFiles(FIXTURES.reef);
  await page.getByTestId('next').click();

  await page.getByTestId('use-gps').click();
  await expect(page.getByTestId('outside-error')).toHaveText(m.wizard.location.outside);
  await page.getByTestId('next').click();
  await expect(page.getByTestId('step-title')).toHaveText(m.wizard.steps.location);

  await page.getByText(m.wizard.location.manual).click();
  await page.getByTestId('manual-lat').fill('12.8');
  await page.getByTestId('manual-lon').fill('-70.0');
  await page.getByTestId('manual-set').click();
  await expect(page.getByTestId('outside-error')).toBeVisible();

  // Back inside: Malmok reef, at sea but within the 3 km buffer.
  await page.getByTestId('manual-lat').fill('12.5985');
  await page.getByTestId('manual-lon').fill('-70.0555');
  await page.getByTestId('manual-set').click();
  await expect(page.getByTestId('outside-error')).toHaveCount(0);
  await page.getByTestId('next').click();
  await expect(page.getByTestId('step-title')).toHaveText(m.wizard.steps.what);
});

test('the API rejects a pin outside Aruba with 400 even if the client is bypassed', async ({
  request,
}) => {
  const res = await request.post('/api/v1/reports', {
    headers: { 'x-forwarded-for': uniqueIp() },
    data: {
      idempotency_key: crypto.randomUUID(),
      upload_id: crypto.randomUUID(),
      photo_count: 1,
      client_created_at: '2026-10-07T10:00:00-04:00',
      location: { lat: 12.1091, lon: -68.9316 },
      location_source: 'map_pin',
      ui_language: 'en',
      offline: false,
      follow_up_secret: 'abandon ability able about above absent',
    },
  });
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({ error: 'outside_aruba' });
});

test('photo step validates type and count', async ({ page, context, baseURL }) => {
  const m = messages('en');
  await asNewClient(page, context, 'en', baseURL!);
  await page.goto('/report');
  await page.getByTestId('next').click();
  await expect(page.locator('main [role="alert"]')).toHaveText(m.wizard.photos.needOne);
  await page
    .getByTestId('photo-input')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await expect(page.locator('main [role="alert"]', { hasText: 'notes.txt' })).toBeVisible();
  await page
    .getByTestId('photo-input')
    .setInputFiles([
      FIXTURES.tyres,
      FIXTURES.turtle,
      FIXTURES.reef,
      FIXTURES.tyres,
      FIXTURES.turtle,
      FIXTURES.reef,
    ]);
  await expect(
    page.locator('main [role="alert"]', { hasText: m.wizard.photos.tooMany.replace('{max}', '5') }),
  ).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(5 + 1); // + header logo
});

test('the track form works when used while the page is still loading', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() });
  // Slow script delivery, as on a weak mobile connection.
  await page.route('**/_next/static/**', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto('/track', { waitUntil: 'commit' });
  await page.getByTestId('track-code').fill('RC-0000-0000');
  await page.getByTestId('track-secret').fill('abandon ability able about above absent');
  await page.getByTestId('track-submit').click();
  await expect(page.locator('main [role="alert"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('track-code')).toHaveValue('RC-0000-0000');
});
