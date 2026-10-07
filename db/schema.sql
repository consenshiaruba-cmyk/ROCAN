-- ROCAN — reference database schema (PostgreSQL 16 + PostGIS 3)
-- This file is the source of truth for the data model described in docs/SPEC.md §7.
-- Phase 1 turns it into versioned migrations (Drizzle). Keep the two in sync.
--
-- Conventions
--   * snake_case, singular table names, uuid primary keys (gen_random_uuid()).
--   * All timestamps are timestamptz in UTC; the UI renders America/Aruba (UTC-4, no DST).
--   * Geometry is SRID 4326 (WGS84). Distance/area maths cast to geography.
--   * NO column anywhere stores a reporter IP address, user agent, device id or account.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE report_status AS ENUM (
  'submitted',        -- received by the API, nothing processed yet
  'processing',       -- pipeline jobs running (media, geo, classification)
  'pending_review',   -- waiting for a moderator (default path at launch)
  'approved',         -- cleared for dispatch (by moderator or auto-dispatch switch)
  'dispatched',       -- incident PDF delivered to every primary agency
  'acknowledged',     -- primary agency confirmed receipt
  'in_progress',      -- agency reports it is acting on it
  'resolved',         -- agency closed it with an outcome
  'no_action',        -- agency closed it without action (reason required)
  'rejected',         -- moderator or auto-rule rejected it (reason required)
  'merged',           -- duplicate, folded into another report (duplicate_of set)
  'archived'          -- past retention; media purged, statistics kept
);

CREATE TYPE dispatch_role   AS ENUM ('primary', 'cc');
CREATE TYPE dispatch_status AS ENUM ('queued', 'sent', 'failed', 'acknowledged', 'in_progress', 'resolved', 'no_action', 'declined');
CREATE TYPE staff_role      AS ENUM ('admin', 'moderator', 'agency_user', 'om_user', 'auditor');
CREATE TYPE location_source AS ENUM ('gps', 'map_pin', 'exif');
CREATE TYPE area_kind       AS ENUM ('national_park', 'marine_park', 'ramsar', 'bird_sanctuary', 'protected_landscape', 'other');
CREATE TYPE monthly_status  AS ENUM ('draft', 'pending_approval', 'approved', 'delivered', 'superseded');
CREATE TYPE actor_type      AS ENUM ('system', 'staff', 'agency_link', 'reporter');

