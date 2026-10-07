// Seeds reference data from config/*.yaml and config/areas/*.geojson (SPEC §7, §10).
// Idempotent: safe to run on every deploy. Routing rules are replaced wholesale so the
// database always matches the committed config.

import type { RepoConfig } from '@rocan/config';
import type { Sql } from './client';

/** MOCK_TESTING §1.2. Only seeded when MOCK_MODE=1. */
export const DEV_USERS = [
  { email: 'admin@rocan.test', name: 'Dev Admin', role: 'admin', agency: null },
  { email: 'mod@rocan.test', name: 'Dev Moderator', role: 'moderator', agency: null },
  { email: 'dnm@rocan.test', name: 'Dev DNM', role: 'agency_user', agency: 'DNM' },
  { email: 'acf@rocan.test', name: 'Dev ACF', role: 'agency_user', agency: 'ACF' },
  { email: 'dow@rocan.test', name: 'Dev DOW', role: 'agency_user', agency: 'DOW' },
  { email: 'om@rocan.test', name: 'Dev OM', role: 'om_user', agency: 'OM' },
  { email: 'audit@rocan.test', name: 'Dev Auditor', role: 'auditor', agency: null },
] as const;

/** In mock mode every agency gets its own Mailpit inbox (MOCK_TESTING §1.2). */
export function mockIntakeEmail(code: string): string {
  return code === 'OM' ? 'om-reports@rocan.test' : `${code.toLowerCase()}-intake@rocan.test`;
}

export interface SeedOptions {
  mockMode: boolean;
}

export interface SeedSummary {
  agencies: number;
  categories: number;
  routingRules: number;
  districts: number;
  protectedAreas: number;
  devUsers: number;
}

export async function seed(sql: Sql, config: RepoConfig, opts: SeedOptions): Promise<SeedSummary> {
  return sql.begin(async (tx) => {
    for (const a of config.agencies) {
      const emails = opts.mockMode ? [mockIntakeEmail(a.code)] : a.intake_emails;
      await tx`
        INSERT INTO agency (code, short_name, official_name, intake_emails, ack_sla_days,
                            receives_incidents, digest_enabled)
        VALUES (${a.code}, ${a.short_name}, ${a.official_name}, ${tx.array(emails)}::citext[],
                ${a.ack_sla_days}, ${a.receives_incidents}, ${a.digest_enabled})
        ON CONFLICT (code) DO UPDATE SET
          short_name = EXCLUDED.short_name, official_name = EXCLUDED.official_name,
          intake_emails = EXCLUDED.intake_emails, ack_sla_days = EXCLUDED.ack_sla_days,
          receives_incidents = EXCLUDED.receives_incidents,
          digest_enabled = EXCLUDED.digest_enabled`;
    }

    for (const c of config.categories) {
      await tx`
        INSERT INTO category (code, sort_order, name, description, severity_weight, is_marine, legal_refs)
        VALUES (${c.code}, ${c.sort_order}, ${JSON.stringify(c.name)}::jsonb, ${JSON.stringify(c.description)}::jsonb,
                ${String(c.severity_weight)}, ${c.is_marine}, ${JSON.stringify(c.legal_refs)}::jsonb)
        ON CONFLICT (code) DO UPDATE SET
          sort_order = EXCLUDED.sort_order, name = EXCLUDED.name,
          description = EXCLUDED.description, severity_weight = EXCLUDED.severity_weight,
          is_marine = EXCLUDED.is_marine, legal_refs = EXCLUDED.legal_refs`;
    }

    const land = config.coastline.features[0];
    if (!land) throw new Error('config/areas/coastline.geojson has no features');
    await tx`
      INSERT INTO coastline (id, geom)
      VALUES (1, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(land.geometry)}), 4326)))
      ON CONFLICT (id) DO UPDATE SET geom = EXCLUDED.geom`;

    // District boxes are clipped to the land polygon so they follow the coastline.
    for (const d of config.districts.features) {
      await tx`
        INSERT INTO district (code, name, geom)
        SELECT ${d.properties.code}, ${d.properties.name},
               ST_Multi(ST_CollectionExtract(ST_Intersection(
                 ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(d.geometry)}), 4326), c.geom), 3))
        FROM coastline c WHERE c.id = 1
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, geom = EXCLUDED.geom`;
    }

    for (const f of config.protectedAreas.features) {
      const p = f.properties;
      await tx`
        INSERT INTO protected_area (code, name, kind, managed_by_agency, is_marine, geom, source, is_placeholder)
        VALUES (${p.code}, ${p.name}, ${p.kind},
                (SELECT id FROM agency WHERE code = ${p.managed_by}),
                ${p.is_marine},
                ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}), 4326)),
                ${p.source}, ${/PLACEHOLDER/.test(p.source)})
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name, kind = EXCLUDED.kind, managed_by_agency = EXCLUDED.managed_by_agency,
          is_marine = EXCLUDED.is_marine, geom = EXCLUDED.geom, source = EXCLUDED.source,
          is_placeholder = EXCLUDED.is_placeholder`;
    }

    await tx`DELETE FROM routing_rule`;
    for (const r of config.routingRules) {
      await tx`
        INSERT INTO routing_rule (priority, category_id, condition, agency_id, role, note, active)
        VALUES (${r.priority},
                ${r.category === '*' ? null : tx`(SELECT id FROM category WHERE code = ${r.category})`},
                ${JSON.stringify(r.when)}::jsonb,
                (SELECT id FROM agency WHERE code = ${r.agency}),
                ${r.role}, ${r.note ?? null}, ${r.active})`;
    }

    let devUsers = 0;
    if (opts.mockMode) {
      for (const u of DEV_USERS) {
        await tx`
          INSERT INTO staff_user (email, name, role, agency_id)
          VALUES (${u.email}, ${u.name}, ${u.role},
                  ${u.agency === null ? null : tx`(SELECT id FROM agency WHERE code = ${u.agency})`})
          ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role,
            agency_id = EXCLUDED.agency_id`;
        devUsers++;
      }
    }

    return {
      agencies: config.agencies.length,
      categories: config.categories.length,
      routingRules: config.routingRules.length,
      districts: config.districts.features.length,
      protectedAreas: config.protectedAreas.features.length,
      devUsers,
    };
  });
}
