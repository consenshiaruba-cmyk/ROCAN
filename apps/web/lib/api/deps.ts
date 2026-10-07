// Dependencies for the API handlers. Handlers are plain functions (Request → Response) so
// integration tests can call them directly against real services, without a Next server.

import type { S3Client } from '@aws-sdk/client-s3';
import type { Clock } from '@rocan/clock';
import type { Env } from '@rocan/config';
import type { Enqueue, Sql } from '@rocan/db';
import type { RateLimiter } from '../rateLimit';

export interface SecretHasher {
  hash(secret: string): Promise<string>;
  verify(hash: string, secret: string): Promise<boolean>;
}

export interface ApiDeps {
  env: Env;
  sql: Sql;
  s3: S3Client;
  clock: Clock;
  enqueue: Enqueue;
  limiter: RateLimiter;
  secrets: SecretHasher;
}

const NO_STORE = { 'cache-control': 'no-store' };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function error(status: number, code: string, details?: unknown): Response {
  return json(details === undefined ? { error: code } : { error: code, details }, status);
}

export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > maxBytes) throw new BodyError('payload_too_large', 413);
  const text = await req.text();
  if (text.length > maxBytes) throw new BodyError('payload_too_large', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new BodyError('invalid_json', 400);
  }
}

export class BodyError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

/** Zod issues without echoing user input back. */
export function issues(err: { issues: { path: PropertyKey[]; message: string }[] }) {
  return err.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}

export async function guarded(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BodyError) return error(err.status, err.code);
    // Log the failure without request details (SPEC §13.1).
    console.error('[api] unhandled error:', (err as Error).message);
    return error(500, 'internal_error');
  }
}
