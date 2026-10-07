// Loaders for the repository's config/*.yaml and config/areas/*.geojson (SPEC §7, §10).
// Validation is strict so a typo in a YAML file fails the seed and the tests.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import {
  AGENCY_CODES,
  AREA_KINDS,
  CATEGORY_CODES,
  RoutingRuleSchema,
  type RoutingRule,
} from '@rocan/core';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const Localized = z.object({ pap: z.string(), nl: z.string(), en: z.string(), es: z.string() });

export const AgencyConfigSchema = z
  .object({
    code: z.enum(AGENCY_CODES),
    short_name: z.string(),
    official_name: z.string(),
    intake_emails: z.array(z.string().email()).min(1),
    ack_sla_days: z.number().int().positive(),
    receives_incidents: z.boolean(),
    digest_enabled: z.boolean(),
  })
  .strict();
export type AgencyConfig = z.infer<typeof AgencyConfigSchema>;

export const LegalRefSchema = z
  .object({ law: z.string(), article: z.string().nullable(), verified: z.boolean() })
  .strict();

export const CategoryConfigSchema = z
  .object({
    code: z.enum(CATEGORY_CODES),
    sort_order: z.number().int(),
    severity_weight: z.number().min(0).max(1),
    is_marine: z.boolean(),
    name: Localized,
    description: Localized,
    legal_refs: z.array(LegalRefSchema),
  })
  .strict();
export type CategoryConfig = z.infer<typeof CategoryConfigSchema>;

const RuleYamlSchema = RoutingRuleSchema.omit({ id: true, active: true }).extend({
  active: z.boolean().optional(),
});

const CategoriesFileSchema = z
  .object({ categories: z.array(CategoryConfigSchema), routing_rules: z.array(RuleYamlSchema) })
  .strict();

const AgenciesFileSchema = z.object({ agencies: z.array(AgencyConfigSchema) }).strict();

const Position = z.tuple([z.number(), z.number()]);
const MultiPolygon = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(z.array(Position).min(4))),
});

export const AreaPropertiesSchema = z.object({
  code: z.string(),
  name: z.string(),
  kind: z.enum(AREA_KINDS),
  managed_by: z.enum(AGENCY_CODES).nullable(),
  is_marine: z.boolean(),
  source: z.string(),
});

const featureCollection = <P extends z.ZodTypeAny>(props: P) =>
  z.object({
    type: z.literal('FeatureCollection'),
    comment: z.string().optional(),
    features: z.array(
      z.object({ type: z.literal('Feature'), properties: props, geometry: MultiPolygon }),
    ),
  });

export const AreasFileSchema = featureCollection(AreaPropertiesSchema);
export const NamedAreasFileSchema = featureCollection(z.object({ code: z.string(), name: z.string() }));

function read(rel: string, root: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

export interface RepoConfig {
  agencies: AgencyConfig[];
  categories: CategoryConfig[];
  routingRules: RoutingRule[];
  protectedAreas: z.infer<typeof AreasFileSchema>;
  districts: z.infer<typeof NamedAreasFileSchema>;
  coastline: z.infer<typeof NamedAreasFileSchema>;
}

/** Stable, human-readable rule ids for tests and explanations: R<priority>. */
export function ruleId(priority: number): string {
  return `R${priority}`;
}

export function loadRepoConfig(root: string = REPO_ROOT): RepoConfig {
  const agencies = AgenciesFileSchema.parse(parse(read('config/agencies.yaml', root))).agencies;
  const cats = CategoriesFileSchema.parse(parse(read('config/categories.yaml', root)));
  const priorities = new Set<number>();
  const routingRules = cats.routing_rules.map((r) => {
    if (priorities.has(r.priority)) throw new Error(`Duplicate routing rule priority ${r.priority}`);
    priorities.add(r.priority);
    return RoutingRuleSchema.parse({ ...r, id: ruleId(r.priority), active: r.active ?? true });
  });
  const codes = new Set(cats.categories.map((c) => c.code));
  for (const code of CATEGORY_CODES) {
    if (!codes.has(code)) throw new Error(`Category ${code} missing from config/categories.yaml`);
  }
  return {
    agencies,
    categories: cats.categories,
    routingRules,
    protectedAreas: AreasFileSchema.parse(
      JSON.parse(read('config/areas/protected-areas.geojson', root)),
    ),
    districts: NamedAreasFileSchema.parse(JSON.parse(read('config/areas/districts.geojson', root))),
    coastline: NamedAreasFileSchema.parse(JSON.parse(read('config/areas/coastline.geojson', root))),
  };
}
