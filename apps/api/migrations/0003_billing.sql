-- Spec 6.3. Times are milliseconds since the epoch.

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_order_id TEXT NOT NULL,   -- a pack order, or a subscription's order id
  user_id TEXT,                      -- NULL once the account is deleted (kept for tax)
  product_key TEXT NOT NULL,
  amount REAL,
  currency TEXT,
  status TEXT NOT NULL,              -- paid | refunded | partially_refunded | disputed
  refunded_amount REAL NOT NULL DEFAULT 0,
  -- Credits already taken back (clawed + left as debt), so refunds and chargebacks never take more
  -- than the order granted. For subscriptions this counts within clawed_period only.
  clawed_credits INTEGER NOT NULL DEFAULT 0,
  clawed_period INTEGER,
  -- What an open chargeback took and left as debt, given back if it is won.
  dispute_clawed INTEGER NOT NULL DEFAULT 0,
  dispute_debt INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX orders_provider_order ON orders(provider, provider_order_id);
CREATE INDEX orders_user ON orders(user_id, created_at);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_sub_id TEXT NOT NULL,
  user_id TEXT,
  plan_key TEXT NOT NULL,            -- starter | plus | max
  interval TEXT NOT NULL,            -- month | year
  status TEXT NOT NULL,              -- active | canceling | past_due | canceled
  current_period_start INTEGER NOT NULL,
  current_period_end INTEGER NOT NULL,
  next_grant_at INTEGER,             -- yearly plans: when the next monthly credits are due
  cancel_at INTEGER,
  last_event_at INTEGER NOT NULL,    -- ordering for events of the same period
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX subscriptions_provider_sub ON subscriptions(provider, provider_sub_id);
CREATE INDEX subscriptions_user ON subscriptions(user_id);
CREATE INDEX subscriptions_next_grant ON subscriptions(next_grant_at)
  WHERE next_grant_at IS NOT NULL;

CREATE TABLE billing_events (
  id TEXT PRIMARY KEY,               -- the provider's delivery id
  provider TEXT NOT NULL,
  type TEXT NOT NULL,
  mode TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  processing_at INTEGER,             -- claimed by a handler; stale after a minute
  processed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,  -- failed attempts; replay gives up at 10
  error TEXT
);
CREATE INDEX billing_events_pending ON billing_events(processed_at, received_at);

ALTER TABLE users ADD COLUMN paid_paused_at INTEGER;
ALTER TABLE users ADD COLUMN refund_debt INTEGER NOT NULL DEFAULT 0;
