import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Sql = postgres.Sql;

/** A connection or an open transaction. */
export type Queryable = postgres.Sql | postgres.TransactionSql;

/**
 * Raw postgres.js client for the app's SQL. Drizzle gets its own client, created on first use:
 * `drizzle(client)` replaces the client's date/JSON parsers and serializers, which would change
 * what raw queries return (Date → string) and accept.
 */
export function createDb(url: string, options: postgres.Options<Record<string, never>> = {}) {
  const sql = postgres(url, { max: 5, onnotice: () => {}, ...options });
  let orm: ReturnType<typeof drizzle<typeof schema>> | undefined;
  return {
    sql,
    get db() {
      orm ??= drizzle(postgres(url, { max: 2, onnotice: () => {} }), { schema });
      return orm;
    },
  };
}

export type Db = ReturnType<typeof createDb>['db'];
