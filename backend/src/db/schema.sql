-- LiveStage database schema (build spec §8.2). The full locked schema is created up front
-- (analytics tables included as DDL) so M3 needs no migration; M1 only writes to the
-- non-analytics tables. CREATE ... IF NOT EXISTS makes boot idempotent.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,             -- public lookup id (the prefix in the presented key)
  project_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,          -- hash of the SECRET part only, never the raw key
  key_type TEXT NOT NULL,          -- 'mobile' (SDK, shippable) | 'service' (Insights reads, server-only)
  label TEXT,
  revoked INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  template_id TEXT NOT NULL,        -- developer-facing id, unique per project
  type TEXT NOT NULL,               -- journey | countdown | progress
  display_name TEXT NOT NULL,
  icon TEXT NOT NULL,
  accent TEXT NOT NULL,
  deep_link_base TEXT NOT NULL,
  labels_json TEXT NOT NULL,
  zero_state_label TEXT,
  stale_after_seconds INTEGER NOT NULL DEFAULT 900,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, template_id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS activity_sessions (
  id TEXT PRIMARY KEY,              -- sessionId
  project_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  type TEXT NOT NULL,
  deep_link_url TEXT NOT NULL,
  status TEXT NOT NULL,             -- active | ended (server-known only)
  version INTEGER NOT NULL DEFAULT 1,
  last_updated_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  attributes_json TEXT NOT NULL,    -- frozen at start; immutable while running
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS session_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  mutation_id TEXT,                 -- clientMutationId that produced this version
  payload_json TEXT NOT NULL,
  accepted_at TEXT NOT NULL,        -- SERVER clock when this version was accepted (latency anchor T1)
  created_at TEXT NOT NULL,
  UNIQUE(session_id, version),
  UNIQUE(session_id, mutation_id),  -- repeated mutation_id returns original, no new version
  FOREIGN KEY (session_id) REFERENCES activity_sessions(id)
);

-- Persistent start idempotency (retry-safe POST /v1/activities). A repeat with the same key and
-- the same request returns the original session; a repeat with a DIFFERENT body is a 409 conflict.
CREATE TABLE IF NOT EXISTS start_idempotency (
  key TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES activity_sessions(id)
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL,              -- start | update | end | reject
  detail TEXT,
  status TEXT NOT NULL,            -- ok | error
  created_at TEXT NOT NULL
);

-- Analytics: two levels (raw history + fast aggregates). DDL only in M1; populated in M3.
CREATE TABLE IF NOT EXISTS analytics_events (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  version INTEGER,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_project_time   ON analytics_events(project_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_proj_tmpl_time ON analytics_events(project_id, template_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_session_time   ON analytics_events(session_id, occurred_at);

CREATE TABLE IF NOT EXISTS daily_metrics (
  project_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  date TEXT NOT NULL,
  sessions_started INTEGER DEFAULT 0,
  sessions_ended INTEGER DEFAULT 0,
  update_attempts INTEGER DEFAULT 0,
  accepted_updates INTEGER DEFAULT 0,
  rejected_updates INTEGER DEFAULT 0,
  late_application_sessions INTEGER DEFAULT 0,
  updates_applied INTEGER DEFAULT 0,
  opens INTEGER DEFAULT 0,
  expanded_action_taps INTEGER DEFAULT 0,
  sessions_with_interaction INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  ack_count INTEGER DEFAULT 0,
  total_sync_latency_ms INTEGER DEFAULT 0,
  PRIMARY KEY (project_id, template_id, date)
);

CREATE TABLE IF NOT EXISTS applied_latencies (
  project_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  accepted_at TEXT NOT NULL,
  ack_received_at TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  date TEXT NOT NULL,
  PRIMARY KEY (session_id, version)
);
CREATE INDEX IF NOT EXISTS idx_latency_project_date          ON applied_latencies(project_id, date);
CREATE INDEX IF NOT EXISTS idx_latency_project_template_date ON applied_latencies(project_id, template_id, date);
