// The placeholder map layers must agree with fixtures/aruba-places.yaml: PostGIS has to put
// every test location in exactly the protected area its `area_hint` names (used by the pure
// routing table test), on the right side of the coastline, and in one district.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRepoConfig } from '@rocan/config';
import { createDb, runMigrations, seed, type Sql } from '@rocan/db';
import postgres from 'postgres';
import { loadPlaces } from '../src/index';

const DB = 'rocan_it_geo';
let sql: Sql;
const { places, outside_points: outside, bounds } = loadPlaces();

async function admin(statement: string): Promise<void> {
  const a = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await a.unsafe(statement);
  } finally {
    await a.end();
  }
}

beforeAll(async () => {
  await admin(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin(`CREATE DATABASE ${DB}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${DB}`;
  sql = createDb(url.toString(), { max: 2 }).sql;
  await runMigrations(url.toString());
  await seed(sql, loadRepoConfig(), { mockMode: false });
});
afterAll(async () => {
  await sql.end();
  await admin(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
});

const pt = (lon: number, lat: number) => sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`;

describe('placeholder geo layers vs fixtures/aruba-places.yaml', () => {
  for (const place of places) {
    it(`${place.name}: area=${place.area_hint ?? 'none'}, ${place.marine ? 'sea' : 'land'}`, async () => {
      const p = pt(place.lon, place.lat);
      const areas =
        await sql`SELECT code FROM protected_area WHERE ST_Contains(geom, ${p}) ORDER BY code`;
      expect(areas.map((a) => a.code)).toEqual(place.area_hint ? [place.area_hint] : []);

      const [land] =
        await sql`SELECT ST_Contains(geom, ${p}) AS on_land FROM coastline WHERE id = 1`;
      expect(land!.on_land).toBe(!place.marine);

      expect(place.lat).toBeGreaterThanOrEqual(bounds.min_lat);
      expect(place.lat).toBeLessThanOrEqual(bounds.max_lat);
      expect(place.lon).toBeGreaterThanOrEqual(bounds.min_lon);
      expect(place.lon).toBeLessThanOrEqual(bounds.max_lon);

      if (!place.marine) {
        const districts = await sql`SELECT code FROM district WHERE ST_Contains(geom, ${p})`;
        expect(districts).toHaveLength(1);
      }
    });
  }

  for (const o of outside) {
    it(`${o.name} is more than 3 km from Aruba (SPEC §9.3)`, async () => {
      const [r] = await sql`
        SELECT ST_DWithin(geom::geography, ${pt(o.lon, o.lat)}::geography, 3000) AS near
        FROM coastline WHERE id = 1`;
      expect(r!.near).toBe(false);
    });
  }

  it('districts tile the island without overlapping', async () => {
    const [r] = await sql`
      SELECT abs(ST_Area((SELECT ST_Union(geom) FROM district)::geography)
                 - ST_Area((SELECT geom FROM coastline)::geography)) AS diff_m2,
             (SELECT count(*) FROM district a JOIN district b ON a.id < b.id
              AND ST_Area(ST_Intersection(a.geom, b.geom)::geography) > 1) AS overlaps`;
    expect(Number(r!.diff_m2)).toBeLessThan(1000);
    expect(Number(r!.overlaps)).toBe(0);
  });

  it('the island is roughly the size of Aruba (~180 km²)', async () => {
    const [r] = await sql`SELECT ST_Area(geom::geography) / 1e6 AS km2 FROM coastline`;
    expect(Number(r!.km2)).toBeGreaterThan(140);
    expect(Number(r!.km2)).toBeLessThan(220);
  });
});
