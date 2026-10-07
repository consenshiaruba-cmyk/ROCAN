import { loadRepoConfig } from '@rocan/config';
import { seed } from '../seed';
import { cliDb, isMockMode, main } from './common';

await main(async () => {
  const { sql } = cliDb();
  try {
    console.log('seeded', await seed(sql, loadRepoConfig(), { mockMode: isMockMode() }));
  } finally {
    await sql.end();
  }
});
