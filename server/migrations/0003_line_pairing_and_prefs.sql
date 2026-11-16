-- Google account IDs own personal state; fridge membership remains email-based.
CREATE TABLE user_line_profiles (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  line_user_id TEXT UNIQUE,
  morning_enabled INTEGER NOT NULL DEFAULT 1 CHECK(morning_enabled IN (0,1)),
  morning_time TEXT NOT NULL DEFAULT '07:30',
  inst_obstruct INTEGER NOT NULL DEFAULT 1 CHECK(inst_obstruct IN (0,1)),
  inst_warm INTEGER NOT NULL DEFAULT 1 CHECK(inst_warm IN (0,1)),
  inst_spoil INTEGER NOT NULL DEFAULT 1 CHECK(inst_spoil IN (0,1)),
  updated_at_s INTEGER NOT NULL
);
CREATE TABLE line_pairing_codes (
  code_hash TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('user','fridge')),
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  fridge_id TEXT REFERENCES fridges(id) ON DELETE CASCADE,
  created_at_s INTEGER NOT NULL,
  expires_at_s INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  consumed_nonce TEXT,
  target_id TEXT,
  CHECK((scope='user' AND fridge_id IS NULL) OR (scope='fridge' AND fridge_id IS NOT NULL))
);
CREATE INDEX line_pairing_codes_issuer ON line_pairing_codes(user_id, created_at_s);
CREATE TABLE line_webhook_attempts (event_id TEXT PRIMARY KEY, source_hash TEXT NOT NULL, created_at_s INTEGER NOT NULL, processed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX line_webhook_attempts_source ON line_webhook_attempts(source_hash, created_at_s);
CREATE TABLE user_fridge_favorites (
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  name_th TEXT NOT NULL, name_en TEXT NOT NULL, category TEXT NOT NULL,
  PRIMARY KEY(fridge_id,user_id,item_key)
);
CREATE TABLE user_fridge_fav_categories (
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  PRIMARY KEY(fridge_id,user_id,category)
);
CREATE TABLE user_alert_cooldowns (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL, last_sent_s INTEGER NOT NULL,
  PRIMARY KEY(user_id,fridge_id,alert_type)
);
CREATE TABLE user_line_events (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL, event_key TEXT NOT NULL,
  PRIMARY KEY(user_id,fridge_id,alert_type,event_key)
);
CREATE TABLE user_line_outbox (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL, event_key TEXT NOT NULL,
  fridge_ids_json TEXT NOT NULL, target_id TEXT NOT NULL, messages_json TEXT NOT NULL,
  created_s INTEGER NOT NULL, next_attempt_s INTEGER NOT NULL,
  lease_until_s INTEGER NOT NULL DEFAULT 0, lease_token TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, delivered_s INTEGER,
  UNIQUE(user_id,alert_type,event_key)
);
CREATE INDEX user_line_outbox_due ON user_line_outbox(delivered_s, failed, next_attempt_s, lease_until_s);
ALTER TABLE fridges ADD COLUMN line_linked_at_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_line_profiles ADD COLUMN line_linked_at_ms INTEGER NOT NULL DEFAULT 0;
CREATE TABLE line_target_resets (target_id TEXT PRIMARY KEY, timestamp_ms INTEGER NOT NULL);
