import { CAPABILITY_IDS, OPS } from "@vzc/catalog";
import type { Bindings } from "../types.ts";
import { deliver, raise, resolve, type Send } from "./alerts.ts";
import { attemptsBetween } from "./spend.ts";

const FAILED = new Set(["failed", "abandoned"]);
/** Only calls that have ended count; queued, submitting and pending ones would dilute the rate. */
const ENDED = new Set(["succeeded", ...FAILED]);

/** Spec 8.3: a capability whose calls failed more than the limit in the last 15 minutes. */
export async function checkFailures(
  env: Bindings,
  now: number,
  send: Send = deliver,
): Promise<void> {
  const from = now - OPS.failureWindowMs;
  // A call refused by the kie key's daily cap is not a model failing; the cap has its own alert.
  const rows = (await attemptsBetween(env, from)).filter(
    (r) => ENDED.has(r.state) && r.failKind !== "key_daily_cap",
  );
  for (const capability of CAPABILITY_IDS) {
    const mine = rows.filter((r) => r.capability === capability);
    const failed = mine.filter((r) => FAILED.has(r.state)).length;
    const key = `failures:${capability}`;
    const title = `${capability} is failing`;
    if (mine.length >= OPS.failureMinAttempts && failed / mine.length > OPS.failureRateMax)
      await raise(
        env,
        { key, title, detail: `${failed} of ${mine.length} calls failed in 15 minutes` },
        now,
        send,
      );
    else await resolve(env, key, title, now, send);
  }
}
