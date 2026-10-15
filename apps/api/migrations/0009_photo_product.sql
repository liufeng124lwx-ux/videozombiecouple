-- SEO review, 2026-10-15: the free AI zombie filter makes one photo; it shares the stories table and
-- runner with films. "film" for every existing row.
ALTER TABLE stories ADD COLUMN product TEXT NOT NULL DEFAULT 'film';
CREATE INDEX stories_photo_visitor ON stories(product, visitor_hash, created_at);
CREATE INDEX stories_photo_ip ON stories(product, ip_hash, created_at);
