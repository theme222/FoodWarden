CREATE TABLE alert_jobs (
  id INTEGER PRIMARY KEY,
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('door', 'sensor')),
  payload TEXT NOT NULL,
  created_s INTEGER NOT NULL DEFAULT (unixepoch()),
  next_s INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX alert_jobs_due ON alert_jobs(next_s, id);
CREATE INDEX alert_jobs_fridge_due ON alert_jobs(fridge_id, next_s, id);

CREATE TRIGGER queue_door_alert AFTER INSERT ON door_events
WHEN NEW.status IN ('OBSTRUCTION_ERROR','TIMEOUT_ERROR','FAULT_LOCKOUT','CONTRADICTION_ERROR')
BEGIN
  INSERT INTO alert_jobs(fridge_id, kind, payload)
  VALUES (NEW.fridge_id, 'door', json_object('node_id', NEW.node_id, 'timestamp_s', NEW.timestamp_s, 'status', NEW.status));
END;

CREATE TRIGGER queue_sensor_alert AFTER INSERT ON telemetry_samples
WHEN NEW.temp_celsius > 8 OR NEW.voc_index >= 250
BEGIN
  INSERT INTO alert_jobs(fridge_id, kind, payload)
  VALUES (NEW.fridge_id, 'sensor', json_object('node_id', NEW.node_id, 'timestamp_s', NEW.timestamp_s,
    'temp_celsius', NEW.temp_celsius, 'voc_index', NEW.voc_index, 'light_ldr', NEW.light_ldr));
END;
