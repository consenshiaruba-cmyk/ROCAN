// CLAUDE.md: Drizzle migrations must produce a schema equivalent to db/schema.sql.
// Compares columns, enums, constraints, indexes, views, triggers and seeded settings.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@rocan/config';
import { createDb, runMigrations, type Sql } from '../src/index';
import { dropDatabase, freshDatabase } from './helpers';

let migrated: Sql;
let reference: Sql;

beforeAll(async () => {
  migrated = createDb(await freshDatabase('rocan_it_eq_migrated'), { max: 1 }).sql;
  reference = createDb(await freshDatabase('rocan_it_eq_reference'), { max: 1 }).sql;
  await runMigrations(migrated);
  await reference.unsafe(readFileSync(join(REPO_ROOT, 'db/schema.sql'), 'utf8'));
});
afterAll(async () => {
  await migrated.end();
  await reference.end();
  await dropDatabase('rocan_it_eq_migrated');
  await dropDatabase('rocan_it_eq_reference');
});

const APP_TABLES = `c.relnamespace = 'public'::regnamespace
  AND c.relname NOT IN ('spatial_ref_sys', 'geography_columns', 'geometry_columns')`;

const queries: Record<string, string> = {
  columns: `
    SELECT c.relname || '.' || a.attname AS key,
           format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
           pg_get_expr(d.adbin, d.adrelid) AS default
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE c.relkind IN ('r', 'v') AND a.attnum > 0 AND NOT a.attisdropped AND ${APP_TABLES}
    ORDER BY 1`,
  enums: `
    SELECT t.typname AS key, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text AS labels
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typnamespace = 'public'::regnamespace GROUP BY 1 ORDER BY 1`,
  // Constraint names differ between Drizzle and Postgres defaults; compare definitions.
  constraints: `
    SELECT c.relname || ' ' || pg_get_constraintdef(k.oid) AS key
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
    WHERE ${APP_TABLES} ORDER BY 1`,
  indexes: `
    SELECT regexp_replace(pg_get_indexdef(i.indexrelid), 'INDEX \\S+ ON', 'INDEX ON') AS key
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
    WHERE ${APP_TABLES} ORDER BY 1`,
  views: `SELECT viewname AS key, definition FROM pg_views WHERE schemaname = 'public'
          AND viewname NOT IN ('geography_columns', 'geometry_columns') ORDER BY 1`,
  triggers: `SELECT tgname AS key, pg_get_triggerdef(oid) AS def FROM pg_trigger
             WHERE NOT tgisinternal ORDER BY 1`,
  extensions: `SELECT extname AS key FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`,
  settings: `SELECT key, value::text FROM setting ORDER BY 1`,
};

describe('Drizzle migrations ≡ db/schema.sql', () => {
  for (const [name, query] of Object.entries(queries)) {
    it(name, async () => {
      const [a, b] = await Promise.all([migrated.unsafe(query), reference.unsafe(query)]);
      expect(a.length, `${name}: no rows`).toBeGreaterThan(0);
      expect([...a]).toEqual([...b]);
    });
  }
});
