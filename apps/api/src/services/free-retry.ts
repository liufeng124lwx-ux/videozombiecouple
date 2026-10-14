import { FREE_RETRY } from "@vzc/catalog";
import { utcDay } from "../durable-objects/rate-limiter.ts";

/**
 * Spec 3.7: at most `perIdentityDaily` free retries per cookie and per device fingerprint each UTC
 * day; once an owner has `rateMinJobs` jobs, refuse when this retry would make more than `rateMax`
 * of their last `rateWindow` jobs free retries. Signed-in users are also counted per account.
 */
export async function retryAllowed(
  db: D1Database,
  who: { owner: string; userId: string | null; visitorHash: string; fpHash: string | null },
): Promise<boolean> {
  const since = utcDay(Date.now()) * 86_400_000;
  const today = async (column: "visitor_hash" | "fp_hash", value: string) =>
    (
      await db
        .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${column}=? AND retried_at>=?`)
        .bind(value, since)
        .first<{ n: number }>()
    )?.n ?? 0;
  if (who.userId) {
    const byAccount =
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM jobs WHERE owner=? AND retried_at>=?")
          .bind(who.owner, since)
          .first<{ n: number }>()
      )?.n ?? 0;
    if (byAccount >= FREE_RETRY.perIdentityDaily) return false;
  }
  if ((await today("visitor_hash", who.visitorHash)) >= FREE_RETRY.perIdentityDaily) return false;
  if (who.fpHash && (await today("fp_hash", who.fpHash)) >= FREE_RETRY.perIdentityDaily)
    return false;
  const total =
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM jobs WHERE owner=?")
        .bind(who.owner)
        .first<{ n: number }>()
    )?.n ?? 0;
  if (total < FREE_RETRY.rateMinJobs) return true;
  const { results } = await db
    .prepare("SELECT free_retry FROM jobs WHERE owner=? ORDER BY created_at DESC LIMIT ?")
    .bind(who.owner, FREE_RETRY.rateWindow)
    .all<{ free_retry: number }>();
  const retried = results.filter((row) => row.free_retry === 1).length;
  return (retried + 1) / results.length <= FREE_RETRY.rateMax;
}
