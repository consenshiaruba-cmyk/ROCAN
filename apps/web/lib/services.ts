import 'server-only';
import { loadEnv } from '@rocan/config';
import { createDb } from '@rocan/db';
import { createS3 } from '@rocan/media';

// One set of clients per server process (survives dev hot reloads via globalThis).
type Services = {
  env: ReturnType<typeof loadEnv>;
  db: ReturnType<typeof createDb>;
  s3: ReturnType<typeof createS3>;
};
const g = globalThis as typeof globalThis & { __rocan?: Services };

export function services(): Services {
  if (!g.__rocan) {
    const env = loadEnv();
    g.__rocan = { env, db: createDb(env.DATABASE_URL), s3: createS3(env) };
  }
  return g.__rocan;
}
