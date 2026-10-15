import { TIERS } from "@vzc/catalog";
import type { Context } from "hono";
import type { AppEnv, Bindings } from "../types.ts";
import { limiter } from "./limits.ts";
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
 * Why this account may not start paid work now (render, remake, buy), or null. A chargeback is open,
 * or a refund came after the credits were spent (refund_debt): the film was had for free once. Or
 * the cost guardrails (the daily paid line, or an admin) paused paid work site-wide.
 */
export async function paidBlock(
  c: Context<AppEnv>,
  userId: string,
): Promise<"FORBIDDEN" | "PAUSED" | null> {
  const user = await c.env.DB.prepare("SELECT paid_paused_at, refund_debt FROM users WHERE id=?")
    .bind(userId)
    .first<{ paid_paused_at: number | null; refund_debt: number }>();
  if (user?.paid_paused_at || (user?.refund_debt ?? 0) > 0) return "FORBIDDEN";
  if (c.get("paidPaused")) return "PAUSED";
  return null;
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
  const blocked = await paidBlock(c, userId);
  if (blocked) return { ok: false, code: blocked };
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
