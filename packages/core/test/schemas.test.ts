import { describe, expect, it } from 'vitest';
import { CreateReportSchema, CreateUploadSchema, MAX_PHOTO_BYTES, TrackSchema } from '../src/index';

const valid = {
  idempotency_key: '7b0e6a52-9a5a-4f3b-8f35-3a2b1c0d9e8f',
  upload_id: '0f6a2b9e-1c3d-4e5f-8a7b-9c0d1e2f3a4b',
  photo_count: 2,
  client_created_at: '2026-10-07T10:00:00-04:00',
  location: { lat: 12.5545, lon: -70.056 },
  location_accuracy_m: 12,
  location_source: 'gps',
  category_code: 'SEA_TURTLE',
  description: 'Nest dug up',
  observed_at: null,
  is_ongoing: true,
  ui_language: 'pap',
  offline: false,
  follow_up_secret: 'Abandon ability able about above absent',
};

describe('CreateReportSchema', () => {
  it('accepts a valid report and normalizes the secret', () => {
    const r = CreateReportSchema.parse(valid);
    expect(r.follow_up_secret).toBe('abandon ability able about above absent');
  });

  it('allows "not sure" (no category) and an empty description', () => {
    expect(
      CreateReportSchema.safeParse({ ...valid, category_code: null, description: null }).success,
    ).toBe(true);
  });

  it.each([
    ['unknown field', { ...valid, ip: '1.2.3.4' }],
    ['bad secret', { ...valid, follow_up_secret: 'one two three' }],
    ['too many photos', { ...valid, photo_count: 6 }],
    ['no photos', { ...valid, photo_count: 0 }],
    ['long description', { ...valid, description: 'x'.repeat(2001) }],
    ['bad language', { ...valid, ui_language: 'fr' }],
    ['bad category', { ...valid, category_code: 'LITTERING' }],
    ['naive datetime', { ...valid, client_created_at: '2026-10-07T10:00:00' }],
  ])('rejects %s', (_name, body) => {
    expect(CreateReportSchema.safeParse(body).success).toBe(false);
  });
});

describe('CreateUploadSchema', () => {
  it('limits count, size and type', () => {
    const f = { mime: 'image/jpeg', size: 1000 };
    expect(CreateUploadSchema.safeParse({ files: [f] }).success).toBe(true);
    expect(CreateUploadSchema.safeParse({ files: Array(6).fill(f) }).success).toBe(false);
    expect(
      CreateUploadSchema.safeParse({ files: [{ ...f, size: MAX_PHOTO_BYTES + 1 }] }).success,
    ).toBe(false);
    expect(
      CreateUploadSchema.safeParse({ files: [{ ...f, mime: 'application/x-msdownload' }] }).success,
    ).toBe(false);
  });
});

describe('TrackSchema', () => {
  it('normalizes the code', () => {
    expect(TrackSchema.parse({ code: 'rc 7kq2 m9xd', secret: 'x' }).code).toBe('RC-7KQ2-M9XD');
    expect(TrackSchema.safeParse({ code: 'nope', secret: 'x' }).success).toBe(false);
  });
});
