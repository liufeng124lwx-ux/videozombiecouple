import { TIERS } from "@vzc/catalog";
import type { Context } from "hono";
import type { AppEnv, Bindings } from "../types.ts";
import { limiter } from "./limits.ts";
import { countersFor, reserveQuota } from "./quota.ts";
import type { ChargeHold } from "./settle.ts";
import { dailyCreditCap, reserveSpend, spendCounter } from "./spend-cap.ts";
import { isSuspicious } from "./suspicion.ts";

export type Hold =
  | { ok: true; charge: ChargeHold }
  | {
      ok: false;
      code:
        | "LOGIN_REQUIRED"
        | "PREVIEW_QUOTA_EXHAUSTED"
        | "FREE_TIER_PAUSED"
        | "CREDITS_LOW"
        | "FORBIDDEN"
        | "PAUSED"
        | "DAILY_LIMIT";
    };

/**
 * Spec §7: a free preview takes one use of the account's daily preview quota (and its IP
 * segment's). Suspicious identities and a paused free tier get no previews.
 */
export async function holdPreview(c: Context<AppEnv>, storyId: string): Promise<Hold> {
  const userId = c.get("userId");
  if (!userId) return { ok: false, code: "LOGIN_REQUIRED" };
  if (c.get("freePaused")) return { ok: false, code: "FREE_TIER_PAUSED" };
  const who = { owner: c.get("owner"), userId, fpHash: c.get("fpHash") };
  if (await isSuspicious(c.env, who)) return { ok: false, code: "PREVIEW_QUOTA_EXHAUSTED" };
  const counters = countersFor(c);
  if (!(await reserveQuota(c.env, counters, storyId)))
    return { ok: false, code: "PREVIEW_QUOTA_EXHAUSTED" };
  return {
    ok: true,
    charge: { kind: "quota", nonce: storyId, counters: counters.map((x) => x.name) },
  };
}

/**
 * Spec §7: the video holds TIERS.video.credits from the wallet until it is delivered (commit) or
 * fails (release). Paused accounts and the per-account daily line still apply.
 */
export async function holdVideo(
  c: Context<AppEnv>,
  storyId: string,
  reservationId: string = storyId,
): Promise<Hold> {
  const userId = c.get("userId");
  if (!userId) return { ok: false, code: "LOGIN_REQUIRED" };
  const paused = await c.env.DB.prepare("SELECT paid_paused_at FROM users WHERE id=?")
    .bind(userId)
    .first<{ paid_paused_at: number | null }>();
  // Paid features stay paused while a chargeback is open.
  if (paused?.paid_paused_at) return { ok: false, code: "FORBIDDEN" };
  // Cost guardrails: the daily paid line (or an admin) paused paid work.
  if (c.get("paidPaused")) return { ok: false, code: "PAUSED" };
  const credits = TIERS.video.credits;
  const cap = await dailyCreditCap(c.env, userId, Date.now());
  if (!(await reserveSpend(c.env, userId, reservationId, credits, cap)))
    return { ok: false, code: "DAILY_LIMIT" };
  const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(userId));
  let reserved: Awaited<ReturnType<typeof wallet.reserve>>;
  try {
    reserved = await wallet.reserve(userId, reservationId, credits, storyId);
  } catch (error) {
    await limiter(c.env, spendCounter(userId)).release(reservationId);
    throw error;
  }
  if (!reserved.ok) {
    await limiter(c.env, spendCounter(userId)).release(reservationId);
    return { ok: false, code: "CREDITS_LOW" };
  }
  return {
    ok: true,
    charge: {
      kind: "credits",
      userId,
      reservationId,
      reserved: credits,
      spendCounter: spendCounter(userId),
    },
  };
}

/** Spec §3.4: a story keeps its two photos under keep/<id>/ until the photos expire. */
export async function moveToKeep(env: Bindings, key: string, keepKey: string): Promise<void> {
  const object = await env.BUCKET.get(key);
  if (!object) throw new Error(`upload ${key} is gone`);
  await env.BUCKET.put(keepKey, await object.arrayBuffer(), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  await env.BUCKET.delete(key);
}
