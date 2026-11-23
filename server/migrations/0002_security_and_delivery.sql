ALTER TABLE fridges ADD COLUMN ai_budget_owner TEXT;
UPDATE fridges SET ai_budget_owner = COALESCE((SELECT u.id FROM fridge_members fm JOIN user u ON lower(trim(u.email)) = fm.email WHERE fm.fridge_id = fridges.id AND fm.role = 'owner' ORDER BY fm.added_at_s, fm.email LIMIT 1), (SELECT email FROM fridge_members WHERE fridge_id = fridges.id AND role = 'owner' ORDER BY added_at_s, email LIMIT 1));
CREATE TABLE ai_reservations (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, fridge_id TEXT NOT NULL, started_s INTEGER NOT NULL, active_until_s INTEGER NOT NULL);
CREATE INDEX ai_reservations_time ON ai_reservations(started_s);
CREATE INDEX ai_reservations_fridge ON ai_reservations(fridge_id, started_s);
CREATE INDEX ai_reservations_active ON ai_reservations(active_until_s);
CREATE INDEX ai_reservations_owner ON ai_reservations(owner_email, started_s);
CREATE TABLE line_outbox (id TEXT PRIMARY KEY, fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE, alert_type TEXT NOT NULL, target_id TEXT NOT NULL, messages_json TEXT NOT NULL, created_s INTEGER NOT NULL, next_attempt_s INTEGER NOT NULL, lease_until_s INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, lease_token TEXT NOT NULL DEFAULT '');
CREATE INDEX line_outbox_due ON line_outbox(next_attempt_s, lease_until_s);
CREATE TABLE photo_gc_claims (key TEXT PRIMARY KEY);
CREATE TRIGGER inventory_photo_retired_insert BEFORE INSERT ON inventory
WHEN NEW.image_storage_path IS NOT NULL AND EXISTS (SELECT 1 FROM photo_gc_claims WHERE key = CASE WHEN substr(NEW.image_storage_path, 1, 9) = '/storage/' THEN NEW.image_storage_path ELSE '/storage/' || NEW.image_storage_path END)
BEGIN SELECT RAISE(ABORT, 'PHOTO_RETIRED'); END;
CREATE TRIGGER inventory_photo_retired_update BEFORE UPDATE OF image_storage_path ON inventory
WHEN NEW.image_storage_path IS NOT NULL AND EXISTS (SELECT 1 FROM photo_gc_claims WHERE key = CASE WHEN substr(NEW.image_storage_path, 1, 9) = '/storage/' THEN NEW.image_storage_path ELSE '/storage/' || NEW.image_storage_path END)
BEGIN SELECT RAISE(ABORT, 'PHOTO_RETIRED'); END;
CREATE TABLE line_alert_events (fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE, alert_type TEXT NOT NULL, event_key TEXT NOT NULL, PRIMARY KEY(fridge_id, alert_type, event_key));
-- Historical ingested events must not become new alerts when a gateway retries after upgrade.
INSERT INTO line_alert_events(fridge_id, alert_type, event_key)
SELECT fridge_id, CASE status WHEN 'OBSTRUCTION_ERROR' THEN 'door_obstruction' WHEN 'TIMEOUT_ERROR' THEN 'door_timeout' WHEN 'FAULT_LOCKOUT' THEN 'door_fault_lockout' WHEN 'CONTRADICTION_ERROR' THEN 'door_contradiction' END, json_array(node_id, timestamp_s, status)
FROM door_events WHERE status IN ('OBSTRUCTION_ERROR','TIMEOUT_ERROR','FAULT_LOCKOUT','CONTRADICTION_ERROR');
INSERT INTO line_alert_events(fridge_id, alert_type, event_key)
SELECT fridge_id, 'voc_high', json_array(node_id, timestamp_s) FROM telemetry_samples WHERE voc_index >= 250;
INSERT INTO line_alert_events(fridge_id, alert_type, event_key)
SELECT fridge_id, 'temp_high', json_array(node_id, timestamp_s) FROM telemetry_samples WHERE temp_celsius > 8;

