-- Receipts survive item checkout. Keep them for the fridge lifetime.
CREATE TABLE inventory_operations (
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('manual','camera')),
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  item_id TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  created_s INTEGER NOT NULL,
  PRIMARY KEY(fridge_id,kind,operation_id)
);
INSERT INTO inventory_operations
SELECT fridge_id,'manual',id,manual_request_hash,id,'legacy',check_in_timestamp_s
FROM inventory WHERE check_in_source='WEB_MANUAL' AND manual_request_hash IS NOT NULL;
CREATE TABLE draft_operations (
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('checkin','checkout')),
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','done','uncertain')),
  response_json TEXT,
  response_status INTEGER,
  created_s INTEGER NOT NULL,
  PRIMARY KEY(fridge_id,kind,operation_id)
);
ALTER TABLE line_webhook_attempts ADD COLUMN receipt_kind TEXT NOT NULL DEFAULT 'pairing';
CREATE INDEX line_webhook_attempts_kind_time ON line_webhook_attempts(receipt_kind,created_at_s);
CREATE INDEX line_webhook_attempts_kind_source ON line_webhook_attempts(receipt_kind,source_hash,created_at_s);
-- Old receipts cannot be reliably classified; they expire from the ten-minute budget naturally.
-- Repair cached readings poisoned before future-clock validation was introduced.
UPDATE fridges SET last_telemetry_json = (
 SELECT json_object('node_id',node_id,'timestamp_s',timestamp_s,'temp_celsius',temp_celsius,'voc_index',voc_index,'light_ldr',light_ldr)
 FROM telemetry_samples WHERE fridge_id=fridges.id AND timestamp_s<=unixepoch()
 ORDER BY timestamp_s DESC LIMIT 1
) WHERE CAST(json_extract(last_telemetry_json,'$.timestamp_s') AS INTEGER)>unixepoch()+300;
