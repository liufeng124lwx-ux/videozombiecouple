import type { Context } from "hono";
import { countersFor, quotaStatus } from "../services/quota.ts";
import { isSuspicious } from "../services/suspicion.ts";
import type { AppEnv } from "../types.ts";

/** Free previews left today (spec §7). Guests and suspicious identities have none. */
export async function quota(c: Context<AppEnv>) {
  const counters = countersFor(c);
  if (counters.length === 0)
    return c.json({ remaining: 0, limit: 0, resetAt: null, loginRequired: true });
  const status = await quotaStatus(c.env, counters);
  const who = { owner: c.get("owner"), userId: c.get("userId"), fpHash: c.get("fpHash") };
  if (await isSuspicious(c.env, who)) return c.json({ ...status, remaining: 0 });
  return c.json(status);
}
