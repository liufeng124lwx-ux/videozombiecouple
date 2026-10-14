import type { WaffoWebhookEvent } from "../billing/waffo.ts";
import { fromWaffo } from "../billing/waffo-events.ts";
import type { Bindings } from "../types.ts";
import { deliver, raise, resolve, type Send } from "./alerts.ts";

const WINDOW_MS = 48 * 3_600_000;
const TITLE = "Payments without an order";

/**
 * Spec 8.2: every processed payment of the last 48 hours has its orders row. Orders are only ever
 * written by processing an event (billing/apply.ts), so this one direction is the check.
 */
export async function checkOrders(env: Bindings, now: number, send: Send = deliver): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id, provider, payload FROM billing_events WHERE processed_at IS NOT NULL AND error IS NULL AND received_at>=? ORDER BY received_at LIMIT 1000",
  )
    .bind(now - WINDOW_MS)
    .all<{ id: string; provider: string; payload: string }>();
  const missing: string[] = [];
  for (const row of results) {
    if (row.provider !== "waffo") continue;
    let orderId: string | null = null;
    try {
      const event = fromWaffo(JSON.parse(row.payload) as WaffoWebhookEvent);
      if (event.kind === "order_paid" && event.userId) orderId = event.orderId;
      if (event.kind === "sub_started" && event.userId) orderId = event.subId;
    } catch {
      continue;
    }
    if (!orderId) continue;
    const order = await env.DB.prepare(
      "SELECT id FROM orders WHERE provider=? AND provider_order_id=?",
    )
      .bind(row.provider, orderId)
      .first();
    if (!order) missing.push(`${orderId} (event ${row.id})`);
  }
  if (missing.length > 0)
    await raise(
      env,
      { key: "reconcile:orders", title: TITLE, detail: missing.slice(0, 10).join("\n") },
      now,
      send,
    );
  else await resolve(env, "reconcile:orders", TITLE, now, send);
}
