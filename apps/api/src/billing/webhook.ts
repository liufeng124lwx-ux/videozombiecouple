import type { Bindings } from "../types.ts";
import { applyEvent } from "./apply.ts";
import type { BillingEvent } from "./events.ts";
import type { StripeEvent } from "./stripe.ts";
import { fromStripe } from "./stripe-events.ts";
import type { WaffoWebhookEvent } from "./waffo.ts";
import { fromWaffo } from "./waffo-events.ts";

/** A claim older than this belongs to a handler that died; another may take over. */
const CLAIM_STALE_MS = 60_000;
/** Replay gives up on a delivery after this many failures; ops sees it in billing_events. */
export const MAX_ATTEMPTS = 10;

export type Outcome = "done" | "busy" | "failed";

function toEvent(provider: string, payload: string): BillingEvent {
  if (provider === "waffo") return fromWaffo(JSON.parse(payload) as WaffoWebhookEvent);
  if (provider === "stripe") return fromStripe(JSON.parse(payload) as StripeEvent);
  throw new Error(`unknown billing provider ${provider}`);
}

/**
 * Spec 6.2: one handler at a time per delivery (review focus 1). The claim is a conditional UPDATE,
 * so two copies of a delivery cannot both apply it.
 */
export async function processStored(env: Bindings, id: string): Promise<Outcome> {
  const now = Date.now();
  const claim = await env.DB.prepare(
    "UPDATE billing_events SET processing_at=? WHERE id=? AND processed_at IS NULL AND (processing_at IS NULL OR processing_at<?)",
  )
    .bind(now, id, now - CLAIM_STALE_MS)
    .run();
  if (claim.meta.changes === 0) {
    const row = await env.DB.prepare("SELECT processed_at FROM billing_events WHERE id=?")
      .bind(id)
      .first<{ processed_at: number | null }>();
    return row?.processed_at ? "done" : "busy";
  }
  const row = await env.DB.prepare("SELECT provider, payload FROM billing_events WHERE id=?")
    .bind(id)
    .first<{ provider: string; payload: string }>();
  try {
    if (!row) throw new Error(`billing event ${id} vanished`);
    await applyEvent(env, row.provider, toEvent(row.provider, row.payload));
    await env.DB.prepare(
      "UPDATE billing_events SET processed_at=?, processing_at=NULL, error=NULL WHERE id=?",
    )
      .bind(Date.now(), id)
      .run();
    return "done";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      "UPDATE billing_events SET processing_at=NULL, error=?, attempts=attempts+1 WHERE id=?",
    )
      .bind(message.slice(0, 500), id)
      .run();
    console.error(JSON.stringify({ level: "error", billingEvent: id, error: message }));
    return "failed";
  }
}

/**
 * Waffo retries a failed delivery only 3 times (Stripe for 3 days). The hourly ops cron (ops/cron.ts) calls this for deliveries
 * that failed or were never finished, oldest first.
 */
export async function replayPending(
  env: Bindings,
  now = Date.now(),
): Promise<{ done: number; failed: number }> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM billing_events WHERE processed_at IS NULL AND attempts<? AND received_at<? ORDER BY received_at LIMIT 100",
  )
    .bind(MAX_ATTEMPTS, now - CLAIM_STALE_MS)
    .all<{ id: string }>();
  const tally = { done: 0, failed: 0 };
  for (const { id } of results) {
    const outcome = await processStored(env, id);
    if (outcome === "done") tally.done += 1;
    else if (outcome === "failed") tally.failed += 1;
  }
  return tally;
}
