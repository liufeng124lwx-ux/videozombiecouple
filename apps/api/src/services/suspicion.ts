import { ABUSE } from "@vzc/catalog";
import type { Bindings } from "../types.ts";

export type Who = { owner: string; userId: string | null; fpHash: string | null };

const ownerKey = (owner: string) => `suspicious:owner:${owner}`;
const deviceKey = (fpHash: string) => `suspicious:fp:${fpHash}`;

async function flagged(env: Bindings, key: string): Promise<boolean> {
  const raw = await env.KV.get(key);
  if (!raw) return false;
  try {
    return (JSON.parse(raw) as { until: number }).until > Date.now();
  } catch {
    return false;
  }
}

async function flag(env: Bindings, key: string): Promise<void> {
  const value = JSON.stringify({ until: Date.now() + ABUSE.suspiciousDeviceMs });
  await env.KV.put(key, value, { expirationTtl: ABUSE.suspiciousDeviceMs / 1000 });
}

/** Spec 5.4: suspicious accounts and devices get no daily free quota and no sign-up bonus. */
export async function isSuspicious(env: Bindings, who: Who): Promise<boolean> {
  if (who.userId) {
    const row = await env.DB.prepare("SELECT suspicious_at FROM users WHERE id=?")
      .bind(who.userId)
      .first<{ suspicious_at: number | null }>();
    if (row?.suspicious_at) return true;
  } else if (await flagged(env, ownerKey(who.owner))) return true;
  return who.fpHash !== null && (await flagged(env, deviceKey(who.fpHash)));
}

/**
 * Spec 7.3: more than 5 rejected jobs in 24 hours (a model refused it, or the photo check found nudity
 * or a minor) marks the account (or guest) and the device.
 */
export async function noteRejections(env: Bindings, who: Who): Promise<boolean> {
  const since = Date.now() - ABUSE.rejectionWindowMs;
  const rejections = async (column: "owner" | "fp_hash", value: string) =>
    (
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM stories WHERE ${column}=? AND error_code IN ('CONTENT_REJECTED','PHOTO_REJECTED','UNDERAGE') AND created_at>?`,
      )
        .bind(value, since)
        .first<{ n: number }>()
    )?.n ?? 0;
  let marked = false;
  if ((await rejections("owner", who.owner)) > ABUSE.maxRejections) {
    if (who.userId)
      await env.DB.prepare("UPDATE users SET suspicious_at=COALESCE(suspicious_at, ?) WHERE id=?")
        .bind(Date.now(), who.userId)
        .run();
    else await flag(env, ownerKey(who.owner));
    marked = true;
  }
  if (who.fpHash && (await rejections("fp_hash", who.fpHash)) > ABUSE.maxRejections) {
    await flag(env, deviceKey(who.fpHash));
    marked = true;
  }
  return marked;
}
