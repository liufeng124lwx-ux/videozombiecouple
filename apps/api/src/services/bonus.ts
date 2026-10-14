import { ABUSE, BONUSES } from "@vzc/catalog";
import type { Context } from "hono";
import type { AppEnv } from "../types.ts";
import { limiter } from "./limits.ts";
import { isSuspicious } from "./suspicion.ts";

/**
 * Spec 5.4: 5 credits for a new verified account, at most once per device fingerprint and per IP
 * segment every 30 days, never for suspicious devices. Refusals are silent.
 */
export async function grantSignupBonus(c: Context<AppEnv>, userId: string): Promise<boolean> {
  const fpHash = c.get("fpHash");
  if (await isSuspicious(c.env, { owner: `u:${userId}`, userId, fpHash })) return false;
  // Claims are atomic in the RateLimiter DO; a KV read-then-write let concurrent sign-ups all pass.
  const names = [`bonus:ip:${c.get("ipSegmentHash")}`, ...(fpHash ? [`bonus:fp:${fpHash}`] : [])];
  const won: string[] = [];
  const giveBack = async () => {
    for (const name of won) await limiter(c.env, name).unclaim(userId);
  };
  for (const name of names) {
    if (!(await limiter(c.env, name).claim(userId, ABUSE.bonusOncePerMs))) {
      await giveBack();
      return false;
    }
    won.push(name);
  }
  const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(userId));
  try {
    await wallet.grant(userId, {
      kind: "bonus",
      credits: BONUSES.signup,
      expiresAt: null,
      sourceRef: "signup",
      reason: "signup",
    });
  } catch (error) {
    await giveBack();
    throw error;
  }
  return true;
}
