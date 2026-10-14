-- Spec 8.1: every admin write, with what it changed.
CREATE TABLE admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  before TEXT,
  after TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX admin_audit_created ON admin_audit(created_at);

-- One row per submitted admin form, claimed before anything changes, so a double submit applies once.
CREATE TABLE admin_nonces (
  nonce TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- Plan 7A scans these every few minutes.
CREATE INDEX jobs_created ON jobs(created_at);
CREATE INDEX jobs_expires ON jobs(expires_at);
