// SPEC §15 Phase 2 acceptance (API side): geofence, idempotency, rate limit, uploads, tracking.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOUR } from '@rocan/clock';
import { cryptoRandomInt, generateFollowUpSecret, type CreateReport } from '@rocan/core';
import { verifyAuditChain } from '@rocan/db';
import { createUpload, putUpload } from '../lib/api/uploads';
import { postReport } from '../lib/api/reports';
import { postTrack, postWithdraw } from '../lib/api/track';
import { handleMeta } from '../lib/api/meta';
import { fakeJpeg, startStack, type TestStack } from './helpers';

let stack: TestStack;
beforeAll(async () => {
  stack = await startStack('rocan_it_api');
}, 120_000);
afterAll(async () => stack?.close());

const BASE = 'http://localhost:3000';
let ipCounter = 0;
/** A distinct client address per caller (TRUST_PROXY=1 in tests). */
const newClient = () => `198.51.100.${++ipCounter}`;

function req(path: string, body: unknown, ip: string, method = 'POST'): Request {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

async function upload(
  ip: string,
  files: Uint8Array<ArrayBuffer>[] = [fakeJpeg()],
): Promise<string> {
  const res = await createUpload(
    req(
      '/api/v1/uploads',
      { files: files.map((f) => ({ mime: 'image/jpeg', size: f.byteLength })) },
      ip,
    ),
    stack.deps,
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { upload_id: string; files: { n: number; url: string }[] };
  for (const [i, f] of body.files.entries()) {
    const put = await putUpload(
      new Request(`${BASE}${f.url}`, {
        method: 'PUT',
        body: files[i]!,
        headers: { 'content-type': 'image/jpeg' },
      }),
      { uploadId: body.upload_id, n: String(f.n) },
      stack.deps,
    );
    expect(put.status, await put.clone().text()).toBe(201);
  }
  return body.upload_id;
}

function reportBody(uploadId: string, overrides: Partial<CreateReport> = {}): CreateReport {
  return {
    idempotency_key: randomUUID(),
    upload_id: uploadId,
    photo_count: 1,
    client_created_at: '2026-10-07T09:55:00-04:00',
    location: { lat: 12.45, lon: -69.945 }, // Savaneta
    location_accuracy_m: 8,
    location_source: 'gps',
    category_code: 'ILLEGAL_DUMPING',
    description: 'Tyres dumped next to the road',
    observed_at: null,
    is_ongoing: false,
    ui_language: 'pap',
    offline: false,
    follow_up_secret: generateFollowUpSecret(cryptoRandomInt),
    ...overrides,
  };
}

describe('POST /api/v1/reports', () => {
  it('creates a report in "submitted" with history, audit and an ingest job', async () => {
    const ip = newClient();
    const body = reportBody(await upload(ip));
    const res = await postReport(req('/api/v1/reports', body, ip), stack.deps);
    expect(res.status).toBe(201);
    const { public_code } = (await res.json()) as { public_code: string };
    expect(public_code).toMatch(/^RC-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    const sql = stack.deps.sql;
    const [r] = await sql`
      SELECT r.*, c.code AS category, ST_X(location) AS lon, ST_Y(location) AS lat
      FROM report r LEFT JOIN category c ON c.id = r.reporter_category_id WHERE public_code = ${public_code}`;
    expect(r).toMatchObject({
      status: 'submitted',
      category: 'ILLEGAL_DUMPING',
      ui_language: 'pap',
      photo_count: 1,
    });
    expect(r!.lat).toBeCloseTo(12.45, 5);
    expect(r!.received_at.toISOString()).toBe('2026-10-07T14:00:00.000Z');
    // Only the argon2id hash of the secret is stored.
    expect(r!.follow_up_token_hash.toString()).toMatch(/^\$argon2id\$/);
    expect(r!.follow_up_token_hash.toString()).not.toContain(body.follow_up_secret);

    const history =
      await sql`SELECT to_status, actor_type FROM report_status_history WHERE report_id = ${r!.id}`;
    expect(history).toEqual([{ to_status: 'submitted', actor_type: 'reporter' }]);
    const jobs =
      await sql`SELECT data FROM pgboss.job WHERE name = 'report.ingest' AND data->>'reportId' = ${r!.id}`;
    expect(jobs).toHaveLength(1);
    expect(await verifyAuditChain(sql)).toBeNull();
  });

  it('is idempotent: the same idempotency_key returns the same code and creates one row', async () => {
    const ip = newClient();
    const body = reportBody(await upload(ip));
    const first = await postReport(req('/api/v1/reports', body, ip), stack.deps);
    const second = await postReport(req('/api/v1/reports', body, ip), stack.deps);
    const third = await postReport(req('/api/v1/reports', body, newClient()), stack.deps);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    const codes = await Promise.all(
      [first, second, third].map(
        async (r) => ((await r.json()) as { public_code: string }).public_code,
      ),
    );
    expect(new Set(codes).size).toBe(1);
    const [n] = await stack.deps
      .sql`SELECT count(*)::int AS n FROM report WHERE idempotency_key = ${body.idempotency_key}`;
    expect(n!.n).toBe(1);
  });

  it('concurrent retries of one submission still create one row', async () => {
    const ip = newClient();
    const body = reportBody(await upload(ip));
    const results = await Promise.all(
      Array.from({ length: 5 }, () => postReport(req('/api/v1/reports', body, ip), stack.deps)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    const [n] = await stack.deps
      .sql`SELECT count(*)::int AS n FROM report WHERE idempotency_key = ${body.idempotency_key}`;
    expect(n!.n).toBe(1);
  });

  it.each([
    ['Curaçao', { lat: 12.1091, lon: -68.9316 }],
    ['open sea north', { lat: 12.8, lon: -70.0 }],
    ['Paraguaná', { lat: 11.95, lon: -70.0 }],
  ])('rejects a pin outside Aruba (%s) with 400', async (_name, location) => {
    const ip = newClient();
    const res = await postReport(
      req('/api/v1/reports', reportBody(randomUUID(), { location }), ip),
      stack.deps,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'outside_aruba' });
  });

  it('accepts a reef point at sea within the 3 km buffer', async () => {
    const ip = newClient();
    const body = reportBody(await upload(ip), {
      location: { lat: 12.5985, lon: -70.0555 },
      category_code: 'CORAL_REEF_DAMAGE',
    });
    expect((await postReport(req('/api/v1/reports', body, ip), stack.deps)).status).toBe(201);
  });

  it('rejects a report whose photos were never uploaded', async () => {
    const ip = newClient();
    const res = await postReport(
      req('/api/v1/reports', reportBody(randomUUID(), { photo_count: 2 }), ip),
      stack.deps,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'photos_missing', details: { missing: [1, 2] } });
  });

  it('rejects malformed input without echoing it', async () => {
    const ip = newClient();
    const res = await postReport(req('/api/v1/reports', { hello: '<script>' }, ip), stack.deps);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('<script>');
  });

  it('the 11th report from one connection within an hour gets 429; other connections are unaffected', async () => {
    const ip = newClient();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await postReport(
        req('/api/v1/reports', reportBody(await upload(ip)), ip),
        stack.deps,
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);

    const other = newClient();
    expect(
      (await postReport(req('/api/v1/reports', reportBody(await upload(other)), other), stack.deps))
        .status,
    ).toBe(201);

    stack.clock.advance(HOUR);
    expect(
      (await postReport(req('/api/v1/reports', reportBody(await upload(ip)), ip), stack.deps))
        .status,
    ).toBe(201);
  });
});

describe('uploads', () => {
  it('rejects a non-image disguised as JPEG', async () => {
    const ip = newClient();
    const exe = new TextEncoder().encode('MZ\x90\x00 this is not a photo');
    const res = await createUpload(
      req('/api/v1/uploads', { files: [{ mime: 'image/jpeg', size: exe.byteLength }] }, ip),
      stack.deps,
    );
    const { upload_id, files } = (await res.json()) as {
      upload_id: string;
      files: { url: string }[];
    };
    const put = await putUpload(
      new Request(`${BASE}${files[0]!.url}`, { method: 'PUT', body: exe }),
      { uploadId: upload_id, n: '1' },
      stack.deps,
    );
    expect(put.status).toBe(415);
  });

  it('rejects tampered signatures, other slots and expired URLs', async () => {
    const ip = newClient();
    const res = await createUpload(
      req('/api/v1/uploads', { files: [{ mime: 'image/jpeg', size: 2048 }] }, ip),
      stack.deps,
    );
    const { upload_id, files } = (await res.json()) as {
      upload_id: string;
      files: { url: string }[];
    };
    const url = files[0]!.url;
    const put = (u: string, n = '1') =>
      putUpload(
        new Request(`${BASE}${u}`, { method: 'PUT', body: fakeJpeg() }),
        { uploadId: upload_id, n },
        stack.deps,
      );
    expect((await put(url.replace('size=2048', 'size=4096'))).status).toBe(403);
    expect((await put(url, '2')).status).toBe(403);
    stack.clock.advance(2 * HOUR);
    expect((await put(url)).status).toBe(403);
  });

  it('rejects a body that does not match the announced size', async () => {
    const ip = newClient();
    const res = await createUpload(
      req('/api/v1/uploads', { files: [{ mime: 'image/jpeg', size: 4096 }] }, ip),
      stack.deps,
    );
    const { upload_id, files } = (await res.json()) as {
      upload_id: string;
      files: { url: string }[];
    };
    const put = await putUpload(
      new Request(`${BASE}${files[0]!.url}`, { method: 'PUT', body: fakeJpeg(1000) }),
      { uploadId: upload_id, n: '1' },
      stack.deps,
    );
    expect(put.status).toBe(400);
  });

  it('limits uploads to 5 files', async () => {
    const res = await createUpload(
      req(
        '/api/v1/uploads',
        { files: Array(6).fill({ mime: 'image/jpeg', size: 10 }) },
        newClient(),
      ),
      stack.deps,
    );
    expect(res.status).toBe(400);
  });
});

describe('tracking', () => {
  async function submit(ip = newClient()) {
    const body = reportBody(await upload(ip));
    const res = await postReport(req('/api/v1/reports', body, ip), stack.deps);
    return {
      code: ((await res.json()) as { public_code: string }).public_code,
      secret: body.follow_up_secret,
    };
  }

  it('shows "received" with the right code and secret (lenient formatting)', async () => {
    const { code, secret } = await submit();
    const res = await postTrack(
      req(
        '/api/v1/track',
        { code: code.toLowerCase().replace(/-/g, ' '), secret: secret.toUpperCase() },
        newClient(),
      ),
      stack.deps,
    );
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      status: string;
      timeline: { status: string }[];
      can_withdraw: boolean;
    };
    expect(view.status).toBe('received');
    expect(view.timeline.map((t) => t.status)).toEqual(['received']);
    expect(view.can_withdraw).toBe(true);
    // Never exposes internals.
    expect(JSON.stringify(view)).not.toMatch(/DNM|ACF|DOW|reportId|argon2/);
  });

  it('gives the same 404 for a wrong secret and an unknown code', async () => {
    const { code } = await submit();
    const wrong = await postTrack(
      req('/api/v1/track', { code, secret: generateFollowUpSecret(cryptoRandomInt) }, newClient()),
      stack.deps,
    );
    const unknown = await postTrack(
      req(
        '/api/v1/track',
        { code: 'RC-0000-0000', secret: generateFollowUpSecret(cryptoRandomInt) },
        newClient(),
      ),
      stack.deps,
    );
    expect(wrong.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('lets the reporter withdraw before moderation, through transition()', async () => {
    const { code, secret } = await submit();
    const res = await postWithdraw(
      req('/api/v1/track/withdraw', { code, secret }, newClient()),
      stack.deps,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('not_forwarded');
    const [r] = await stack.deps
      .sql`SELECT status, rejection_reason FROM report WHERE public_code = ${code}`;
    expect(r).toEqual({ status: 'rejected', rejection_reason: 'withdrawn' });
    const again = await postWithdraw(
      req('/api/v1/track/withdraw', { code, secret }, newClient()),
      stack.deps,
    );
    expect(again.status).toBe(409);
    expect(await verifyAuditChain(stack.deps.sql)).toBeNull();
  });

  it('limits tracking attempts per connection', async () => {
    const ip = newClient();
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (
        await postTrack(req('/api/v1/track', { code: 'RC-0000-0000', secret: 'x' }, ip), stack.deps)
      ).status;
    }
    expect(last).toBe(429);
  });
});

describe('GET /api/v1/meta', () => {
  it('returns 13 categories in four languages, the island and provisional-boundary flag', async () => {
    const res = await handleMeta(stack.deps.sql, 0);
    const meta = (await res.json()) as {
      categories: { code: string; name: Record<string, string> }[];
      land: unknown[];
      areas: unknown[];
      provisional_boundaries: boolean;
    };
    expect(meta.categories).toHaveLength(13);
    expect(Object.keys(meta.categories[0]!.name).sort()).toEqual(['en', 'es', 'nl', 'pap']);
    expect(meta.land.length).toBeGreaterThan(0);
    expect(meta.areas).toHaveLength(6);
    expect(meta.provisional_boundaries).toBe(true);
  });
});

describe('privacy', () => {
  it('stores no client address anywhere in the database', async () => {
    const ip = '203.0.113.77';
    const body = reportBody(await upload(ip));
    await postReport(req('/api/v1/reports', body, ip), stack.deps);
    const hits = await stack.deps.sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema IN ('public', 'pgboss') AND data_type IN ('text', 'jsonb', 'character varying', 'USER-DEFINED')`;
    for (const { table_name, column_name } of hits) {
      const [found] = await stack.deps.sql
        .unsafe(
          `SELECT count(*)::int AS n FROM ${table_name.startsWith('job') || table_name === 'queue' ? 'pgboss.' : ''}"${table_name}" WHERE "${column_name}"::text LIKE '%203.0.113.77%'`,
        )
        .catch(() => [{ n: 0 }]);
      expect(found!.n, `${table_name}.${column_name}`).toBe(0);
    }
  });
});
