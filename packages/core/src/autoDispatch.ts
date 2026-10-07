// SPEC §3.2: may a report skip moderator review? Every condition must hold.

import type { CategoryCode, ReportFlag } from './enums';

export interface AutoDispatchSettings {
  enabled: boolean;
  minConfidence: number;
  /** Empty = every category except OTHER. */
  allowedCategories: readonly CategoryCode[];
}

export interface AutoDispatchInput {
  aiCategoryCode: CategoryCode | null;
  aiConfidence: number | null;
  flags: readonly ReportFlag[];
  /** True when the PII scrubber changed the description (SPEC §9.4). */
  descriptionScrubbed: boolean;
}

/** Any of these keeps a report in human review. */
export const BLOCKING_FLAGS: readonly ReportFlag[] = [
  'person_identifiable',
  'possible_minor',
  'license_plate',
  'named_individual',
  'not_environmental',
  'low_quality',
  'routing_fallback',
  'possible_duplicate',
  'location_mismatch',
  'classifier_failed',
  'classifier_skipped',
  'outside_aruba',
];

export type AutoDispatchDecision = { auto: true } | { auto: false; reasons: string[] };

export function autoDispatchDecision(
  input: AutoDispatchInput,
  settings: AutoDispatchSettings,
): AutoDispatchDecision {
  const reasons: string[] = [];
  if (!settings.enabled) reasons.push('auto-dispatch disabled');
  if (input.aiCategoryCode === null || input.aiConfidence === null) {
    reasons.push('no classification');
  } else {
    if (input.aiConfidence < settings.minConfidence) reasons.push('confidence below threshold');
    if (input.aiCategoryCode === 'OTHER') reasons.push('category OTHER always needs review');
    if (
      settings.allowedCategories.length > 0 &&
      !settings.allowedCategories.includes(input.aiCategoryCode)
    ) {
      reasons.push('category not in auto-dispatch allow-list');
    }
  }
  const blocking = input.flags.filter((f) => BLOCKING_FLAGS.includes(f));
  if (blocking.length > 0) reasons.push(`flags: ${blocking.join(', ')}`);
  if (input.descriptionScrubbed) reasons.push('description needed PII scrubbing');
  return reasons.length === 0 ? { auto: true } : { auto: false, reasons };
}