-- ---------------------------------------------------------------------------
-- Reference data (seeded from config/*.yaml)
-- ---------------------------------------------------------------------------

CREATE TABLE agency (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text UNIQUE NOT NULL,          -- 'DNM' | 'ACF' | 'DOW' | 'OM'
  short_name      text NOT NULL,
  official_name   text NOT NULL,                 -- config value, e.g. 'Directie Natuur en Milieu'
  intake_emails   citext[] NOT NULL,             -- where incident PDFs / digests go
  ack_sla_days    int NOT NULL DEFAULT 7,
  receives_incidents boolean NOT NULL DEFAULT true,  -- false for OM (monthly only)
  digest_enabled  boolean NOT NULL DEFAULT true,
  active          boolean NOT NULL DEFAULT true
);

CREATE TABLE category (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text UNIQUE NOT NULL,          -- e.g. 'ILLEGAL_DUMPING'
  sort_order      int NOT NULL,
  name            jsonb NOT NULL,                -- {"pap": "...", "nl": "...", "en": "...", "es": "..."}
  description     jsonb NOT NULL,                -- same shape; shown to citizens
  severity_weight numeric(3,2) NOT NULL,         -- 0.00–1.00, feeds OM shortlist score
  is_marine       boolean NOT NULL DEFAULT false,
  legal_refs      jsonb NOT NULL DEFAULT '[]',   -- [{law, article, note, verified:false}]
  active          boolean NOT NULL DEFAULT true
);

CREATE TABLE district (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code  text UNIQUE NOT NULL,                    -- 'NOORD', 'ORANJESTAD_WEST', ...
  name  text NOT NULL,
  geom  geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX district_geom_gix ON district USING gist (geom);

CREATE TABLE protected_area (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text UNIQUE NOT NULL,       -- 'ARIKOK_NP', 'PMA_MANGEL_HALTO', ...
  name               text NOT NULL,
  kind               area_kind NOT NULL,
  managed_by_agency  uuid REFERENCES agency(id),
  is_marine          boolean NOT NULL DEFAULT false,
  geom               geometry(MultiPolygon, 4326) NOT NULL,
  source             text NOT NULL,              -- provenance of the polygon
  is_placeholder     boolean NOT NULL DEFAULT true,  -- true until official GIS (§16)
  valid_from         date,
  valid_to           date
);
CREATE INDEX protected_area_geom_gix ON protected_area USING gist (geom);

-- Coastline used for "is_marine" / distance-to-coast enrichment.
CREATE TABLE coastline (
  id    int PRIMARY KEY,
  geom  geometry(MultiPolygon, 4326) NOT NULL    -- Aruba land polygon
);

CREATE TABLE routing_rule (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  priority         int NOT NULL,                 -- lower runs first; all matching rules apply
  category_id      uuid REFERENCES category(id), -- NULL = any category
  condition        jsonb NOT NULL DEFAULT '{}',  -- see SPEC §10.2 (in_area_kind, is_marine, managed_by, ...)
  agency_id        uuid NOT NULL REFERENCES agency(id),
  role             dispatch_role NOT NULL,
  note             text,
  active           boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

CREATE TABLE report (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code           text UNIQUE NOT NULL,     -- 'RC-7KQ2-M9XD', shown to reporter for tracking
  follow_up_token_hash  bytea NOT NULL,           -- argon2id(secret shown once to reporter)
  idempotency_key       uuid UNIQUE NOT NULL,     -- generated client-side; makes offline resubmits safe
  status                report_status NOT NULL DEFAULT 'submitted',

  -- what the reporter told us
  client_created_at     timestamptz NOT NULL,     -- when composed (may be hours earlier if offline)
  received_at           timestamptz NOT NULL DEFAULT now(),
  submitted_offline     boolean NOT NULL DEFAULT false,
  ui_language           text NOT NULL CHECK (ui_language IN ('pap','nl','en','es')),
  reporter_category_id  uuid REFERENCES category(id),
  description           text CHECK (char_length(description) <= 2000),
  observed_at           timestamptz,              -- reporter-supplied "when did this happen"
  is_ongoing            boolean,
  location              geometry(Point, 4326) NOT NULL,
  location_accuracy_m   numeric(8,1),
  location_source       location_source NOT NULL,

  -- enrichment (§9.3)
  district_id           uuid REFERENCES district(id),
  protected_area_ids    uuid[] NOT NULL DEFAULT '{}',
  is_marine             boolean,
  distance_to_coast_m   numeric(10,1),

  -- classification outcome (§11)
  ai_category_id        uuid REFERENCES category(id),
  ai_confidence         numeric(4,3),
  final_category_id     uuid REFERENCES category(id),  -- set by moderator or auto-approve
  severity              smallint CHECK (severity BETWEEN 1 AND 5),
  flags                 text[] NOT NULL DEFAULT '{}',  -- 'person_identifiable','possible_minor','license_plate','named_individual','low_quality','outside_aruba','not_environmental'
  description_redacted  text,                     -- PII-scrubbed version sent to agencies

  -- dedupe (§9.5)
  duplicate_of          uuid REFERENCES report(id),
  cluster_id            uuid,

  -- moderation
  moderated_by          uuid,                     -- staff_user.id
  moderated_at          timestamptz,
  rejection_reason      text,
  auto_approved         boolean NOT NULL DEFAULT false,

  -- lifecycle
  archived_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rejection_needs_reason CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
  CONSTRAINT merged_needs_target    CHECK (status <> 'merged'   OR duplicate_of IS NOT NULL)
);
CREATE INDEX report_location_gix ON report USING gist (location);
CREATE INDEX report_status_idx   ON report (status);
CREATE INDEX report_received_idx ON report (received_at);
CREATE INDEX report_cluster_idx  ON report (cluster_id);

CREATE TABLE report_status_history (
  id          bigserial PRIMARY KEY,
  report_id   uuid NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  from_status report_status,
  to_status   report_status NOT NULL,
  actor_type  actor_type NOT NULL,
  actor_id    uuid,
  note        text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rsh_report_idx ON report_status_history (report_id, at);

-- Anonymous follow-up messages (reporter <-> moderator), keyed by follow-up token.
CREATE TABLE report_message (
  id          bigserial PRIMARY KEY,
  report_id   uuid NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  direction   text NOT NULL CHECK (direction IN ('to_reporter','from_reporter')),
  body        text NOT NULL CHECK (char_length(body) <= 2000),
  staff_id    uuid,
  at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Media & evidence vault (§9.2, §13.3)
-- ---------------------------------------------------------------------------

CREATE TABLE media (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id          uuid NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  ordinal            smallint NOT NULL,           -- 1..5
  mime               text NOT NULL,
  bytes              int NOT NULL,
  width              int,
  height             int,

  -- evidence (original, untouched)
  original_sha256    bytea NOT NULL,
  vault_key          text NOT NULL,               -- s3://rocan-vault/... (Object Lock, SSE-KMS)
  vault_version_id   text,
  received_at        timestamptz NOT NULL DEFAULT now(),

  -- working copy given to staff/agencies (EXIF stripped, faces/plates optionally blurred)
  derivative_key     text,
  derivative_sha256  bytea,
  thumb_key          text,
  redactions         jsonb NOT NULL DEFAULT '[]', -- [{type:'face'|'plate'|'manual', box:[x,y,w,h], by}]

  -- non-identifying metadata kept as evidence
  exif_captured_at   timestamptz,
  exif_location      geometry(Point, 4326),
  phash              bigint,                      -- perceptual hash for dedupe
  quality            jsonb,                       -- {blur:0..1, dark:bool}

  UNIQUE (report_id, ordinal)
);
CREATE INDEX media_sha_idx   ON media (original_sha256);
CREATE INDEX media_phash_idx ON media (phash);

-- Every read of an original from the vault is logged (chain of custody).
CREATE TABLE vault_access_log (
  id         bigserial PRIMARY KEY,
  media_id   uuid NOT NULL REFERENCES media(id),
  staff_id   uuid NOT NULL,
  purpose    text NOT NULL,                      -- free text, mandatory
  at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- AI classification (§11)
-- ---------------------------------------------------------------------------

CREATE TABLE classification (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  provider        text NOT NULL,                  -- 'anthropic' | 'mock'
  model           text NOT NULL,
  prompt_version  text NOT NULL,
  input_sha256    bytea NOT NULL,                 -- hash of (prompt_version, derivatives, text)
  output          jsonb NOT NULL,                 -- full validated structured output
  category_code   text,
  confidence      numeric(4,3),
  flags           text[] NOT NULL DEFAULT '{}',
  stop_reason     text,
  input_tokens    int,
  output_tokens   int,
  latency_ms      int,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX classification_report_idx ON classification (report_id, created_at DESC);

-- Moderator decisions are stored next to the AI's so accuracy can be measured (§11.6).
CREATE VIEW classification_accuracy AS
SELECT c.report_id, c.model, c.prompt_version, c.category_code AS ai_code,
       fc.code AS final_code, (c.category_code = fc.code) AS agreed, c.confidence, r.moderated_at
FROM classification c
JOIN report r   ON r.id = c.report_id
JOIN category fc ON fc.id = r.final_category_id
WHERE r.moderated_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Dispatch to agencies (§12.1–12.3)
-- ---------------------------------------------------------------------------

CREATE TABLE dispatch (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id          uuid NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  agency_id          uuid NOT NULL REFERENCES agency(id),
  role               dispatch_role NOT NULL,
  status             dispatch_status NOT NULL DEFAULT 'queued',
  routing_rule_ids   uuid[] NOT NULL DEFAULT '{}', -- why this agency got it
  pdf_key            text,
  pdf_sha256         bytea,
  email_message_id   text,
  sent_at            timestamptz,
  ack_token_hash     bytea,                        -- signed one-click ack link (no login needed)
  acknowledged_at    timestamptz,
  acknowledged_by    text,                         -- name typed on the ack page or staff user
  due_at             timestamptz,                  -- sent_at + agency.ack_sla_days
  overdue_since      timestamptz,                  -- set by the overdue job; never cleared, only ack'd
  reminder_count     smallint NOT NULL DEFAULT 0,
  last_reminder_at   timestamptz,
  agency_reference   text,                         -- agency's own case number
  outcome_note       text,
  closed_at          timestamptz,
  UNIQUE (report_id, agency_id)
);
CREATE INDEX dispatch_due_idx ON dispatch (status, due_at);

CREATE TABLE dispatch_event (
  id           bigserial PRIMARY KEY,
  dispatch_id  uuid NOT NULL REFERENCES dispatch(id) ON DELETE CASCADE,
  type         text NOT NULL,                      -- 'sent','bounced','reminder','ack','status','note'
  actor_type   actor_type NOT NULL,
  actor_id     uuid,
  payload      jsonb NOT NULL DEFAULT '{}',
  at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE digest (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id        uuid NOT NULL REFERENCES agency(id),
  digest_date      date NOT NULL,                  -- Aruba local date
  new_count        int NOT NULL,
  open_count       int NOT NULL,
  overdue_count    int NOT NULL,
  email_message_id text,
  sent_at          timestamptz,
  UNIQUE (agency_id, digest_date)
);

-- ---------------------------------------------------------------------------
-- Monthly OM report (§12.4)
-- ---------------------------------------------------------------------------

CREATE TABLE monthly_report (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period          date NOT NULL,                   -- first day of month (Aruba time)
  version         int NOT NULL DEFAULT 1,
  status          monthly_status NOT NULL DEFAULT 'draft',
  data            jsonb NOT NULL,                  -- frozen snapshot used to render the PDF
  pdf_key         text,
  pdf_sha256      bytea,
  annex_zip_key   text,                            -- case files for shortlisted cases
  generated_at    timestamptz NOT NULL DEFAULT now(),
  approved_by     uuid,
  approved_at     timestamptz,
  delivered_at    timestamptz,
  om_ack_at       timestamptz,
  UNIQUE (period, version)
);

CREATE TABLE monthly_report_case (
  monthly_report_id uuid NOT NULL REFERENCES monthly_report(id) ON DELETE CASCADE,
  report_id         uuid NOT NULL REFERENCES report(id),
  score             numeric(5,2) NOT NULL,
  score_breakdown   jsonb NOT NULL,                -- each factor and its contribution
  auto_shortlisted  boolean NOT NULL,
  included          boolean NOT NULL,              -- after human review
  reviewer_note     text,
  PRIMARY KEY (monthly_report_id, report_id)
);

-- ---------------------------------------------------------------------------
-- Staff, settings, audit
-- ---------------------------------------------------------------------------

CREATE TABLE staff_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext UNIQUE NOT NULL,
  name           text NOT NULL,
  role           staff_role NOT NULL,
  agency_id      uuid REFERENCES agency(id),       -- required for agency_user / om_user
  totp_secret_enc bytea,                           -- required for admin & moderator
  active         boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_scoped CHECK (role NOT IN ('agency_user','om_user') OR agency_id IS NOT NULL)
);

-- Runtime switches and tunables. Keys are listed in SPEC §3.2 / Appendix A.
CREATE TABLE setting (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbound_email (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_addresses  citext[] NOT NULL,
  template      text NOT NULL,
  subject       text NOT NULL,
  related_type  text,                              -- 'dispatch' | 'digest' | 'monthly_report'
  related_id    uuid,
  provider_id   text,
  status        text NOT NULL DEFAULT 'queued',    -- queued|sent|bounced|failed
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);

-- Append-only, hash-chained audit trail. A trigger rejects UPDATE/DELETE.
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor_type actor_type NOT NULL,
  actor_id   uuid,
  action     text NOT NULL,                        -- 'report.approve', 'vault.read', 'setting.update', ...
  entity     text NOT NULL,
  entity_id  text,
  details    jsonb NOT NULL DEFAULT '{}',
  prev_hash  bytea,
  hash       bytea NOT NULL                        -- sha256(prev_hash || canonical_json(row))
);

CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- Default settings (launch posture = human in the loop).
INSERT INTO setting (key, value) VALUES
  ('automation.auto_dispatch_enabled',        'false'),
  ('automation.auto_dispatch_min_confidence', '0.90'),
  ('automation.auto_dispatch_categories',     '[]'),
  ('automation.auto_om_delivery_enabled',     'false'),
  ('sla.default_ack_days',                    '7'),
  ('reminders.schedule_days',                 '[3, 6, 7, 10, 14]'),
  ('dedupe.radius_m',                         '75'),
  ('dedupe.window_hours',                     '72'),
  ('om.shortlist_threshold',                  '60'),
  ('om.shortlist_max_cases',                  '15'),
  ('retention.rejected_days',                 '90'),
  ('retention.closed_media_years',            '5');
