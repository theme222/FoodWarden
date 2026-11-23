CREATE TABLE inventory_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  timestamp_s INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  source TEXT CHECK (source IN ('CAMERA', 'WEB_MANUAL'))
);

CREATE INDEX idx_inventory_activity_fridge_time
  ON inventory_activity(fridge_id, timestamp_s);

CREATE TRIGGER inventory_activity_created AFTER INSERT ON inventory
BEGIN
  INSERT INTO inventory_activity(fridge_id, timestamp_s, action, name_th, name_en, source)
  VALUES (NEW.fridge_id, unixepoch(), 'created', NEW.name_th, NEW.name_en, NEW.check_in_source);
END;

CREATE TRIGGER inventory_activity_updated AFTER UPDATE ON inventory
WHEN NEW.name_th IS NOT OLD.name_th OR NEW.name_en IS NOT OLD.name_en
  OR NEW.category IS NOT OLD.category OR NEW.category_th IS NOT OLD.category_th
  OR NEW.estimated_expiry_date IS NOT OLD.estimated_expiry_date
  OR NEW.storage_recommendation_th IS NOT OLD.storage_recommendation_th
  OR NEW.storage_recommendation_en IS NOT OLD.storage_recommendation_en
BEGIN
  INSERT INTO inventory_activity(fridge_id, timestamp_s, action, name_th, name_en, source)
  VALUES (NEW.fridge_id, unixepoch(), 'updated', NEW.name_th, NEW.name_en, 'WEB_MANUAL');
END;

CREATE INDEX idx_door_activity_page ON door_events(fridge_id, timestamp_s);
CREATE INDEX idx_sensor_activity_page ON telemetry_samples(fridge_id, timestamp_s);
