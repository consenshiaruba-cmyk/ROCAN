// Loader for fixtures/aruba-places.yaml (MOCK_TESTING §5.2).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { CATEGORY_CODES } from '@rocan/core';
import { REPO_ROOT } from '@rocan/config';

const PlaceSchema = z
  .object({
    name: z.string(),
    lat: z.number(),
    lon: z.number(),
    marine: z.boolean(),
    area_hint: z.string().nullable(),
    likely: z.array(z.enum(CATEGORY_CODES)).min(1),
  })
  .strict();
export type Place = z.infer<typeof PlaceSchema>;

const PlacesFileSchema = z
  .object({
    bounds: z.object({
      min_lat: z.number(),
      max_lat: z.number(),
      min_lon: z.number(),
      max_lon: z.number(),
    }),
    places: z.array(PlaceSchema),
    outside_points: z.array(z.object({ name: z.string(), lat: z.number(), lon: z.number() })),
  })
  .strict();
export type PlacesFile = z.infer<typeof PlacesFileSchema>;

export function loadPlaces(root: string = REPO_ROOT): PlacesFile {
  return PlacesFileSchema.parse(
    parse(readFileSync(join(root, 'fixtures/aruba-places.yaml'), 'utf8')),
  );
}
