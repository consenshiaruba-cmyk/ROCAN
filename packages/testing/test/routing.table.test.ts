// SPEC §15 Phase 1: routing table test for every place × its likely categories.
// Area membership comes from each place's `area_hint` here (pure test); the integration
// test `geo.int.test.ts` proves PostGIS puts each point in exactly that area.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { route, type AreaRef } from '@rocan/core';
import { loadRepoConfig } from '@rocan/config';
import { loadPlaces } from '../src/index';

const config = loadRepoConfig();
const places = loadPlaces().places;
const expected = parse(
  readFileSync(join(import.meta.dirname, 'routing.expected.yaml'), 'utf8'),
) as Record<string, string[]>;

const areasByCode = new Map(
  config.protectedAreas.features.map((f): [string, AreaRef] => [
    f.properties.code,
    { code: f.properties.code, kind: f.properties.kind, managedBy: f.properties.managed_by },
  ]),
);
const agencies = config.agencies.map((a) => ({
  code: a.code,
  receivesIncidents: a.receives_incidents,
}));

describe('routing table: fixtures/aruba-places.yaml × likely categories', () => {
  const cases = places.flatMap((p) => p.likely.map((c) => ({ place: p, category: c })));

  it('the expected table covers exactly the fixture cases', () => {
    expect(Object.keys(expected).sort()).toEqual(
      cases.map(({ place, category }) => `${place.name} | ${category}`).sort(),
    );
  });

  for (const { place, category } of cases) {
    const key = `${place.name} | ${category}`;
    it(key, () => {
      const areas: AreaRef[] = [];
      if (place.area_hint) {
        const area = areasByCode.get(place.area_hint);
        expect(area, `unknown area_hint ${place.area_hint}`).toBeDefined();
        areas.push(area!);
      }
      const result = route(
        { categoryCode: category, areas, isMarine: place.marine },
        config.routingRules,
        agencies,
      );
      expect(result.dispatches.map((d) => `${d.agency}:${d.role}`)).toEqual(expected[key]);
      expect(result.flags).toEqual([]);
    });
  }
});
