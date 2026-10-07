-- SPEC §7, §11.6, §13.3: objects Drizzle cannot express. Mirrors db/schema.sql.
CREATE VIEW classification_accuracy AS
SELECT c.report_id, c.model, c.prompt_version, c.category_code AS ai_code,
       fc.code AS final_code, (c.category_code = fc.code) AS agreed, c.confidence, r.moderated_at
FROM classification c
JOIN report r   ON r.id = c.report_id
JOIN category fc ON fc.id = r.final_category_id
WHERE r.moderated_by IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint
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
