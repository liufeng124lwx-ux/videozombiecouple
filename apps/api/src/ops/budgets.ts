import { BUDGETS, KIE_KEY_DAILY_CAP_USD, OPS } from "@vzc/catalog";
import { parsePaidLimit } from "../middleware/flags.ts";
import type { Bindings } from "../types.ts";
import { deliver, raise, resolve, type Send } from "./alerts.ts";
import { spendBetween, startOfUtcDay } from "./spend.ts";

const DAY = 86_400_000;
const WARN_PERCENT = Math.round(BUDGETS.warnShare * 100);
const PAUSE = "paid-budget";
const PAUSE_TITLE = "Paid jobs paused: today's paid spend hit the daily line";
const WARN = "paid-budget-warn";
const WARN_TITLE = `Paid spend is past ${WARN_PERCENT}% of today's line`;
const CAP = "kie-cap-low";
const CAP_TITLE = "Budget lines add up to more than the kie key's daily limit";

async function raw(env: Bindings): Promise<Record<string, unknown>> {
  try {
    return JSON.parse((await env.KV.get("flags")) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Today's paid line: an admin's limit for today, else max(7-day paid average × factor, floor). */
export async function paidLine(
  env: Bindings,
  now: number,
  flags: Record<string, unknown>,
): Promise<number> {
  const today = startOfUtcDay(now);
  const limit = parsePaidLimit(flags.paidLimit);
  if (limit && limit.day === today) return limit.usd;
  const average =
    (await spendBetween(env, today - OPS.costLookbackDays * DAY, today, "paid")) /
    OPS.costLookbackDays;
  return Math.max(average * BUDGETS.paid.avgFactor, BUDGETS.paid.floorUsd);
}

/** Cost guardrails spec 3: pause new paid jobs at the line; only an admin resumes them. */
export async function checkPaidBudget(
  env: Bindings,
  now: number,
  send: Send = deliver,
): Promise<void> {
  const flags = await raw(env);
  const line = await paidLine(env, now, flags);
  const spend = await spendBetween(env, startOfUtcDay(now), undefined, "paid");
  const detail = `$${spend.toFixed(2)} of $${line.toFixed(2)} today`;
  if (spend >= line) {
    if (flags.paidPaused !== true)
      await env.KV.put(
        "flags",
        JSON.stringify({ ...flags, paidPaused: true, paidPausedBy: "ops", paidPausedAt: now }),
      );
    await raise(env, { key: PAUSE, title: PAUSE_TITLE, detail }, now, send);
    await resolve(env, WARN, WARN_TITLE, now, send);
  } else {
    // Under the line again: an admin resumed (often with a new limit), so the pause is over.
    if (flags.paidPaused !== true) await resolve(env, PAUSE, PAUSE_TITLE, now, send);
    if (spend >= line * BUDGETS.warnShare)
      await raise(env, { key: WARN, title: WARN_TITLE, detail }, now, send);
    else await resolve(env, WARN, WARN_TITLE, now, send);
  }
  const lines = BUDGETS.free.dailyUsd + line + (BUDGETS.chat.live ? BUDGETS.chat.dailyUsd : 0);
  if (lines > KIE_KEY_DAILY_CAP_USD)
    await raise(
      env,
      {
        key: CAP,
        title: CAP_TITLE,
        detail: `$${lines.toFixed(2)} of lines vs a $${KIE_KEY_DAILY_CAP_USD} key cap`,
      },
      now,
      send,
    );
  else await resolve(env, CAP, CAP_TITLE, now, send);
}
