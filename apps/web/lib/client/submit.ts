// Browser side of SPEC §5.3: announce photos, upload each one, then create the report.
// The idempotency key and follow-up secret are created once per wizard session, so a retry
// after a lost response returns the same report (and the reporter keeps the same secret).

import type { CreateReport } from '@rocan/core';

export type SubmitError = 'network' | 'rateLimited' | 'outside' | 'photos' | 'generic';

export class SubmitFailure extends Error {
  constructor(readonly kind: SubmitError) {
    super(kind);
  }
}

async function call(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { ...init, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new SubmitFailure('network');
  }
}

function failureFor(res: Response, body: { error?: string } | null): SubmitFailure {
  if (res.status === 429) return new SubmitFailure('rateLimited');
  if (body?.error === 'outside_aruba') return new SubmitFailure('outside');
  if (body?.error === 'photos_missing') return new SubmitFailure('photos');
  return new SubmitFailure('generic');
}

/** Photos with a usable MIME type (some browsers leave HEIC files untyped). */
export function photoMime(file: File): string | null {
  const t = file.type.toLowerCase();
  if (['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(t)) return t;
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return null;
}

export interface SubmitInput {
  photos: File[];
  report: Omit<CreateReport, 'upload_id' | 'photo_count'>;
  /** Reused across retries so photos are not uploaded twice. */
  uploadId?: string;
}

export async function submitReport(
  input: SubmitInput,
  onProgress: (done: number, total: number) => void,
): Promise<{ publicCode: string; uploadId: string }> {
  let uploadId = input.uploadId;
  if (!uploadId) {
    const res = await call('/api/v1/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        files: input.photos.map((f) => ({ mime: photoMime(f), size: f.size })),
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      upload_id: string;
      files: { n: number; url: string }[];
      error?: string;
    } | null;
    if (!res.ok || !body) throw failureFor(res, body);
    onProgress(0, input.photos.length);
    for (const [i, f] of body.files.entries()) {
      const photo = input.photos[i]!;
      const put = await call(f.url, {
        method: 'PUT',
        headers: { 'content-type': photoMime(photo) ?? 'application/octet-stream' },
        body: photo,
      });
      if (!put.ok)
        throw put.status === 429 ? new SubmitFailure('rateLimited') : new SubmitFailure('photos');
      onProgress(i + 1, input.photos.length);
    }
    uploadId = body.upload_id;
  }

  const res = await call('/api/v1/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...input.report,
      upload_id: uploadId,
      photo_count: input.photos.length,
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    public_code?: string;
    error?: string;
  } | null;
  if (!res.ok || !body?.public_code) {
    const failure = failureFor(res, body);
    // Photos are already stored; a retry only needs the report call.
    (failure as SubmitFailure & { uploadId?: string }).uploadId = uploadId;
    throw failure;
  }
  return { publicCode: body.public_code, uploadId };
}

export const LAST_REPORT_KEY = 'rocan.lastReport';

export interface LastReport {
  code: string;
  secret: string;
}

export function saveLastReport(r: LastReport): void {
  try {
    sessionStorage.setItem(LAST_REPORT_KEY, JSON.stringify(r));
  } catch {
    // Private mode: the done page then shows nothing to recover, which is acceptable.
  }
}

export function loadLastReport(): LastReport | null {
  try {
    const raw = sessionStorage.getItem(LAST_REPORT_KEY);
    return raw ? (JSON.parse(raw) as LastReport) : null;
  } catch {
    return null;
  }
}
