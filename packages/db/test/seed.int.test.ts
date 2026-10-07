// SPEC §15 Phase 1: `pnpm db:reset` creates the schema and seeds reference data.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRepoConfig } from '@rocan/config';
import { createDb, dropAll, runMigrations, seed, type Sql } from '../src/index';
import { dropDatabase, freshDatabase } from './helpers';

const DB = 'rocan_it_seed';
let sql: Sql;
let url: string;
const config = loadRepoConfig();

beforeAll(async () => {
  url = await freshDatabase(DB);
  sql = createDb(url, { max: 2 }).sql;
  await runMigrations(sql);
});
afterAll(async () => {
  await sql.end();
  await dropDatabase(DB);
});

const count = async (table: string) =>
  Number((await sql.unsafe(`SELECT count(*)::int AS n FROM ${table}`))[0]!.n);

describe('migrations + seed', () => {
  it('seeds 4 agencies, 13 categories, routing rules, districts and placeholder areas', async () => {
    const summary = await seed(sql, config, { mockMode: false });
    expect(summary).toMatchObject({ agencies: 4, categories: 13, districts: 8, devUsers: 0 });
    expect(await count('agency')).toBe(4);
    expect(await count('category')).toBe(13);
    expect(await count('routing_rule')).toBe(config.routingRules.length);
    expect(await count('district')).toBe(8);
    expect(await count('protected_area')).toBe(6);
    expect(await count('coastline')).toBe(1);
    expect(await count('staff_user')).toBe(0);
    const [p] = await sql`SELECT bool_and(is_placeholder) AS all_placeholder FROM protected_area`;
    expect(p!.all_placeholder).toBe(true);
  });

  it('is idempotent', async () => {
    await seed(sql, config, { mockMode: false });
    await seed(sql, config, { mockMode: false });
    expect(await count('agency')).toBe(4);
    expect(await count('category')).toBe(13);
    expect(await count('routing_rule')).toBe(config.routingRules.length);
  });

  it('uses config intake emails outside mock mode and Mailpit inboxes in mock mode', async () => {
    const [real] =
      await sql`SELECT intake_emails::text[] AS intake_emails FROM agency WHERE code = 'DNM'`;
    expect(real!.intake_emails).toEqual(['meldingen-dnm@example.aw']);
    await seed(sql, config, { mockMode: true });
    const rows =
      await sql`SELECT code, intake_emails::text[] AS intake_emails FROM agency ORDER BY code`;
    expect(Object.fromEntries(rows.map((r) => [r.code, r.intake_emails]))).toEqual({
      ACF: ['acf-intake@rocan.test'],
      DNM: ['dnm-intake@rocan.test'],
      DOW: ['dow-intake@rocan.test'],
      OM: ['om-reports@rocan.test'],
    });
    expect(await count('staff_user')).toBe(7);
    const [om] = await sql`
      SELECT a.code FROM staff_user s JOIN agency a ON a.id = s.agency_id WHERE s.email = 'om@rocan.test'`;
    expect(om!.code).toBe('OM');
  });

  it('stores routing rules with categories and agencies resolved', async () => {
    const rows = await sql`
      SELECT r.priority, c.code AS category, a.code AS agency, r.role, r.condition
      FROM routing_rule r JOIN agency a ON a.id = r.agency_id
      LEFT JOIN category c ON c.id = r.category_id ORDER BY r.priority`;
    expect(rows.map((r) => [r.priority, r.category ?? '*', r.agency, r.role])).toEqual(
      config.routingRules.map((r) => [r.priority, r.category, r.agency, r.role]),
    );
    expect(rows[0]!.condition).toEqual({ in_area_managed_by: 'ACF' });
  });

  it('protected areas are linked to the managing agency', async () => {
    const rows = await sql`
      SELECT p.code, a.code AS manager FROM protected_area p
      LEFT JOIN agency a ON a.id = p.managed_by_agency ORDER BY p.code`;
    expect(Object.fromEntries(rows.map((r) => [r.code, r.manager]))).toMatchObject({
      ARIKOK_NP: 'ACF',
      PMA_MANGEL_HALTO: 'ACF',
      SPAANS_LAGOEN: null,
    });
  });

  it('has the launch-default settings: automation off', async () => {
    const rows = await sql`SELECT key, value FROM setting`;
    const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(s['automation.auto_dispatch_enabled']).toBe(false);
    expect(s['automation.auto_om_delivery_enabled']).toBe(false);
    expect(s['sla.default_ack_days']).toBe(7);
  });

  it('audit_log is append-only', async () => {
    await sql`
      INSERT INTO audit_log (actor_type, action, entity, hash)
      VALUES ('system', 'test.write', 'test', '\\x00')`;
    await expect(sql`UPDATE audit_log SET action = 'tampered'`).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM audit_log`).rejects.toThrow(/append-only/);
  });

  it('enforces report constraints (rejection needs a reason)', async () => {
    const insert = (status: string, reason: string | null) => sql`
      INSERT INTO report (public_code, follow_up_token_hash, idempotency_key, status, client_created_at,
                          ui_language, location, location_source, rejection_reason)
      VALUES (${'RC-' + Math.random().toString(36).slice(2, 10)}, '\\x00', gen_random_uuid(), ${status},
              now(), 'pap', ST_SetSRID(ST_MakePoint(-70.0, 12.5), 4326), 'gps', ${reason})`;
    await expect(insert('rejected', null)).rejects.toThrow(/rejection_needs_reason/);
    await expect(insert('rejected', 'spam')).resolves.toBeDefined();
  });

  it('dropAll + migrate gives a clean, re-seedable database (db:reset path)', async () => {
    await dropAll(sql);
    await runMigrations(sql);
    // Types were recreated, so cached statement plans are stale: reconnect like the CLI does.
    await sql.end();
    sql = createDb(url, { max: 2 }).sql;
    expect(await count('agency')).toBe(0);
    await seed(sql, config, { mockMode: true });
    expect(await count('agency')).toBe(4);
  });
});
