import type { Bindings } from "../types.ts";
import { raise, resolve } from "./alerts.ts";

const COUNTER = "waffo:badsig";
const KEY = "webhook:badsig";
const TITLE = "Waffo webhook: bad signatures in a row";
const THRESHOLD = 3;

/** Spec 8.3: three failed verifications in a row (within an hour) raise an alert. */
export async function countBadSignature(env: Bindings, now: number): Promise<void> {
  try {
    const count = Number((await env.KV.get(COUNTER)) ?? "0") + 1;
    await env.KV.put(COUNTER, String(count), { expirationTtl: 3600 });
    if (count >= THRESHOLD)
      await raise(
        env,
        {
          key: KEY,
          title: TITLE,
          detail: `${count} deliveries failed verification. A rotated key, the wrong mode, or someone probing /webhooks/waffo.`,
        },
        now,
      );
  } catch {}
}

/** A good signature ends the run. */
export async function clearBadSignatures(env: Bindings, now: number): Promise<void> {
  try {
    if ((await env.KV.get(COUNTER)) === null) return;
    await env.KV.delete(COUNTER);
    await resolve(env, KEY, TITLE, now);
  } catch {}
}
