import type { Context } from "hono";
import { isLocal } from "../local.ts";
import type { AppEnv } from "../types.ts";
import { safeEqual } from "./crypto.ts";
import { verifyTurnstile } from "./turnstile.ts";

/**
 * Spec 7.1: after one passed Turnstile check the same browser on the same IP segment may upload
 * and create jobs for 30 minutes without another check. Rate limits and quotas still apply.
 */
export const HUMAN_PASS_TTL_SEC = 30 * 60;
export const HUMAN_PASS_USES = 30;

type Pass = { ipp: string; left: number; expiresAt: number };

const key = (c: Context<AppEnv>) => `human:${c.get("visitorHash")}`;

export async function grantHumanPass(c: Context<AppEnv>): Promise<void> {
  const pass: Pass = {
    ipp: c.get("ipSegmentHash"),
    left: HUMAN_PASS_USES,
    expiresAt: Date.now() + HUMAN_PASS_TTL_SEC * 1000,
  };
  await c.env.KV.put(key(c), JSON.stringify(pass), { expirationTtl: HUMAN_PASS_TTL_SEC });
}

/** Uses one request from the pass; false when there is no usable pass. */
export async function useHumanPass(c: Context<AppEnv>): Promise<boolean> {
  const raw = await c.env.KV.get(key(c));
  if (!raw) return false;
  let pass: Pass;
  try {
    pass = JSON.parse(raw) as Pass;
  } catch {
    return false;
  }
  if (pass.ipp !== c.get("ipSegmentHash") || !(pass.left > 0) || Date.now() >= pass.expiresAt) {
    await c.env.KV.delete(key(c));
    return false;
  }
  pass.left -= 1;
  const ttl = Math.max(60, Math.ceil((pass.expiresAt - Date.now()) / 1000));
  if (pass.left > 0) await c.env.KV.put(key(c), JSON.stringify(pass), { expirationTtl: ttl });
  else await c.env.KV.delete(key(c));
  return true;
}

/**
 * Spec 11.1: the post-deploy smoke script runs one real job on staging. It sends SMOKE_KEY (a
 * staging-only secret of 32+ characters) instead of a Turnstile token; production ignores it.
 */
function smokeKeyMatches(c: Context<AppEnv>): boolean {
  const key = c.env.SMOKE_KEY ?? "";
  const sent = c.req.header("x-smoke-key") ?? "";
  // An allow-list: staging and local runs only, whatever else a config might say.
  const allowed =
    isLocal(c.env) || c.env.API_ORIGIN === "https://api-staging.videozombiecouple.com";
  if (key.length < 32 || !allowed) return false;
  return safeEqual(sent, key);
}

/** A fresh `x-turnstile` token grants a pass; otherwise an existing pass must cover the request. */
export async function requireHuman(
  c: Context<AppEnv>,
  action: "job" | "login" = "job",
): Promise<boolean> {
  if (smokeKeyMatches(c)) {
    await grantHumanPass(c);
    return useHumanPass(c);
  }
  const token = c.req.header("x-turnstile");
  if (token) {
    const result = await verifyTurnstile(
      token,
      c.req.header("CF-Connecting-IP") ?? "",
      c.env.TURNSTILE_SECRET,
      c.env.TURNSTILE_HOSTNAME,
      action,
      isLocal(c.env),
    );
    if (!result.valid) return false;
    await grantHumanPass(c);
  }
  return useHumanPass(c);
}
