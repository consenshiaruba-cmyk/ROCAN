ALTER TABLE "report" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "photo_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_photo_count_check" CHECK ("report"."photo_count" BETWEEN 0 AND 5);