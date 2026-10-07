// SPEC §4.2 observability: /healthz (process alive) and /readyz (dependencies reachable).
// Shared by web and worker. Responses contain no request data.

import { connect } from 'node:net';
import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import type postgres from 'postgres';

export interface CheckResult {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export type Check = () => Promise<void>;

export async function runCheck(name: string, check: Check, timeoutMs = 3000): Promise<CheckResult> {
  const start = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return { name, ok: true, ms: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      name,
      ok: false,
      ms: Math.round(performance.now() - start),
      error: (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const dbCheck =
  (sql: postgres.Sql): Check =>
  async () => {
    await sql`SELECT postgis_version()`;
  };

export const s3Check =
  (s3: S3Client, bucket: string): Check =>
  async () => {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  };

/** TCP connect + SMTP greeting (220) without sending anything. */
export const smtpCheck =
  (smtpUrl: string): Check =>
  () =>
    new Promise<void>((resolve, reject) => {
      const url = new URL(smtpUrl);
      const socket = connect({ host: url.hostname, port: Number(url.port || 25) });
      socket.setTimeout(2500);
      socket.once('data', (buf) => {
        socket.end();
        if (buf.toString().startsWith('220')) resolve();
        else reject(new Error(`unexpected SMTP greeting: ${buf.toString().slice(0, 40)}`));
      });
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error('SMTP timeout'));
      });
      socket.once('error', reject);
    });

export interface Readiness {
  status: 'ready' | 'not_ready';
  checks: CheckResult[];
}

export async function readiness(checks: Record<string, Check>): Promise<Readiness> {
  const results = await Promise.all(Object.entries(checks).map(([n, c]) => runCheck(n, c)));
  return { status: results.every((r) => r.ok) ? 'ready' : 'not_ready', checks: results };
}
