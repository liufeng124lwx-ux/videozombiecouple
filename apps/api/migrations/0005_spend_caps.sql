-- Cost guardrails spec 4: an admin's per-account daily credit cap (NULL = the catalog default).
ALTER TABLE users ADD COLUMN daily_credit_cap INTEGER;
