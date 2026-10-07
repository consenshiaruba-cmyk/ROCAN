// POST /api/v1/uploads and PUT /api/v1/uploads/:uploadId/:n (SPEC §5.3).
// Photos travel through the app (same origin) instead of straight to object storage: no
// storage CORS, no storage access logs holding client addresses (phase-2 decision 1).

import { randomUUID } from 'node:crypto';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { CreateUploadSchema, MAX_PHOTO_BYTES, MAX_PHOTOS } from '@rocan/core';
import { mimeMatches, sniffImageMime } from '@rocan/media';
import { clientAddress } from '../rateLimit';
import { incomingKey, signUpload, uploadUrl, verifyUpload } from '../uploadToken';
import { error, guarded, issues, json, readJson, type ApiDeps } from './deps';

const UPLOAD_TTL_MS = 60 * 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createUpload(req: Request, deps: ApiDeps): Promise<Response> {
  return guarded(async () => {
    const parsed = CreateUploadSchema.safeParse(await readJson(req));
    if (!parsed.success) return error(400, 'invalid_request', issues(parsed.error));
    const key = deps.limiter.keyFor(clientAddress(req.headers, deps.env.TRUST_PROXY));
    const files = parsed.data.files;
    if (
      !deps.limiter.consume(
        { name: 'uploads', perHour: deps.env.RATE_LIMIT_UPLOADS_PER_HOUR },
        key,
        files.length,
      )
    ) {
      return error(429, 'rate_limited');
    }
    const uploadId = randomUUID();
    const exp = deps.clock.now().getTime() + UPLOAD_TTL_MS;
    return json(
      {
        upload_id: uploadId,
        expires_at: new Date(exp).toISOString(),
        files: files.map((f, i) => {
          const claim = { uploadId, n: i + 1, mime: f.mime, size: f.size, exp };
          return {
            n: i + 1,
            url: uploadUrl(claim, signUpload(deps.env.UPLOAD_TOKEN_SECRET, claim)),
          };
        }),
      },
      201,
    );
  });
}

export function putUpload(
  req: Request,
  params: { uploadId: string; n: string },
  deps: ApiDeps,
): Promise<Response> {
  return guarded(async () => {
    const url = new URL(req.url);
    const n = Number(params.n);
    const claim = {
      uploadId: params.uploadId,
      n,
      mime: url.searchParams.get('mime') ?? '',
      size: Number(url.searchParams.get('size')),
      exp: Number(url.searchParams.get('exp')),
    };
    if (!UUID_RE.test(claim.uploadId) || !Number.isInteger(n) || n < 1 || n > MAX_PHOTOS) {
      return error(404, 'not_found');
    }
    const sig = url.searchParams.get('sig') ?? '';
    if (!verifyUpload(deps.env.UPLOAD_TOKEN_SECRET, claim, sig, deps.clock.now().getTime())) {
      return error(403, 'invalid_upload_token');
    }
    const declared = Number(req.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared !== claim.size) return error(400, 'size_mismatch');

    const body = new Uint8Array(await req.arrayBuffer());
    if (body.byteLength > MAX_PHOTO_BYTES) return error(413, 'payload_too_large');
    if (body.byteLength !== claim.size) return error(400, 'size_mismatch');
    const sniffed = sniffImageMime(body.subarray(0, 32));
    if (!sniffed || !mimeMatches(claim.mime, sniffed)) return error(415, 'not_an_image');

    await deps.s3.send(
      new PutObjectCommand({
        Bucket: deps.env.S3_BUCKET_INCOMING,
        Key: incomingKey(claim.uploadId, n),
        Body: body,
        ContentType: sniffed,
        ContentLength: body.byteLength,
      }),
    );
    return json({ n, stored: true }, 201);
  });
}

/** Returns the numbers of missing photos (empty when all are present). */
export async function missingPhotos(
  deps: ApiDeps,
  uploadId: string,
  count: number,
): Promise<number[]> {
  const missing: number[] = [];
  for (let n = 1; n <= count; n++) {
    try {
      await deps.s3.send(
        new HeadObjectCommand({
          Bucket: deps.env.S3_BUCKET_INCOMING,
          Key: incomingKey(uploadId, n),
        }),
      );
    } catch {
      missing.push(n);
    }
  }
  return missing;
}
