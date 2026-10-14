-- Times are milliseconds since the epoch.

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  fp_hash TEXT,
  ip_hash TEXT NOT NULL,
  capability TEXT NOT NULL,
  mode TEXT NOT NULL,
  mode_source TEXT NOT NULL,
  tier TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_key TEXT NOT NULL,
  mask_key TEXT,
  crop_box TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts TEXT NOT NULL DEFAULT '[]',
  charge TEXT NOT NULL,
  priority TEXT NOT NULL,
  error_code TEXT,
  feedback TEXT,
  idempotency_key TEXT NOT NULL,
  free_retry INTEGER NOT NULL DEFAULT 0,
  retried_at INTEGER,
  parent_job_id TEXT,
  batch_id TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX jobs_owner_idempotency ON jobs(owner, idempotency_key);
CREATE INDEX jobs_owner_created ON jobs(owner, created_at);
CREATE INDEX jobs_visitor_retried ON jobs(visitor_hash, retried_at);
CREATE INDEX jobs_fp_retried ON jobs(fp_hash, retried_at);
CREATE INDEX jobs_status_created ON jobs(status, created_at);

-- Spec 4.5. Seeded from @vzc/catalog on deploy (plan 7); an empty table means "use the seeds".
CREATE TABLE provider_routes (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  mode TEXT,
  rank INTEGER NOT NULL,
  parallel INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  params TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL,
  pad_aspect INTEGER NOT NULL,
  credits_tier TEXT NOT NULL,
  aspects TEXT NOT NULL,
  cost_usd REAL NOT NULL,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- Spec 7.1: IP segments, device fingerprints and visitors (accounts arrive in plan 3).
CREATE TABLE bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires INTEGER NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX bans_hash ON bans(hash, expires);
