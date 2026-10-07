import { runMigrations } from '../migrate';
import { cliUrl, main } from './common';

await main(async () => {
  await runMigrations(cliUrl());
  console.log('migrations applied');
});
