-- Christmas spec 2026-10-15 §4.2: which story a film tells. Every existing row is a zombie film.
ALTER TABLE stories ADD COLUMN story TEXT NOT NULL DEFAULT 'zombie';
