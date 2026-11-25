CREATE TABLE fridge_status_history (
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  gateway_seen_s INTEGER NOT NULL,
  received_s INTEGER NOT NULL,
  nodes_json TEXT NOT NULL,
  PRIMARY KEY (fridge_id, gateway_seen_s)
);
CREATE INDEX fridge_status_history_received ON fridge_status_history(fridge_id, received_s, gateway_seen_s);

CREATE TRIGGER record_initial_fridge_status AFTER INSERT ON system_status
BEGIN
  INSERT INTO fridge_status_history VALUES (NEW.fridge_id, NEW.gateway_seen_s, NEW.received_s, NEW.nodes_json);
END;

CREATE TRIGGER record_changed_fridge_status AFTER UPDATE OF gateway_seen_s ON system_status
WHEN NEW.gateway_seen_s > OLD.gateway_seen_s
BEGIN
  INSERT INTO fridge_status_history VALUES (NEW.fridge_id, NEW.gateway_seen_s, NEW.received_s, NEW.nodes_json);
END;
