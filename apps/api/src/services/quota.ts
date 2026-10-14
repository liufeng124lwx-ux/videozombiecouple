import { QUOTA } from "@vzc/catalog";
import type { Context } from "hono";
import { utcDay } from "../durable-objects/rate-limiter.ts";
import type { AppEnv, Bindings } from "../types.ts";
import { limiter } from "./limits.ts";

export type QuotaCounter = { name: string; limit: number };

/** Spec §7: free previews are per account, with a cap per IP segment against account farming. */
export function previewCounters(userId: string, ipSegmentHash: string): QuotaCounter[] {
  return [
    { name: `quota:preview:user:${userId}`, limit: QUOTA.previewUserDaily },
    { name: `quota:preview:ip:${ipSegmentHash}`, limit: QUOTA.previewIpSegmentDaily },
  ];
}

/** The signed-in user's preview counters; guests have none (previews need an account). */
export function countersFor(c: Context<AppEnv>): QuotaCounter[] {
  const userId = c.get("userId");
  return userId ? previewCounters(userId, c.get("ipSegmentHash")) : [];
}

/** Reserves one use on every counter, or none: a refusal or an error gives back what was taken. */
export async function reserveQuota(
  env: Bindings,
  counters: QuotaCounter[],
  nonce: string,
): Promise<boolean> {
  const taken: string[] = [];
  try {
    for (const counter of counters) {
      const result = await limiter(env, counter.name).reserve(nonce, counter.limit);
      if (!result.allowed) {
        await releaseQuota(env, taken, nonce);
        return false;
      }
      taken.push(counter.name);
    }
  } catch (error) {
    await releaseQuota(env, taken, nonce).catch(() => undefined);
    throw error;
  }
  return true;
}

export async function commitQuota(env: Bindings, names: string[], nonce: string): Promise<void> {
  for (const name of names) await limiter(env, name).commit(nonce);
}

export async function releaseQuota(env: Bindings, names: string[], nonce: string): Promise<void> {
  for (const name of names) await limiter(env, name).release(nonce);
}

export async function quotaStatus(
  env: Bindings,
  counters: QuotaCounter[],
): Promise<{ remaining: number; limit: number; resetAt: number }> {
  let remaining = Number.POSITIVE_INFINITY;
  for (const counter of counters) {
    const used = await limiter(env, counter.name).used();
    remaining = Math.min(remaining, Math.max(0, counter.limit - used));
  }
  return {
    remaining: Number.isFinite(remaining) ? remaining : 0,
    limit: counters[0]?.limit ?? 0,
    resetAt: (utcDay(Date.now()) + 1) * 86_400_000,
  };
}
