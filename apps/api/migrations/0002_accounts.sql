-- Spec 5.1 / 5.3. Times are milliseconds since the epoch.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  google_sub TEXT,
  email_verified_at INTEGER,
  suspicious_at INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE credit_buckets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- subscription | pack | bonus | admin
  granted INTEGER NOT NULL,
  remaining INTEGER NOT NULL CHECK (remaining >= 0),
  expires_at INTEGER,              -- null: never expires
  source_ref TEXT,                 -- order id, "signup", …; makes grants idempotent
  created_at INTEGER NOT NULL
);
CREATE INDEX credit_buckets_user ON credit_buckets(user_id, created_at);
CREATE UNIQUE INDEX credit_buckets_source ON credit_buckets(user_id, source_ref)
  WHERE source_ref IS NOT NULL;

-- Append only. For every bucket, remaining = SUM(delta).
CREATE TABLE credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  bucket_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  type TEXT NOT NULL,              -- grant | reserve | commit | release | clawback | expire | admin_adjust
  job_id TEXT,
  order_id TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX credit_ledger_user ON credit_ledger(user_id, id);
CREATE INDEX credit_ledger_bucket ON credit_ledger(bucket_id);

-- One row per credit hold, written in the same D1 batch as its ledger rows, so a crash can never
-- leave a hold without its deduction (or a settled hold without its refund).
CREATE TABLE credit_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  parts TEXT NOT NULL,             -- JSON [{bucketId, credits}]
  state TEXT NOT NULL,             -- held | committed | released
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX credit_reservations_held ON credit_reservations(state, created_at);
