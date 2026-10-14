-- Zombie love stories (backend plan Task 7/8). The jobs table stays (migrations only add).
CREATE TABLE stories (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  user_id TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  fp_hash TEXT,
  ip_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  scene TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  names TEXT,
  date TEXT,
  survivor_key TEXT NOT NULL,
  infected_key TEXT NOT NULL,
  status TEXT NOT NULL,
  picks TEXT NOT NULL DEFAULT '{}',
  steps TEXT NOT NULL DEFAULT '[]',
  output_key TEXT,
  poster_key TEXT,
  error_code TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL,
  render_key TEXT,
  created_at INTEGER NOT NULL,
  rendered_at INTEGER,
  finished_at INTEGER,
  expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX stories_owner_key ON stories(owner, idempotency_key);
CREATE INDEX stories_user_created ON stories(user_id, created_at);
CREATE INDEX stories_status ON stories(status, created_at);
CREATE INDEX stories_expires ON stories(expires_at);

-- Video routes carry their clip length limits: {"minSec":4,"maxSec":15,"allowedSec":[4,6,8]}.
ALTER TABLE provider_routes ADD COLUMN durations TEXT NOT NULL DEFAULT '{}';
