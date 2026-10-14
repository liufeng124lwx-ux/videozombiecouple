import type { Context } from "hono";
import { countersFor, quotaStatus } from "../services/quota.ts";
import { isSuspicious } from "../services/suspicion.ts";
import type { AppEnv } from "../types.ts";

/** Free uses left today, for the quota card (spec 5.2). Suspicious identities have none (5.4). */
export async function quota(c: Context<AppEnv>) {
  const status = await quotaStatus(c.env, countersFor(c));
  const who = { owner: c.get("owner"), userId: c.get("userId"), fpHash: c.get("fpHash") };
  if (await isSuspicious(c.env, who)) return c.json({ ...status, remaining: 0 });
  return c.json(status);
}
