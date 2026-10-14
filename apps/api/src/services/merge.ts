import type { Context } from "hono";
import { utcDay } from "../durable-objects/rate-limiter.ts";
import type { AppEnv } from "../types.ts";
import { limiter } from "./limits.ts";

/**
 * Spec 5.1: the guest's free photos today count against the account, and the guest's unfinished
 * jobs move to the account. Finished guest jobs stay with the guest identity; the same browser can
 * still open them (see `ownsJob`).
 */
export async function mergeGuest(c: Context<AppEnv>, userId: string): Promise<void> {
  const visitorHash = c.get("visitorHash");
  const used = await limiter(c.env, `quota:visitor:${visitorHash}`).used();
  if (used > 0)
    await limiter(c.env, `quota:user:${userId}`).absorb(
      `merge:${visitorHash}:${utcDay(Date.now())}`,
      used,
    );
  await c.env.DB.prepare(
    "UPDATE jobs SET owner=? WHERE owner=? AND status IN ('created','queued','submitted')",
  )
    .bind(`u:${userId}`, `g:${visitorHash}`)
    .run();
}
