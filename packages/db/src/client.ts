import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Sql = postgres.Sql;
export type Db = ReturnType<typeof createDb>['db'];

export function createDb(url: string, options: postgres.Options<Record<string, never>> = {}) {
  const sql = postgres(url, { max: 5, onnotice: () => {}, ...options });
  return { sql, db: drizzle(sql, { schema }) };
}
