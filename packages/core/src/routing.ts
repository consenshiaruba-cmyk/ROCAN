// SPEC §10.2: data-driven routing. Every active rule that matches contributes an
// (agency, role); results are merged per agency with primary beating cc.

import { z } from 'zod';
import {
  AGENCY_CODES,
  AREA_KINDS,
  CATEGORY_CODES,
  DISPATCH_ROLES,
  type AgencyCode,
  type AreaKind,
  type CategoryCode,
  type DispatchRole,
  type ReportFlag,
} from './enums';

export const RuleConditionSchema = z
  .object({
    in_area_managed_by: z.enum(AGENCY_CODES).optional(),
    not_in_area_managed_by: z.enum(AGENCY_CODES).optional(),
    in_area_kind: z.array(z.enum(AREA_KINDS)).min(1).optional(),
    is_marine: z.boolean().optional(),
    outside_protected_area: z.boolean().optional(),
  })
  .strict();
export type RuleCondition = z.infer<typeof RuleConditionSchema>;

export const RoutingRuleSchema = z
  .object({
    id: z.string(),
    priority: z.number().int(),
    category: z.union([z.literal('*'), z.enum(CATEGORY_CODES)]),
    when: RuleConditionSchema,
    agency: z.enum(AGENCY_CODES),
    role: z.enum(DISPATCH_ROLES),
    note: z.string().optional(),
    active: z.boolean().default(true),
  })
  .strict();
export type RoutingRule = z.infer<typeof RoutingRuleSchema>;

export interface AreaRef {
  code: string;
  kind: AreaKind;
  managedBy: AgencyCode | null;
}

export interface AgencyRef {
  code: AgencyCode;
  receivesIncidents: boolean;
}

export interface RoutingInput {
  categoryCode: CategoryCode;
  /** Protected areas the report lies in (after the 25 m tolerance buffer, SPEC §9.3). */
  areas: readonly AreaRef[];
  isMarine: boolean;
}

export interface RoutedDispatch {
  agency: AgencyCode;
  role: DispatchRole;
  ruleIds: string[];
  reasons: string[];
}

export interface RoutingResult {
  dispatches: RoutedDispatch[];
  flags: ReportFlag[];
}

export const FALLBACK_AGENCY: AgencyCode = 'DNM';

export function ruleMatches(rule: RoutingRule, input: RoutingInput): boolean {
  if (!rule.active) return false;
  if (rule.category !== '*' && rule.category !== input.categoryCode) return false;
  const w = rule.when;
  const managers = new Set(input.areas.map((a) => a.managedBy).filter((m) => m !== null));
  if (w.in_area_managed_by !== undefined && !managers.has(w.in_area_managed_by)) return false;
  if (w.not_in_area_managed_by !== undefined && managers.has(w.not_in_area_managed_by))
    return false;
  if (w.in_area_kind !== undefined && !input.areas.some((a) => w.in_area_kind!.includes(a.kind)))
    return false;
  if (w.is_marine !== undefined && w.is_marine !== input.isMarine) return false;
  if (
    w.outside_protected_area !== undefined &&
    w.outside_protected_area !== (input.areas.length === 0)
  )
    return false;
  return true;
}

const AGENCY_ORDER: Record<AgencyCode, number> = { DNM: 0, ACF: 1, DOW: 2, OM: 3 };

export function route(
  input: RoutingInput,
  rules: readonly RoutingRule[],
  agencies: readonly AgencyRef[],
): RoutingResult {
  const receives = new Map(agencies.map((a) => [a.code, a.receivesIncidents]));
  const byAgency = new Map<AgencyCode, RoutedDispatch>();

  const ordered = [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  for (const rule of ordered) {
    if (!ruleMatches(rule, input)) continue;
    if (receives.get(rule.agency) !== true) continue; // unknown or OM: never routed incidents
    const existing = byAgency.get(rule.agency);
    const reason = rule.note ?? `rule ${rule.id}`;
    if (!existing) {
      byAgency.set(rule.agency, {
        agency: rule.agency,
        role: rule.role,
        ruleIds: [rule.id],
        reasons: [reason],
      });
    } else {
      if (rule.role === 'primary') existing.role = 'primary';
      existing.ruleIds.push(rule.id);
      existing.reasons.push(reason);
    }
  }

  const flags: ReportFlag[] = [];
  const hasPrimary = [...byAgency.values()].some((d) => d.role === 'primary');
  if (!hasPrimary) {
    flags.push('routing_fallback');
    const existing = byAgency.get(FALLBACK_AGENCY);
    if (existing) {
      existing.role = 'primary';
      existing.reasons.push('fallback: no primary agency matched');
    } else {
      byAgency.set(FALLBACK_AGENCY, {
        agency: FALLBACK_AGENCY,
        role: 'primary',
        ruleIds: [],
        reasons: ['fallback: no primary agency matched'],
      });
    }
  }

  const dispatches = [...byAgency.values()].sort(
    (a, b) =>
      (a.role === b.role ? 0 : a.role === 'primary' ? -1 : 1) ||
      AGENCY_ORDER[a.agency] - AGENCY_ORDER[b.agency],
  );
  return { dispatches, flags };
}
