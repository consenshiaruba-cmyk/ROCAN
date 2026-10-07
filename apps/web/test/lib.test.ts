import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAY, FrozenClock, HOUR } from '@rocan/clock';
import { mimeMatches, sniffImageMime } from '@rocan/media';
import { RateLimiter, clientAddress } from '../lib/rateLimit';
import { signUpload, uploadUrl, verifyUpload } from '../lib/uploadToken';

describe('RateLimiter (SPEC §5.5)', () => {
  it('allows N per hour, then refuses, then resets after an hour', () => {
    const clock = new FrozenClock('2026-10-07T12:00:00Z');
    const rl = new RateLimiter(clock);
    const limit = { name: 'reports', perHour: 10, perDay: 30 };
    const key = rl.keyFor('203.0.113.9');
    for (let i = 0; i < 10; i++) expect(rl.consume(limit, key)).toBe(true);
    expect(rl.consume(limit, key)).toBe(false);
    clock.advance(HOUR);
    expect(rl.consume(limit, key)).toBe(true);
  });

  it('enforces the daily cap across hours', () => {
    const clock = new FrozenClock('2026-10-07T00:00:00Z');
    const rl = new RateLimiter(clock);
    const limit = { name: 'reports', perHour: 10, perDay: 30 };
    const key = rl.keyFor('203.0.113.9');
    let accepted = 0;
    for (let h = 0; h < 5; h++) {
      for (let i = 0; i < 10; i++) if (rl.consume(limit, key)) accepted++;
      clock.advance(HOUR);
    }
    expect(accepted).toBe(30);
  });

  it('never keeps the address: keys are salted HMACs that change at the daily rotation', () => {
    const clock = new FrozenClock('2026-10-07T00:00:00Z');
    const rl = new RateLimiter(clock);
    const k1 = rl.keyFor('203.0.113.9');
    expect(k1).not.toContain('203');
    expect(rl.keyFor('203.0.113.9')).toBe(k1);
    expect(rl.keyFor('203.0.113.10')).not.toBe(k1);
    rl.consume({ name: 'x', perHour: 1 }, k1);
    clock.advance(DAY);
    expect(rl.keyFor('203.0.113.9')).not.toBe(k1);
    expect(rl.size).toBe(0); // counters dropped with the old salt
  });

  it('uses X-Forwarded-For only behind a trusted proxy', () => {
    const h = new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' });
    expect(clientAddress(h, true)).toBe('198.51.100.1');
    expect(clientAddress(h, false)).toBe('shared');
    expect(clientAddress(new Headers(), true)).toBe('shared');
  });
});

describe('upload tokens', () => {
  const secret = 'x'.repeat(40);
  const claim = {
    uploadId: '0f6a2b9e-1c3d-4e5f-8a7b-9c0d1e2f3a4b',
    n: 1,
    mime: 'image/jpeg',
    size: 1234,
    exp: 2_000,
  };

  it('verifies a valid signature and rejects any changed field, a wrong key or expiry', () => {
    const sig = signUpload(secret, claim);
    expect(verifyUpload(secret, claim, sig, 1_000)).toBe(true);
    expect(verifyUpload(secret, { ...claim, size: 9999 }, sig, 1_000)).toBe(false);
    expect(verifyUpload(secret, { ...claim, n: 2 }, sig, 1_000)).toBe(false);
    expect(verifyUpload('y'.repeat(40), claim, sig, 1_000)).toBe(false);
    expect(verifyUpload(secret, claim, sig, 3_000)).toBe(false);
    expect(verifyUpload(secret, claim, 'short', 1_000)).toBe(false);
  });

  it('builds a relative, same-origin URL', () => {
    expect(uploadUrl(claim, 'sig')).toMatch(
      /^\/api\/v1\/uploads\/0f6a2b9e-.*\/1\?mime=image%2Fjpeg&size=1234&exp=2000&sig=sig$/,
    );
  });
});

describe('image sniffing', () => {
  const root = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'images');
  it.each([
    ['dumped-tyres.jpg', 'image/jpeg'],
    ['turtle-nest.png', 'image/png'],
    ['reef-damage.webp', 'image/webp'],
  ])('recognises %s', (file, mime) => {
    expect(sniffImageMime(readFileSync(join(root, file)).subarray(0, 32))).toBe(mime);
  });

  it('recognises HEIC by its ftyp brand and treats HEIC/HEIF as one type', () => {
    const heic = new Uint8Array([0, 0, 0, 24, ...Buffer.from('ftypheic')]);
    expect(sniffImageMime(heic)).toBe('image/heic');
    expect(mimeMatches('image/heif', 'image/heic')).toBe(true);
    expect(mimeMatches('image/png', 'image/jpeg')).toBe(false);
  });

  it('rejects executables and text', () => {
    expect(sniffImageMime(Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(sniffImageMime(Buffer.from('hello world'))).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
  });
});

describe('translations', () => {
  const load = (l: string) =>
    JSON.parse(readFileSync(join(import.meta.dirname, '..', 'messages', `${l}.json`), 'utf8'));
  const keys = (o: Record<string, unknown>, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`],
    );
  const en = keys(load('en')).sort();

  it.each(['pap', 'nl', 'es'])('%s has exactly the same keys as en', (lang) => {
    expect(keys(load(lang)).sort()).toEqual(en);
  });

  it.each(['pap', 'nl', 'en', 'es'])('%s keeps every ICU placeholder', (lang) => {
    const flat = (o: Record<string, unknown>, p = ''): [string, string][] =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === 'object'
          ? flat(v as Record<string, unknown>, `${p}${k}.`)
          : [[`${p}${k}`, String(v)]],
      );
    const english = new Map(flat(load('en')));
    for (const [k, v] of flat(load(lang))) {
      const vars = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
      expect(vars(v), `${lang}:${k}`).toEqual(vars(english.get(k)!));
    }
  });
});
