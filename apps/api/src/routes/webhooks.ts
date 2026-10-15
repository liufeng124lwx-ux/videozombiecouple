import type { Context } from "hono";
import { stripeConfig, verifyStripeWebhook } from "../billing/stripe.ts";
import { verifyWebhook, waffoConfig } from "../billing/waffo.ts";
import { processStored } from "../billing/webhook.ts";
import { fail } from "../http.ts";
import { clearBadSignatures, countBadSignature } from "../ops/webhook-alerts.ts";
import { callbackToken, safeEqual } from "../services/crypto.ts";
import type { AppEnv } from "../types.ts";
import { runnerFor, STORY_ID } from "./stories.ts";

/**
 * Spec §4.2: kie calls `/webhooks/kie/<storyId>?t=<HMAC>` when a task ends. The body is not trusted;
 * the runner asks recordInfo itself. Repeats and late calls are harmless (review focus 3).
 */
export async function kieCallback(c: Context<AppEnv>) {
  const storyId = c.req.param("storyId") ?? "";
  const token = c.req.query("t") ?? "";
  if (!STORY_ID.test(storyId) || !safeEqual(token, await callbackToken(storyId, c.env.HMAC_KEY)))
    return fail(c, "FORBIDDEN");
  await runnerFor(c, storyId).poke();
  return c.json({ ok: true });
}

const MAX_WEBHOOK_BYTES = 64 * 1024;

/** Spec 6.2: verify, keep the raw delivery, then apply it once. */
export async function waffoWebhook(c: Context<AppEnv>) {
  const config = waffoConfig(c.env);
  if (!config) return c.text("payments disabled", 503);
  const raw = await c.req.text();
  if (raw.length > MAX_WEBHOOK_BYTES) return c.text("too large", 413);
  const event = await verifyWebhook(
    raw,
    c.req.header("x-waffo-signature"),
    config.mode,
    Date.now(),
    c.env.WAFFO_WEBHOOK_PUBLIC_KEY,
  );
  if (!event) {
    await countBadSignature(c.env, Date.now());
    return c.text("invalid signature", 401);
  }
  await clearBadSignatures(c.env, Date.now());
  // Every merchant's events carry the same platform signature, so only our store counts.
  if (!config.storeIds.includes(event.storeId)) return c.text("OK");
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO billing_events(id,provider,type,mode,payload,received_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(event.id, "waffo", event.eventType, event.mode, raw, Date.now())
    .run();
  const outcome = await processStored(c.env, event.id);
  if (outcome === "failed") return c.text("retry", 500);
  if (outcome === "busy") return c.text("in progress", 409);
  return c.text("OK");
}

/** Stripe: verify, drop the other mode's events, keep the raw delivery, then apply it once. */
export async function stripeWebhook(c: Context<AppEnv>) {
  const config = stripeConfig(c.env);
  if (!config?.webhookSecret) return c.text("payments disabled", 503);
  const raw = await c.req.text();
  if (raw.length > MAX_WEBHOOK_BYTES) return c.text("too large", 413);
  const event = await verifyStripeWebhook(
    raw,
    c.req.header("stripe-signature"),
    config.webhookSecret,
  );
  if (!event) {
    await countBadSignature(c.env, Date.now());
    return c.text("invalid signature", 401);
  }
  await clearBadSignatures(c.env, Date.now());
  // A test event must never reach the live ledger, nor the other way round.
  if (event.livemode !== config.live) return c.text("OK");
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO billing_events(id,provider,type,mode,payload,received_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(event.id, "stripe", event.type, event.livemode ? "live" : "test", raw, Date.now())
    .run();
  const outcome = await processStored(c.env, event.id);
  if (outcome === "failed") return c.text("retry", 500);
  if (outcome === "busy") return c.text("in progress", 409);
  return c.text("OK");
}
