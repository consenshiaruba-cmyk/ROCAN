// pnpm db:reset: drop, migrate, seed. Refuses to run against production.
import { loadRepoConfig } from '@rocan/config';
import { dropAll, runMigrations } from '../migrate';
import { seed } from '../seed';
import { cliDb, isMockMode, main } from './common';

await main(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('db:reset is disabled in production');
  const mockMode = isMockMode();
  const first = cliDb();
  try {
    await dropAll(first.sql);
    await runMigrations(first.sql);
  } finally {
    await first.sql.end();
  }
  // Fresh connection: enum types were recreated, so earlier statement plans are stale.
  const { sql } = cliDb();
  try {
    console.log('seeded', await seed(sql, loadRepoConfig(), { mockMode }));
  } finally {
    await sql.end();
  }
});
