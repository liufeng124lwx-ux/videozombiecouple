import { LOCAL_TURNSTILE_TOKEN } from "../local.ts";

/** Cloudflare Turnstile siteverify (copied from Vidova; one action per protected flow). */
export async function verifyTurnstile(
  token: string,
  remoteIp: string,
  secret: string,
  hostname: string,
  action: string,
  /** Plan 7C local mode: the fixed token passes without a network call. */
  local = false,
): Promise<{ valid: boolean }> {
  if (local) return { valid: token === LOCAL_TURNSTILE_TOKEN };
  if (!secret || token.length > 2048) return { valid: false };
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { valid: false };
    const result = (await response.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    return {
      valid: result.success === true && result.hostname === hostname && result.action === action,
    };
  } catch {
    return { valid: false };
  }
}
