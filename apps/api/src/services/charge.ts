import { type Capability, TIERS } from "@vzc/catalog";
import type { Context } from "hono";
import type { AppEnv, Bindings } from "../types.ts";
import { limiter } from "./limits.ts";
import { countersFor, quotaStatus, reserveQuota } from "./quota.ts";
import type { ChargeHold } from "./settle.ts";
import { dailyCreditCap, reserveSpend, spendCounter } from "./spend-cap.ts";
import { isSuspicious } from "./suspicion.ts";

export type Hold =
  | { ok: true; charge: ChargeHold; priority: "paid" | "free" }
  | {
      ok: false;
      code:
        | "QUOTA_EXHAUSTED"
        | "CREDITS_LOW"
        | "FREE_TIER_PAUSED"
        | "FORBIDDEN"
        | "PAUSED"
        | "DAILY_LIMIT";
    };

/**
 * Spec 5.2 / 6.8: Standard spends the daily free quota first — not for suspicious identities
 * (5.4). While the free tier is paused (4.2) free photos are refused, and only members with no
 * free photos left pay credits. Signed-in users otherwise pay credits once the quota is used; Pro
 * and 4K always pay credits. Guests have no credits.
 */
export async function holdCharge(
  c: Context<AppEnv>,
  capability: Capability,
  jobId: string,
): Promise<Hold> {
  const userId = c.get("userId");
  const who = { owner: c.get("owner"), userId, fpHash: c.get("fpHash") };
  let refusal: "QUOTA_EXHAUSTED" | "FREE_TIER_PAUSED" = "QUOTA_EXHAUSTED";
  if (capability.usesDailyQuota && !(await isSuspicious(c.env, who))) {
    const counters = countersFor(c);
    if (c.get("freePaused")) {
      // A paused free tier never turns a free photo into a paid one without asking: only members
      // whose free photos are already used up go on to pay, as they would anyway.
      if ((await quotaStatus(c.env, counters)).remaining > 0)
        return { ok: false, code: "FREE_TIER_PAUSED" };
      refusal = "FREE_TIER_PAUSED";
    } else if (await reserveQuota(c.env, counters, jobId))
      return {
        ok: true,
        priority: "free",
        charge: { kind: "quota", nonce: jobId, counters: counters.map((x) => x.name) },
      };
  }
  if (!userId) return { ok: false, code: capability.usesDailyQuota ? refusal : "CREDITS_LOW" };
  const paused = await c.env.DB.prepare("SELECT paid_paused_at FROM users WHERE id=?")
    .bind(userId)
    .first<{ paid_paused_at: number | null }>();
  // Spec 6.6: paid features stay paused while a chargeback is open; free photos still work.
  if (paused?.paid_paused_at) return { ok: false, code: "FORBIDDEN" };
  // Cost guardrails spec 3: the daily paid line (or an admin) paused paid jobs; free photos still run.
  if (c.get("paidPaused")) return { ok: false, code: "PAUSED" };
  const credits = TIERS[capability.tier].credits;
  // Cost guardrails spec 4: a per-account daily credit line, held until the job ends.
  const cap = await dailyCreditCap(c.env, userId, Date.now());
  if (!(await reserveSpend(c.env, userId, jobId, credits, cap)))
    return { ok: false, code: "DAILY_LIMIT" };
  const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(userId));
  let reserved: Awaited<ReturnType<typeof wallet.reserve>>;
  try {
    reserved = await wallet.reserve(userId, jobId, credits, jobId);
  } catch (error) {
    // The wallet never held the credits, so the day's allowance must not stay held either.
    await limiter(c.env, spendCounter(userId)).release(jobId);
    throw error;
  }
  if (!reserved.ok) {
    await limiter(c.env, spendCounter(userId)).release(jobId);
    return { ok: false, code: "CREDITS_LOW" };
  }
  return {
    ok: true,
    priority: "paid",
    charge: {
      kind: "credits",
      userId,
      reservationId: jobId,
      reserved: credits,
      spendCounter: spendCounter(userId),
    },
  };
}

/** Spec 4.1: a credit job keeps its input for 7 days under keep/. */
export async function moveToKeep(env: Bindings, key: string): Promise<string> {
  const object = await env.BUCKET.get(key);
  if (!object) throw new Error(`upload ${key} is gone`);
  const keepKey = key.replace(/^in\//, "keep/");
  await env.BUCKET.put(keepKey, await object.arrayBuffer(), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  await env.BUCKET.delete(key);
  return keepKey;
}
