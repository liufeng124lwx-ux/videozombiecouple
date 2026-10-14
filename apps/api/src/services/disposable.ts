import type { Bindings } from "../types.ts";

/** A few of the most common throwaway domains, so the check works before ops fills KV. */
const SEED = new Set([
  "10minutemail.com",
  "dispostable.com",
  "getnada.com",
  "guerrillamail.com",
  "mailinator.com",
  "maildrop.cc",
  "sharklasers.com",
  "temp-mail.org",
  "trashmail.com",
  "yopmail.com",
]);

/** Spec 5.4: refuse throwaway domains for new accounts. Ops refreshes `disposable:domains` weekly. */
export async function isDisposable(env: Bindings, email: string): Promise<boolean> {
  const domain = email.split("@")[1] ?? "";
  if (SEED.has(domain)) return true;
  const raw = await env.KV.get("disposable:domains");
  if (!raw) return false;
  try {
    return (JSON.parse(raw) as string[]).includes(domain);
  } catch {
    return false;
  }
}
