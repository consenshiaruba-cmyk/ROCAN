// Drizzle schema. Must stay equivalent to db/schema.sql (SPEC §7); the integration test
// `schema-equivalence.int.test.ts` compares the migrated database with the reference file.

import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  ACTOR_TYPES,
  AREA_KINDS,
  DISPATCH_ROLES,
  DISPATCH_STATUSES,
  LOCATION_SOURCES,
  MONTHLY_STATUSES,
  REPORT_STATUSES,
  STAFF_ROLES,
} from '@rocan/core';

// ---------------------------------------------------------------------------
// Custom column types
// ---------------------------------------------------------------------------

export const citext = customType<{ data: string }>({ dataType: () => 'citext' });
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** Geometry columns are read/written as EWKT/WKB through SQL helpers in geo queries. */
export const geomPoint = customType<{ data: string }>({
  dataType: () => 'geometry(Point, 4326)',
});
export const geomMultiPolygon = customType<{ data: string }>({
  dataType: () => 'geometry(MultiPolygon, 4326)',
});

const tz = (name: string) => timestamp(name, { withTimezone: true });
const emptyTextArray = sql`'{}'`;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const reportStatus = pgEnum('report_status', REPORT_STATUSES);
export const dispatchRole = pgEnum('dispatch_role', DISPATCH_ROLES);
export const dispatchStatus = pgEnum('dispatch_status', DISPATCH_STATUSES);
export const staffRole = pgEnum('staff_role', STAFF_ROLES);
export const locationSource = pgEnum('location_source', LOCATION_SOURCES);
export const areaKind = pgEnum('area_kind', AREA_KINDS);
export const monthlyStatus = pgEnum('monthly_status', MONTHLY_STATUSES);
export const actorType = pgEnum('actor_type', ACTOR_TYPES);

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const agency = pgTable('agency', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  shortName: text('short_name').notNull(),
  officialName: text('official_name').notNull(),
  intakeEmails: citext('intake_emails').array().notNull(),
  ackSlaDays: integer('ack_sla_days').notNull().default(7),
  receivesIncidents: boolean('receives_incidents').notNull().default(true),
  digestEnabled: boolean('digest_enabled').notNull().default(true),
  active: boolean('active').notNull().default(true),
});

export const category = pgTable('category', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  sortOrder: integer('sort_order').notNull(),
  name: jsonb('name').notNull(),
  description: jsonb('description').notNull(),
  severityWeight: numeric('severity_weight', { precision: 3, scale: 2 }).notNull(),
  isMarine: boolean('is_marine').notNull().default(false),
  legalRefs: jsonb('legal_refs')
    .notNull()
    .default(sql`'[]'`),
  active: boolean('active').notNull().default(true),
});

export const district = pgTable(
  'district',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    geom: geomMultiPolygon('geom').notNull(),
  },
  (t) => [index('district_geom_gix').using('gist', t.geom)],
);

export const protectedArea = pgTable(
  'protected_area',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    kind: areaKind('kind').notNull(),
    managedByAgency: uuid('managed_by_agency').references(() => agency.id),
    isMarine: boolean('is_marine').notNull().default(false),
    geom: geomMultiPolygon('geom').notNull(),
    source: text('source').notNull(),
    isPlaceholder: boolean('is_placeholder').notNull().default(true),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
  },
  (t) => [index('protected_area_geom_gix').using('gist', t.geom)],
);

export const coastline = pgTable('coastline', {
  id: integer('id').primaryKey(),
  geom: geomMultiPolygon('geom').notNull(),
});

