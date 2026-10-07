// GET /api/v1/meta: categories, island geometry and limits for the PWA (SPEC Appendix B).
import {
  ARUBA_SEA_BUFFER_M,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  type MultiPolygonCoords,
} from '@rocan/core';
import type { Sql } from '@rocan/db';

export interface Meta {
  categories: {
    code: string;
    name: Record<string, string>;
    description: Record<string, string>;
    is_marine: boolean;
  }[];
  land: MultiPolygonCoords;
  areas: { code: string; name: string; kind: string; geometry: MultiPolygonCoords }[];
  bounds: [[number, number], [number, number]];
  sea_buffer_m: number;
  limits: { max_photos: number; max_photo_bytes: number };
  provisional_boundaries: boolean;
}

export async function loadMeta(sql: Sql): Promise<Meta> {
  const categories = await sql<Meta['categories']>`
    SELECT code, name, description, is_marine FROM category WHERE active ORDER BY sort_order`;
  const [land] = await sql<
    { geom: string; xmin: number; ymin: number; xmax: number; ymax: number }[]
  >`
    SELECT ST_AsGeoJSON(geom, 5) AS geom,
           ST_XMin(geom) AS xmin, ST_YMin(geom) AS ymin, ST_XMax(geom) AS xmax, ST_YMax(geom) AS ymax
    FROM coastline WHERE id = 1`;
  if (!land) throw new Error('coastline not seeded');
  const areas = await sql<
    { code: string; name: string; kind: string; geom: string; placeholder: boolean }[]
  >`
    SELECT code, name, kind, ST_AsGeoJSON(geom, 5) AS geom, is_placeholder AS placeholder
    FROM protected_area ORDER BY code`;
  return {
    categories: categories.map((c) => ({ ...c })),
    land: JSON.parse(land.geom).coordinates,
    areas: areas.map((a) => ({
      code: a.code,
      name: a.name,
      kind: a.kind,
      geometry: JSON.parse(a.geom).coordinates,
    })),
    bounds: [
      [land.xmin, land.ymin],
      [land.xmax, land.ymax],
    ],
    sea_buffer_m: ARUBA_SEA_BUFFER_M,
    limits: { max_photos: MAX_PHOTOS, max_photo_bytes: MAX_PHOTO_BYTES },
    provisional_boundaries: areas.some((a) => a.placeholder),
  };
}

let cache: { at: number; meta: Meta } | null = null;

export async function handleMeta(sql: Sql, nowMs: number): Promise<Response> {
  if (!cache || nowMs - cache.at > 5 * 60_000) cache = { at: nowMs, meta: await loadMeta(sql) };
  return Response.json(cache.meta, { headers: { 'cache-control': 'public, max-age=300' } });
}
