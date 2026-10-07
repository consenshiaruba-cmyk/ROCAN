// Real services for API integration tests: a fresh database, private buckets, pg-boss.
import { randomUUID } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import { PgBoss } from 'pg-boss';
import postgres from 'postgres';
import { FrozenClock } from '@rocan/clock';
import { loadEnv, loadRepoConfig, type Env } from '@rocan/config';
import { createDb, ensureQueues, pgBossEnqueue, runMigrations, seed, type Sql } from '@rocan/db';
import { createS3, ensureBuckets } from '@rocan/media';
import type { ApiDeps } from '../lib/api/deps';
import { RateLimiter } from '../lib/rateLimit';
import { argon2Hasher } from '../lib/secrets';

export interface TestStack {
  deps: ApiDeps;
  clock: FrozenClock;
  boss: PgBoss;
  close(): Promise<void>;
}

async function admin(statement: string): Promise<void> {
  const a = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await a.unsafe(statement);
  } finally {
    await a.end();
  }
}

export async function startStack(
  dbName: string,
  overrides: Record<string, string> = {},
): Promise<TestStack> {
  await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin(`CREATE DATABASE ${dbName}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${dbName}`;
  const suffix = randomUUID().slice(0, 8);
  const env: Env = loadEnv({
    ...process.env,
    DATABASE_URL: url.toString(),
    S3_BUCKET_INCOMING: `it-in-${suffix}`,
    S3_BUCKET_VAULT: `it-vault-${suffix}`,
    S3_BUCKET_DERIVATIVES: `it-der-${suffix}`,
    S3_BUCKET_REPORTS: `it-rep-${suffix}`,
    VAULT_LOCK_DAYS: '1',
    ...overrides,
  });
  const { sql } = createDb(env.DATABASE_URL, { max: 4 });
  await runMigrations(env.DATABASE_URL);
  await seed(sql, loadRepoConfig(), { mockMode: true });
  const s3: S3Client = createS3(env);
  await ensureBuckets(s3, env);
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: 'pgboss',
    supervise: false,
    schedule: false,
  });
  await boss.start();
  await ensureQueues(boss);
  const clock = new FrozenClock('2026-10-07T14:00:00Z');
  const deps: ApiDeps = {
    env,
    sql,
    s3,
    clock,
    enqueue: pgBossEnqueue(boss),
    limiter: new RateLimiter(clock),
    secrets: argon2Hasher,
  };
  return {
    deps,
    clock,
    boss,
    async close() {
      await boss.stop({ graceful: false });
      await sql.end();
      s3.destroy();
      await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    },
  };
}

export function sqlOf(stack: TestStack): Sql {
  return stack.deps.sql;
}

/** Smallest valid JPEG header + padding: enough for magic-byte sniffing. */
export function fakeJpeg(size = 2048): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  return b;
}
