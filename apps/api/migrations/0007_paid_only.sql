-- Owner, 2026-10-15: no free generation; films kept 3 days for accounts that never verified their
-- email and 30 days once verified. `retention` is set when the film is paid for and upgraded when
-- the owner verifies; the reminder the day before deletion is sent once.
ALTER TABLE stories ADD COLUMN retention TEXT NOT NULL DEFAULT 'guest';
ALTER TABLE stories ADD COLUMN reminded_at INTEGER;
