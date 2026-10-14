import { BUDGETS } from "@vzc/catalog";
import type { Bindings } from "../types.ts";
import { deliver, raise, resolve, type Send } from "./alerts.ts";
import { spendBetween, startOfUtcDay } from "./spend.ts";

const KEY = "free-tier";
const TITLE = "Free tier paused: today's free spend hit the cap";

/** The flags as stored (readFlags caches for a minute; ops wants what is there now). */
async function rawFlags(env: Bindings): Promise<Record<string, unknown>> {
  try {
    return JSON.parse((await env.KV.get("flags")) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeFlags(env: Bindings, patch: Record<string, unknown>): Promise<void> {
  await env.KV.put("flags", JSON.stringify({ ...(await rawFlags(env)), ...patch }));
}

/** Spec 4.2: free jobs pause when today's free spend reaches the cap; paid jobs never do. */
export async function checkFreeTier(
  env: Bindings,
  now: number,
  send: Send = deliver,
): Promise<void> {
  const today = startOfUtcDay(now);
  const spend = await spendBetween(env, today, undefined, "free");
  const flags = await rawFlags(env);
  if (spend >= BUDGETS.free.dailyUsd) {
    if (flags.freePaused !== true) await writeFlags(env, { freePaused: true, freePausedBy: "ops" });
    await raise(
      env,
      { key: KEY, title: TITLE, detail: `$${spend.toFixed(2)} of $${BUDGETS.free.dailyUsd} today` },
      now,
      send,
    );
    return;
  }
  // Only a pause ops made is lifted here; the admin's own pause stays until the admin lifts it.
  if (flags.freePaused === true && flags.freePausedBy === "ops") {
    await writeFlags(env, { freePaused: false, freePausedBy: null });
    await resolve(env, KEY, TITLE, now, send);
  }
}
