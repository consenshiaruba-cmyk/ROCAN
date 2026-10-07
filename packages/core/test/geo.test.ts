import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  distanceToMultiPolygonM,
  haversineM,
  isWithinAruba,
  pointInMultiPolygon,
  type MultiPolygonCoords,
} from '../src/index';

const root = join(import.meta.dirname, '..', '..', '..');
const land = JSON.parse(readFileSync(join(root, 'config/areas/coastline.geojson'), 'utf8'))
  .features[0].geometry.coordinates as MultiPolygonCoords;
const places = parse(readFileSync(join(root, 'fixtures/aruba-places.yaml'), 'utf8'));

describe('geo helpers', () => {
  it('haversine: 1° of latitude ≈ 111 km', () => {
    expect(haversineM({ lat: 12, lon: -70 }, { lat: 13, lon: -70 })).toBeCloseTo(111_195, -2);
  });

  it('point in polygon with holes', () => {
    const square: MultiPolygonCoords = [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
          [4, 4],
        ],
      ],
    ];
    expect(pointInMultiPolygon({ lat: 2, lon: 2 }, square)).toBe(true);
    expect(pointInMultiPolygon({ lat: 5, lon: 5 }, square)).toBe(false);
    expect(pointInMultiPolygon({ lat: 11, lon: 5 }, square)).toBe(false);
  });

  it('every land fixture is inside the island, every sea fixture within the 3 km buffer', () => {
    for (const p of places.places) {
      expect(pointInMultiPolygon(p, land), p.name).toBe(!p.marine);
      expect(isWithinAruba(p, land), p.name).toBe(true);
    }
  });

  it('rejects the outside fixtures (Curaçao, open sea, Venezuela)', () => {
    for (const p of places.outside_points) expect(isWithinAruba(p, land), p.name).toBe(false);
  });

  it('measures distance to the coast for points at sea', () => {
    const d = distanceToMultiPolygonM({ lat: 12.5985, lon: -70.0555 }, land); // Malmok reef
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(1000);
  });

  it('rejects non-finite and out-of-range coordinates', () => {
    expect(isWithinAruba({ lat: Number.NaN, lon: -70 }, land)).toBe(false);
    expect(isWithinAruba({ lat: 12.5, lon: 200 }, land)).toBe(false);
  });
});
