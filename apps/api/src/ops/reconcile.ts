import { OPS } from "@vzc/catalog";
import type { Bindings } from "../types.ts";
import { deliver, raise, resolve, type Send } from "./alerts.ts";

/** Spec 8.2: every credit bucket's remaining equals the sum of its ledger rows. */
export async function checkLedger(env: Bindings, now: number, send: Send = deliver): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT b.id AS id, b.remaining AS remaining, COALESCE(SUM(l.delta), 0) AS sum FROM credit_buckets b LEFT JOIN credit_ledger l ON l.bucket_id = b.id GROUP BY b.id HAVING b.remaining != COALESCE(SUM(l.delta), 0) LIMIT 20",
  ).all<{ id: string; remaining: number; sum: number }>();
  const title = "Credit ledger doesn't add up";
  if (results.length > 0)
    await raise(
      env,
      {
        key: "ledger",
        title,
        detail: results.map((r) => `${r.id}: ${r.remaining} vs ledger ${r.sum}`).join("\n"),
      },
      now,
      send,
    );
  else await resolve(env, "ledger", title, now, send);
}

/** Holds still open long after their job should have settled. */
export async function checkHolds(env: Bindings, now: number, send: Send = deliver): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM credit_reservations WHERE state='held' AND created_at<?",
  )
    .bind(now - OPS.staleHoldMs)
    .first<{ n: number }>();
  const n = row?.n ?? 0;
  const title = "Credit holds left open";
  if (n > 0)
    await raise(env, { key: "holds", title, detail: `${n} holds older than an hour` }, now, send);
  else await resolve(env, "holds", title, now, send);
}

/** Webhook deliveries not processed after an hour, or given up on (spec 6.2 replays up to 10 times). */
export async function checkWebhooks(
  env: Bindings,
  now: number,
  send: Send = deliver,
): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM billing_events WHERE processed_at IS NULL AND (received_at<? OR attempts>=10)",
  )
    .bind(now - OPS.webhookStaleMs)
    .first<{ n: number }>();
  const n = row?.n ?? 0;
  const title = "Payment webhooks are backing up";
  if (n > 0)
    await raise(
      env,
      { key: "webhooks", title, detail: `${n} deliveries not processed` },
      now,
      send,
    );
  else await resolve(env, "webhooks", title, now, send);
}
