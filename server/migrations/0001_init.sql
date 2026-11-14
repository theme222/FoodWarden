-- FoodWarden D1 (SQLite) initial schema
-- Covers domain tables + Better Auth core tables

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Better Auth core tables (used in Part 3 with Google OAuth)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY NOT NULL,
  expiresAt INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(userId);
CREATE INDEX IF NOT EXISTS idx_session_expires_at ON session(expiresAt);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_user_id ON account(userId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_provider_account ON account(providerId, accountId);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER,
  updatedAt INTEGER
);

CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);

-- ---------------------------------------------------------------------------
-- FoodWarden domain tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fridges (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at_s INTEGER NOT NULL,
  line_target_id TEXT,
  last_seen_s INTEGER NOT NULL DEFAULT 0,
  last_telemetry_json TEXT
);

CREATE TABLE IF NOT EXISTS fridge_members (
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  added_at_s INTEGER NOT NULL,
  PRIMARY KEY (fridge_id, email)
);

CREATE INDEX IF NOT EXISTS idx_fridge_members_email ON fridge_members(email, fridge_id);

CREATE TABLE IF NOT EXISTS fridge_secrets (
  fridge_id TEXT PRIMARY KEY NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  gateway_token TEXT NOT NULL,
  gateway_token_hash TEXT NOT NULL UNIQUE,
  gemini_api_key TEXT,
  updated_at_s INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY NOT NULL,
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  category TEXT NOT NULL,
  category_th TEXT NOT NULL DEFAULT '',
  estimated_expiry_date TEXT NOT NULL,
  storage_recommendation_th TEXT NOT NULL DEFAULT '',
  storage_recommendation_en TEXT NOT NULL DEFAULT '',
  check_in_timestamp_s INTEGER NOT NULL,
  image_storage_path TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  check_in_source TEXT NOT NULL CHECK (check_in_source IN ('CAMERA', 'WEB_MANUAL')),
  manual_request_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_fefo
  ON inventory(fridge_id, estimated_expiry_date ASC, check_in_timestamp_s ASC);

-- Multi-node deduplication by (fridge_id, node_id, timestamp_s)
CREATE TABLE IF NOT EXISTS telemetry_samples (
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  timestamp_s INTEGER NOT NULL,
  temp_celsius REAL,
  voc_index INTEGER,
  light_ldr INTEGER,
  PRIMARY KEY (fridge_id, node_id, timestamp_s)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_fridge_time
  ON telemetry_samples(fridge_id, timestamp_s DESC);

CREATE TABLE IF NOT EXISTS door_events (
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  timestamp_s INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'CLOSING',
      'SUCCESS',
      'OBSTRUCTION_ERROR',
      'ABORTED',
      'TIMEOUT_ERROR',
      'FAULT_LOCKOUT',
      'CONTRADICTION_ERROR'
    )
  ),
  PRIMARY KEY (fridge_id, node_id, timestamp_s, status)
);

CREATE INDEX IF NOT EXISTS idx_door_events_fridge_time
  ON door_events(fridge_id, timestamp_s DESC);

CREATE TABLE IF NOT EXISTS system_status (
  fridge_id TEXT PRIMARY KEY NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  gateway_seen_s INTEGER NOT NULL,
  received_s INTEGER NOT NULL,
  nodes_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_cooldowns (
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  last_sent_s INTEGER NOT NULL,
  PRIMARY KEY (fridge_id, alert_type)
);