export const routingRule = pgTable('routing_rule', {
  id: uuid('id').primaryKey().defaultRandom(),
  priority: integer('priority').notNull(),
  categoryId: uuid('category_id').references(() => category.id),
  condition: jsonb('condition')
    .notNull()
    .default(sql`'{}'`),
  agencyId: uuid('agency_id')
    .notNull()
    .references(() => agency.id),
  role: dispatchRole('role').notNull(),
  note: text('note'),
  active: boolean('active').notNull().default(true),
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const report = pgTable(
  'report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicCode: text('public_code').notNull().unique(),
    followUpTokenHash: bytea('follow_up_token_hash').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull().unique(),
    status: reportStatus('status').notNull().default('submitted'),

    clientCreatedAt: tz('client_created_at').notNull(),
    receivedAt: tz('received_at').notNull().defaultNow(),
    submittedOffline: boolean('submitted_offline').notNull().default(false),
    uiLanguage: text('ui_language').notNull(),
    reporterCategoryId: uuid('reporter_category_id').references(() => category.id),
    description: text('description'),
    observedAt: tz('observed_at'),
    isOngoing: boolean('is_ongoing'),
    location: geomPoint('location').notNull(),
    locationAccuracyM: numeric('location_accuracy_m', { precision: 8, scale: 1 }),
    locationSource: locationSource('location_source').notNull(),

    districtId: uuid('district_id').references(() => district.id),
    protectedAreaIds: uuid('protected_area_ids').array().notNull().default(emptyTextArray),
    isMarine: boolean('is_marine'),
    distanceToCoastM: numeric('distance_to_coast_m', { precision: 10, scale: 1 }),

    aiCategoryId: uuid('ai_category_id').references(() => category.id),
    aiConfidence: numeric('ai_confidence', { precision: 4, scale: 3 }),
    finalCategoryId: uuid('final_category_id').references(() => category.id),
    severity: smallint('severity'),
    flags: text('flags').array().notNull().default(emptyTextArray),
    descriptionRedacted: text('description_redacted'),

    duplicateOf: uuid('duplicate_of').references((): AnyPgColumn => report.id),
    clusterId: uuid('cluster_id'),

    moderatedBy: uuid('moderated_by'),
    moderatedAt: tz('moderated_at'),
    rejectionReason: text('rejection_reason'),
    autoApproved: boolean('auto_approved').notNull().default(false),

    archivedAt: tz('archived_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('report_ui_language_check', sql`${t.uiLanguage} IN ('pap','nl','en','es')`),
    check('report_description_check', sql`char_length(${t.description}) <= 2000`),
    check('report_severity_check', sql`${t.severity} BETWEEN 1 AND 5`),
    check(
      'rejection_needs_reason',
      sql`${t.status} <> 'rejected' OR ${t.rejectionReason} IS NOT NULL`,
    ),
    check('merged_needs_target', sql`${t.status} <> 'merged' OR ${t.duplicateOf} IS NOT NULL`),
    index('report_location_gix').using('gist', t.location),
    index('report_status_idx').on(t.status),
    index('report_received_idx').on(t.receivedAt),
    index('report_cluster_idx').on(t.clusterId),
  ],
);

export const reportStatusHistory = pgTable(
  'report_status_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => report.id, { onDelete: 'cascade' }),
    fromStatus: reportStatus('from_status'),
    toStatus: reportStatus('to_status').notNull(),
    actorType: actorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    note: text('note'),
    at: tz('at').notNull().defaultNow(),
  },
  (t) => [index('rsh_report_idx').on(t.reportId, t.at)],
);

export const reportMessage = pgTable(
  'report_message',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => report.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(),
    body: text('body').notNull(),
    staffId: uuid('staff_id'),
    at: tz('at').notNull().defaultNow(),
  },
  (t) => [
    check('report_message_direction_check', sql`${t.direction} IN ('to_reporter','from_reporter')`),
    check('report_message_body_check', sql`char_length(${t.body}) <= 2000`),
  ],
);

// ---------------------------------------------------------------------------
// Media & evidence vault
// ---------------------------------------------------------------------------

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => report.id, { onDelete: 'cascade' }),
    ordinal: smallint('ordinal').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),

    originalSha256: bytea('original_sha256').notNull(),
    vaultKey: text('vault_key').notNull(),
    vaultVersionId: text('vault_version_id'),
    receivedAt: tz('received_at').notNull().defaultNow(),

    derivativeKey: text('derivative_key'),
    derivativeSha256: bytea('derivative_sha256'),
    thumbKey: text('thumb_key'),
    redactions: jsonb('redactions')
      .notNull()
      .default(sql`'[]'`),

    exifCapturedAt: tz('exif_captured_at'),
    exifLocation: geomPoint('exif_location'),
    phash: bigint('phash', { mode: 'bigint' }),
    quality: jsonb('quality'),
  },
  (t) => [
    unique('media_report_id_ordinal_key').on(t.reportId, t.ordinal),
    index('media_sha_idx').on(t.originalSha256),
    index('media_phash_idx').on(t.phash),
  ],
);

