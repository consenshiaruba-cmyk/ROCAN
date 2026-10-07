import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Sql } from './client';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function runMigrations(sql: Sql): Promise<void> {
  await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_DIR });
}

/** Drop everything the app owns (public schema, Drizzle bookkeeping, pg-boss queues). */
export async function dropAll(sql: Sql): Promise<void> {
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS public CASCADE;
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP SCHEMA IF EXISTS pgboss CASCADE;
    CREATE SCHEMA public;
  `);
}
