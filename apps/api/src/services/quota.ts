import { QUOTA } from "@vzc/catalog";
import type { Context } from "hono";
import { utcDay } from "../durable-objects/rate-limiter.ts";
import type { AppEnv, Bindings } from "../types.ts";
import { limiter } from "./limits.ts";

export type QuotaCounter = { name: string; limit: number };

/** Spec 5.2: cookie and device each get the guest limit; the IP segment gets its own cap. */
export function guestCounters(ids: {
  visitorHash: string;
  fpHash: string | null;
  ipSegmentHash: string;
}): QuotaCounter[] {
  const counters: QuotaCounter[] = [
    { name: `quota:visitor:${ids.visitorHash}`, limit: QUOTA.guestDaily },
  ];
  if (ids.fpHash) counters.push({ name: `quota:fp:${ids.fpHash}`, limit: QUOTA.guestDaily });
  counters.push({ name: `quota:ip:${ids.ipSegmentHash}`, limit: QUOTA.ipSegmentDaily });
  return counters;
}

/** Spec 5.2: an account gets its own daily limit; the IP segment cap still applies. */
export function userCounters(userId: string, ipSegmentHash: string): QuotaCounter[] {
  return [
    { name: `quota:user:${userId}`, limit: QUOTA.userDaily },
    { name: `quota:ip:${ipSegmentHash}`, limit: QUOTA.ipSegmentDaily },
  ];
}

export function countersFor(c: Context<AppEnv>): QuotaCounter[] {
  const userId = c.get("userId");
  return userId
    ? userCounters(userId, c.get("ipSegmentHash"))
    : guestCounters({
        visitorHash: c.get("visitorHash"),
        fpHash: c.get("fpHash"),
        ipSegmentHash: c.get("ipSegmentHash"),
      });
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