export const vaultAccessLog = pgTable('vault_access_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  mediaId: uuid('media_id')
    .notNull()
    .references(() => media.id),
  staffId: uuid('staff_id').notNull(),
  purpose: text('purpose').notNull(),
  at: tz('at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// AI classification
// ---------------------------------------------------------------------------

export const classification = pgTable(
  'classification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => report.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    inputSha256: bytea('input_sha256').notNull(),
    output: jsonb('output').notNull(),
    categoryCode: text('category_code'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    flags: text('flags').array().notNull().default(emptyTextArray),
    stopReason: text('stop_reason'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms'),
    error: text('error'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('classification_report_idx').on(t.reportId, t.createdAt.desc().nullsFirst())],
);

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export const dispatch = pgTable(
  'dispatch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => report.id, { onDelete: 'cascade' }),
    agencyId: uuid('agency_id')
      .notNull()
      .references(() => agency.id),
    role: dispatchRole('role').notNull(),
    status: dispatchStatus('status').notNull().default('queued'),
    routingRuleIds: uuid('routing_rule_ids').array().notNull().default(emptyTextArray),
    pdfKey: text('pdf_key'),
    pdfSha256: bytea('pdf_sha256'),
    emailMessageId: text('email_message_id'),
    sentAt: tz('sent_at'),
    ackTokenHash: bytea('ack_token_hash'),
    acknowledgedAt: tz('acknowledged_at'),
    acknowledgedBy: text('acknowledged_by'),
    dueAt: tz('due_at'),
    overdueSince: tz('overdue_since'),
    reminderCount: smallint('reminder_count').notNull().default(0),
    lastReminderAt: tz('last_reminder_at'),
    agencyReference: text('agency_reference'),
    outcomeNote: text('outcome_note'),
    closedAt: tz('closed_at'),
  },
  (t) => [
    unique('dispatch_report_id_agency_id_key').on(t.reportId, t.agencyId),
    index('dispatch_due_idx').on(t.status, t.dueAt),
  ],
);

export const dispatchEvent = pgTable('dispatch_event', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  dispatchId: uuid('dispatch_id')
    .notNull()
    .references(() => dispatch.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  actorType: actorType('actor_type').notNull(),
  actorId: uuid('actor_id'),
  payload: jsonb('payload')
    .notNull()
    .default(sql`'{}'`),
  at: tz('at').notNull().defaultNow(),
});

export const digest = pgTable(
  'digest',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id')
      .notNull()
      .references(() => agency.id),
    digestDate: date('digest_date').notNull(),
    newCount: integer('new_count').notNull(),
    openCount: integer('open_count').notNull(),
    overdueCount: integer('overdue_count').notNull(),
    emailMessageId: text('email_message_id'),
    sentAt: tz('sent_at'),
  },
  (t) => [unique('digest_agency_id_digest_date_key').on(t.agencyId, t.digestDate)],
);

// ---------------------------------------------------------------------------
// Monthly OM report
// ---------------------------------------------------------------------------

export const monthlyReport = pgTable(
  'monthly_report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    period: date('period').notNull(),
    version: integer('version').notNull().default(1),
    status: monthlyStatus('status').notNull().default('draft'),
    data: jsonb('data').notNull(),
    pdfKey: text('pdf_key'),
    pdfSha256: bytea('pdf_sha256'),
    annexZipKey: text('annex_zip_key'),
    generatedAt: tz('generated_at').notNull().defaultNow(),
    approvedBy: uuid('approved_by'),
    approvedAt: tz('approved_at'),
    deliveredAt: tz('delivered_at'),
    omAckAt: tz('om_ack_at'),
  },
  (t) => [unique('monthly_report_period_version_key').on(t.period, t.version)],
);

export const monthlyReportCase = pgTable(
  'monthly_report_case',
  {
    monthlyReportId: uuid('monthly_report_id')
      .notNull()
      .references(() => monthlyReport.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id')
      .notNull()
      .references(() => report.id),
    score: numeric('score', { precision: 5, scale: 2 }).notNull(),
    scoreBreakdown: jsonb('score_breakdown').notNull(),
    autoShortlisted: boolean('auto_shortlisted').notNull(),
    included: boolean('included').notNull(),
    reviewerNote: text('reviewer_note'),
  },
  (t) => [
    primaryKey({ name: 'monthly_report_case_pkey', columns: [t.monthlyReportId, t.reportId] }),
  ],
);

// ---------------------------------------------------------------------------
// Staff, settings, audit
// ---------------------------------------------------------------------------

export const staffUser = pgTable(
  'staff_user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull().unique(),
    name: text('name').notNull(),
    role: staffRole('role').notNull(),
    agencyId: uuid('agency_id').references(() => agency.id),
    totpSecretEnc: bytea('totp_secret_enc'),
    active: boolean('active').notNull().default(true),
    lastLoginAt: tz('last_login_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'agency_scoped',
      sql`${t.role} NOT IN ('agency_user','om_user') OR ${t.agencyId} IS NOT NULL`,
    ),
  ],
);

export const setting = pgTable('setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});

export const outboundEmail = pgTable('outbound_email', {
  id: uuid('id').primaryKey().defaultRandom(),
  toAddresses: citext('to_addresses').array().notNull(),
  template: text('template').notNull(),
  subject: text('subject').notNull(),
  relatedType: text('related_type'),
  relatedId: uuid('related_id'),
  providerId: text('provider_id'),
  status: text('status').notNull().default('queued'),
  error: text('error'),
  createdAt: tz('created_at').notNull().defaultNow(),
  sentAt: tz('sent_at'),
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: tz('at').notNull().defaultNow(),
  actorType: actorType('actor_type').notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  details: jsonb('details')
    .notNull()
    .default(sql`'{}'`),
  prevHash: bytea('prev_hash'),
  hash: bytea('hash').notNull(),
});
