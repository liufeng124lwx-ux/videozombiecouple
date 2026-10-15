-- Legal review, 2026-10-15: the uploader agrees, before every upload, that both people are adults who
-- agreed to be in the film and to the in-memory face analysis. Which text they agreed to, and when.
ALTER TABLE stories ADD COLUMN consent_version TEXT;
ALTER TABLE stories ADD COLUMN consent_at INTEGER;
