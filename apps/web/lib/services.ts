import 'server-only';
import { PgBoss } from 'pg-boss';
import { RealClock } from '@rocan/clock';
import { loadEnv } from '@rocan/config';
import { createDb, ensureQueues, pgBossEnqueue } from '@rocan/db';
import { createS3 } from '@rocan/media';
import type { ApiDeps } from './api/deps';
import { RateLimiter } from './rateLimit';
import { argon2Hasher } from './secrets';

// One set of clients per server process (survives dev hot reloads via globalThis).
type Services = {
  env: ReturnType<typeof loadEnv>;
  db: ReturnType<typeof createDb>;
  s3: ReturnType<typeof createS3>;
  limiter: RateLimiter;
  boss: Promise<PgBoss>;
};
const g = globalThis as typeof globalThis & { __rocan?: Services };
const clock = new RealClock();

export function services(): Services {
  if (!g.__rocan) {
    const env = loadEnv();
    // Send-only pg-boss: the worker owns supervision and schedules.
    const boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: 'pgboss',
      supervise: false,
      schedule: false,
      max: 3,
    });
    boss.on('error', (err) => console.error('[web] pg-boss error:', err.message));
    g.__rocan = {
      env,
      db: createDb(env.DATABASE_URL),
      s3: createS3(env),
      limiter: new RateLimiter(clock),
      boss: boss.start().then(async () => {
        await ensureQueues(boss);
        return boss;
      }),
    };
  }
  return g.__rocan;
}

export async function apiDeps(): Promise<ApiDeps> {
  const s = services();
  return {
    env: s.env,
    sql: s.db.sql,
    s3: s.s3,
    clock,
    enqueue: pgBossEnqueue(await s.boss),
    limiter: s.limiter,
    secrets: argon2Hasher,
  };
}
