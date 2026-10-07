import { runMigrations } from '../migrate';
import { cliDb, main } from './common';

await main(async () => {
  const { sql } = cliDb();
  try {
    await runMigrations(sql);
    console.log('migrations applied');
  } finally {
    await sql.end();
  }
});
