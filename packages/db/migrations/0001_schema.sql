CREATE TYPE "public"."actor_type" AS ENUM('system', 'staff', 'agency_link', 'reporter');--> statement-breakpoint
CREATE TYPE "public"."area_kind" AS ENUM('national_park', 'marine_park', 'ramsar', 'bird_sanctuary', 'protected_landscape', 'other');--> statement-breakpoint
CREATE TYPE "public"."dispatch_role" AS ENUM('primary', 'cc');--> statement-breakpoint
CREATE TYPE "public"."dispatch_status" AS ENUM('queued', 'sent', 'failed', 'acknowledged', 'in_progress', 'resolved', 'no_action', 'declined');--> statement-breakpoint
CREATE TYPE "public"."location_source" AS ENUM('gps', 'map_pin', 'exif');--> statement-breakpoint
CREATE TYPE "public"."monthly_status" AS ENUM('draft', 'pending_approval', 'approved', 'delivered', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('submitted', 'processing', 'pending_review', 'approved', 'dispatched', 'acknowledged', 'in_progress', 'resolved', 'no_action', 'rejected', 'merged', 'archived');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'moderator', 'agency_user', 'om_user', 'auditor');--> statement-breakpoint
CREATE TABLE "agency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"short_name" text NOT NULL,
	"official_name" text NOT NULL,
	"intake_emails" "citext"[] NOT NULL,
	"ack_sla_days" integer DEFAULT 7 NOT NULL,
	"receives_incidents" boolean DEFAULT true NOT NULL,
	"digest_enabled" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "agency_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"details" jsonb DEFAULT '{}' NOT NULL,
	"prev_hash" "bytea",
	"hash" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"sort_order" integer NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb NOT NULL,
	"severity_weight" numeric(3, 2) NOT NULL,
	"is_marine" boolean DEFAULT false NOT NULL,
	"legal_refs" jsonb DEFAULT '[]' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "category_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "classification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_sha256" "bytea" NOT NULL,
	"output" jsonb NOT NULL,
	"category_code" text,
	"confidence" numeric(4, 3),
	"flags" text[] DEFAULT '{}' NOT NULL,
	"stop_reason" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coastline" (
	"id" integer PRIMARY KEY NOT NULL,
	"geom" geometry(MultiPolygon, 4326) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"digest_date" date NOT NULL,
	"new_count" integer NOT NULL,
	"open_count" integer NOT NULL,
	"overdue_count" integer NOT NULL,
	"email_message_id" text,
	"sent_at" timestamp with time zone,
	CONSTRAINT "digest_agency_id_digest_date_key" UNIQUE("agency_id","digest_date")
);
--> statement-breakpoint
CREATE TABLE "dispatch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"role" "dispatch_role" NOT NULL,
	"status" "dispatch_status" DEFAULT 'queued' NOT NULL,
	"routing_rule_ids" uuid[] DEFAULT '{}' NOT NULL,
	"pdf_key" text,
	"pdf_sha256" "bytea",
	"email_message_id" text,
	"sent_at" timestamp with time zone,
	"ack_token_hash" "bytea",
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"due_at" timestamp with time zone,
	"overdue_since" timestamp with time zone,
	"reminder_count" smallint DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp with time zone,
	"agency_reference" text,
	"outcome_note" text,
	"closed_at" timestamp with time zone,
	CONSTRAINT "dispatch_report_id_agency_id_key" UNIQUE("report_id","agency_id")
);
--> statement-breakpoint
CREATE TABLE "dispatch_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "district" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"geom" geometry(MultiPolygon, 4326) NOT NULL,
	CONSTRAINT "district_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"original_sha256" "bytea" NOT NULL,
	"vault_key" text NOT NULL,
	"vault_version_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"derivative_key" text,
	"derivative_sha256" "bytea",
	"thumb_key" text,
	"redactions" jsonb DEFAULT '[]' NOT NULL,
	"exif_captured_at" timestamp with time zone,
	"exif_location" geometry(Point, 4326),
	"phash" bigint,
	"quality" jsonb,
	CONSTRAINT "media_report_id_ordinal_key" UNIQUE("report_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "monthly_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" date NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "monthly_status" DEFAULT 'draft' NOT NULL,
	"data" jsonb NOT NULL,
	"pdf_key" text,
	"pdf_sha256" "bytea",
	"annex_zip_key" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"om_ack_at" timestamp with time zone,
	CONSTRAINT "monthly_report_period_version_key" UNIQUE("period","version")
);
--> statement-breakpoint
CREATE TABLE "monthly_report_case" (
	"monthly_report_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"score_breakdown" jsonb NOT NULL,
	"auto_shortlisted" boolean NOT NULL,
	"included" boolean NOT NULL,
	"reviewer_note" text,
	CONSTRAINT "monthly_report_case_pkey" PRIMARY KEY("monthly_report_id","report_id")
);
--> statement-breakpoint
CREATE TABLE "outbound_email" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_addresses" "citext"[] NOT NULL,
	"template" text NOT NULL,
	"subject" text NOT NULL,
	"related_type" text,
	"related_id" uuid,
	"provider_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "protected_area" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "area_kind" NOT NULL,
	"managed_by_agency" uuid,
	"is_marine" boolean DEFAULT false NOT NULL,
	"geom" geometry(MultiPolygon, 4326) NOT NULL,
	"source" text NOT NULL,
	"is_placeholder" boolean DEFAULT true NOT NULL,
	"valid_from" date,
	"valid_to" date,
	CONSTRAINT "protected_area_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_code" text NOT NULL,
	"follow_up_token_hash" "bytea" NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"status" "report_status" DEFAULT 'submitted' NOT NULL,
	"client_created_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_offline" boolean DEFAULT false NOT NULL,
	"ui_language" text NOT NULL,
	"reporter_category_id" uuid,
	"description" text,
	"observed_at" timestamp with time zone,
	"is_ongoing" boolean,
	"location" geometry(Point, 4326) NOT NULL,
	"location_accuracy_m" numeric(8, 1),
	"location_source" "location_source" NOT NULL,
	"district_id" uuid,
	"protected_area_ids" uuid[] DEFAULT '{}' NOT NULL,
	"is_marine" boolean,
	"distance_to_coast_m" numeric(10, 1),
	"ai_category_id" uuid,
	"ai_confidence" numeric(4, 3),
	"final_category_id" uuid,
	"severity" smallint,
	"flags" text[] DEFAULT '{}' NOT NULL,
	"description_redacted" text,
	"duplicate_of" uuid,
	"cluster_id" uuid,
	"moderated_by" uuid,
	"moderated_at" timestamp with time zone,
	"rejection_reason" text,
	"auto_approved" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_public_code_unique" UNIQUE("public_code"),
	CONSTRAINT "report_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "report_ui_language_check" CHECK ("report"."ui_language" IN ('pap','nl','en','es')),
	CONSTRAINT "report_description_check" CHECK (char_length("report"."description") <= 2000),
	CONSTRAINT "report_severity_check" CHECK ("report"."severity" BETWEEN 1 AND 5),
	CONSTRAINT "rejection_needs_reason" CHECK ("report"."status" <> 'rejected' OR "report"."rejection_reason" IS NOT NULL),
	CONSTRAINT "merged_needs_target" CHECK ("report"."status" <> 'merged' OR "report"."duplicate_of" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "report_message" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"staff_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_message_direction_check" CHECK ("report_message"."direction" IN ('to_reporter','from_reporter')),
	CONSTRAINT "report_message_body_check" CHECK (char_length("report_message"."body") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "report_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"from_status" "report_status",
	"to_status" "report_status" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"priority" integer NOT NULL,
	"category_id" uuid,
	"condition" jsonb DEFAULT '{}' NOT NULL,
	"agency_id" uuid NOT NULL,
	"role" "dispatch_role" NOT NULL,
	"note" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"agency_id" uuid,
	"totp_secret_enc" "bytea",
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_user_email_unique" UNIQUE("email"),
	CONSTRAINT "agency_scoped" CHECK ("staff_user"."role" NOT IN ('agency_user','om_user') OR "staff_user"."agency_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "vault_access_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"media_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classification" ADD CONSTRAINT "classification_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest" ADD CONSTRAINT "digest_agency_id_agency_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_agency_id_agency_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_event" ADD CONSTRAINT "dispatch_event_dispatch_id_dispatch_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_case" ADD CONSTRAINT "monthly_report_case_monthly_report_id_monthly_report_id_fk" FOREIGN KEY ("monthly_report_id") REFERENCES "public"."monthly_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_report_case" ADD CONSTRAINT "monthly_report_case_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protected_area" ADD CONSTRAINT "protected_area_managed_by_agency_agency_id_fk" FOREIGN KEY ("managed_by_agency") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_category_id_category_id_fk" FOREIGN KEY ("reporter_category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_district_id_district_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."district"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_ai_category_id_category_id_fk" FOREIGN KEY ("ai_category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_final_category_id_category_id_fk" FOREIGN KEY ("final_category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_duplicate_of_report_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_message" ADD CONSTRAINT "report_message_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_status_history" ADD CONSTRAINT "report_status_history_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rule" ADD CONSTRAINT "routing_rule_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rule" ADD CONSTRAINT "routing_rule_agency_id_agency_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_user" ADD CONSTRAINT "staff_user_agency_id_agency_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_access_log" ADD CONSTRAINT "vault_access_log_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classification_report_idx" ON "classification" USING btree ("report_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "dispatch_due_idx" ON "dispatch" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "district_geom_gix" ON "district" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "media_sha_idx" ON "media" USING btree ("original_sha256");--> statement-breakpoint
CREATE INDEX "media_phash_idx" ON "media" USING btree ("phash");--> statement-breakpoint
CREATE INDEX "protected_area_geom_gix" ON "protected_area" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "report_location_gix" ON "report" USING gist ("location");--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "report" USING btree ("status");--> statement-breakpoint
CREATE INDEX "report_received_idx" ON "report" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "report_cluster_idx" ON "report" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "rsh_report_idx" ON "report_status_history" USING btree ("report_id","at");