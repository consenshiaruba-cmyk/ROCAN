// SPEC §5.2 step 2 / §9.3: client-side geofence. The server is authoritative (PostGIS);
// this mirrors it closely enough to block obviously wrong pins before upload.
// Pure: runs in the browser and in Node.

export interface LatLon {
  lat: number;
  lon: number;
}

/** GeoJSON MultiPolygon coordinates: polygons → rings → [lon, lat]. */
export type MultiPolygonCoords = number[][][][];

/** SPEC §5.2: land polygon + 3 km sea buffer. */
export const ARUBA_SEA_BUFFER_M = 3000;

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pointInRing(p: LatLon, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInMultiPolygon(p: LatLon, mp: MultiPolygonCoords): boolean {
  return mp.some((poly) => {
    const [outer, ...holes] = poly;
    return !!outer && pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h));
  });
}

/** Distance from a point to a segment, using a local equirectangular projection (fine at island scale). */
function distanceToSegmentM(p: LatLon, a: number[], b: number[]): number {
  const kx = Math.cos(toRad(p.lat)) * (Math.PI / 180) * EARTH_RADIUS_M;
  const ky = (Math.PI / 180) * EARTH_RADIUS_M;
  const ax = ((a[0] as number) - p.lon) * kx;
  const ay = ((a[1] as number) - p.lat) * ky;
  const bx = ((b[0] as number) - p.lon) * kx;
  const by = ((b[1] as number) - p.lat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function distanceToMultiPolygonM(p: LatLon, mp: MultiPolygonCoords): number {
  if (pointInMultiPolygon(p, mp)) return 0;
  let min = Infinity;
  for (const poly of mp)
    for (const ring of poly)
      for (let i = 1; i < ring.length; i++) {
        min = Math.min(min, distanceToSegmentM(p, ring[i - 1]!, ring[i]!));
      }
  return min;
}

export function isValidLatLon(p: LatLon): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180
  );
}

export function isWithinAruba(
  p: LatLon,
  land: MultiPolygonCoords,
  bufferM: number = ARUBA_SEA_BUFFER_M,
): boolean {
  return isValidLatLon(p) && distanceToMultiPolygonM(p, land) <= bufferM;
}
