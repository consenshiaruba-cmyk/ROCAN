// Background worker (SPEC §9). Phase 1: boots pg-boss and serves health checks.
// Job handlers are added per phase in src/jobs/.

import { PgBoss } from 'pg-boss';
import { loadEnv } from '@rocan/config';
import { createDb, ensureQueues } from '@rocan/db';
import { dbCheck, s3Check, smtpCheck } from '@rocan/health';
import { createS3 } from '@rocan/media';
import { startHealthServer } from './server';

const env = loadEnv(); // throws on MOCK_MODE=1 in production (SPEC Appendix A)
const port = Number(process.env.WORKER_PORT ?? 3001);

const { sql } = createDb(env.DATABASE_URL);
const s3 = createS3(env);
const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });
boss.on('error', (err) => console.error('[worker] pg-boss error:', err.message));

let bossStarted = false;
await boss.start();
await ensureQueues(boss);
bossStarted = true;

const server = startHealthServer(port, () => ({
  database: dbCheck(sql),
  storage: s3Check(s3, env.S3_BUCKET_VAULT),
  smtp: smtpCheck(env.SMTP_URL),
  queue: async () => {
    if (!bossStarted) throw new Error('pg-boss not started');
  },
}));
console.log(`[worker] ready on :${port} (mock mode: ${env.MOCK_MODE ? 'on' : 'off'})`);

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal}, shutting down`);
  bossStarted = false;
  server.close();
  await boss.stop({ graceful: true, timeout: 10_000 });
  await sql.end({ timeout: 5 });
  s3.destroy();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
