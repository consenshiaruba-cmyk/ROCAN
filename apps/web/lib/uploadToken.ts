// SPEC §5.3: per-file upload URLs, signed so only files announced in POST /uploads can be PUT.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface UploadClaim {
  uploadId: string;
  n: number;
  mime: string;
  size: number;
  /** Expiry, epoch ms. */
  exp: number;
}

const payload = (c: UploadClaim) => `${c.uploadId}.${c.n}.${c.mime}.${c.size}.${c.exp}`;

export function signUpload(secret: string, claim: UploadClaim): string {
  return createHmac('sha256', secret).update(payload(claim)).digest('base64url');
}

export function verifyUpload(
  secret: string,
  claim: UploadClaim,
  sig: string,
  nowMs: number,
): boolean {
  if (!Number.isFinite(claim.exp) || claim.exp < nowMs) return false;
  const expected = Buffer.from(signUpload(secret, claim));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function uploadUrl(claim: UploadClaim, sig: string): string {
  const q = new URLSearchParams({
    mime: claim.mime,
    size: String(claim.size),
    exp: String(claim.exp),
    sig,
  });
  return `/api/v1/uploads/${claim.uploadId}/${claim.n}?${q.toString()}`;
}

export function incomingKey(uploadId: string, n: number): string {
  return `${uploadId}/${n}`;
}
