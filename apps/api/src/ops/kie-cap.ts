import { KIE_KEY_RESET_UTC_HOUR } from "@vzc/catalog";
import type { Bindings } from "../types.ts";
import { deliver, raise, resolve, type Send } from "./alerts.ts";
import { startOfUtcDay } from "./spend.ts";

const HOUR = 3_600_000;
/** When kie resets the key, as the admin page and the alert say it. */
export const KIE_RESET_LABEL = `${String(KIE_KEY_RESET_UTC_HOUR).padStart(2, "0")}:00 UTC`;

/** The latest moment at or before `t` when kie reset the key's daily limit. */
function lastReset(t: number, hour: number): number {
  const today = startOfUtcDay(t) + hour * HOUR;
  return today <= t ? today : today - 24 * HOUR;
}

const KEY = "kie-cap";
const TITLE = "kie key's daily limit is used up: processing is paused";

async function raw(env: Bindings): Promise<Record<string, unknown>> {
  try {
    return JSON.parse((await env.KV.get("flags")) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Cost guardrails spec 6: kie refuses every call until it resets the key, so stop taking jobs. */
export async function pauseForKieCap(
  env: Bindings,
  now: number,
  send: Send = deliver,
): Promise<void> {
  const flags = await raw(env);
  // Any pause already in place (an admin's, including one saved before pausedBy existed) stays
  // as it is, so the lift can never undo it.
  if (flags.paused !== true)
    await env.KV.put(
      "flags",
      JSON.stringify({ ...flags, paused: true, pausedBy: "kie-cap", pausedAt: now }),
    );
  await raise(
    env,
    {
      key: KEY,
      title: TITLE,
      detail: `Raise the key's daily limit on kie.ai or wait for ${KIE_RESET_LABEL}`,
    },
    now,
    send,
  );
}

/** Lifts only the pause pauseForKieCap made, once kie has reset the key since the pause. */
export async function liftKieCap(
  env: Bindings,
  now: number,
  send: Send = deliver,
  resetHour: number = KIE_KEY_RESET_UTC_HOUR,
): Promise<void> {
  const flags = await raw(env);
  if (flags.pausedBy !== "kie-cap") return;
  const at = typeof flags.pausedAt === "number" ? flags.pausedAt : 0;
  if (lastReset(now, resetHour) <= at) return;
  await env.KV.put(
    "flags",
    JSON.stringify({ ...flags, paused: false, pausedBy: null, pausedAt: null }),
  );
  await resolve(env, KEY, TITLE, now, send);
}
