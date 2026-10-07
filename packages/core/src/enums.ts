// Mirrors the enums in db/schema.sql. Keep in sync (checked by the schema equivalence test).

export const REPORT_STATUSES = [
  'submitted',
  'processing',
  'pending_review',
  'approved',
  'dispatched',
  'acknowledged',
  'in_progress',
  'resolved',
  'no_action',
  'rejected',
  'merged',
  'archived',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const DISPATCH_ROLES = ['primary', 'cc'] as const;
export type DispatchRole = (typeof DISPATCH_ROLES)[number];

export const DISPATCH_STATUSES = [
  'queued',
  'sent',
  'failed',
  'acknowledged',
  'in_progress',
  'resolved',
  'no_action',
  'declined',
] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const STAFF_ROLES = ['admin', 'moderator', 'agency_user', 'om_user', 'auditor'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const LOCATION_SOURCES = ['gps', 'map_pin', 'exif'] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

export const AREA_KINDS = [
  'national_park',
  'marine_park',
  'ramsar',
  'bird_sanctuary',
  'protected_landscape',
  'other',
] as const;
export type AreaKind = (typeof AREA_KINDS)[number];

export const MONTHLY_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'delivered',
  'superseded',
] as const;
export type MonthlyStatus = (typeof MONTHLY_STATUSES)[number];

export const ACTOR_TYPES = ['system', 'staff', 'agency_link', 'reporter'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const UI_LANGUAGES = ['pap', 'nl', 'en', 'es'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const CATEGORY_CODES = [
  'ILLEGAL_DUMPING',
  'POLLUTION_SPILL',
  'ILLEGAL_BURNING',
  'CONSTRUCTION_CLEARING',
  'SAND_STONE_EXTRACTION',
  'OFF_ROAD_DAMAGE',
  'MANGROVE_WETLAND',
  'CORAL_REEF_DAMAGE',
  'ILLEGAL_FISHING',
  'SEA_TURTLE',
  'WILDLIFE_POACHING',
  'INVASIVE_SPECIES',
  'OTHER',
] as const;
export type CategoryCode = (typeof CATEGORY_CODES)[number];

export const AGENCY_CODES = ['DNM', 'ACF', 'DOW', 'OM'] as const;
export type AgencyCode = (typeof AGENCY_CODES)[number];

/** Report flags (SPEC §3.2, §9, §11.3). */
export const REPORT_FLAGS = [
  'person_identifiable',
  'possible_minor',
  'license_plate',
  'named_individual',
  'low_quality',
  'outside_aruba',
  'not_environmental',
  'location_mismatch',
  'possible_duplicate',
  'routing_fallback',
  'classifier_failed',
  'classifier_skipped',
] as const;
export type ReportFlag = (typeof REPORT_FLAGS)[number];

/** Flags whose media must have redactions confirmed by a moderator before approval (SPEC §11.4). */
export const REDACTION_FLAGS: readonly ReportFlag[] = [
  'person_identifiable',
  'possible_minor',
  'license_plate',
];
