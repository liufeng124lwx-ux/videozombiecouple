import { OPS } from "@vzc/catalog";
import { kieBalance } from "@vzc/providers";
import type { Bindings } from "../types.ts";
import { deliver, raise, resolve, type Send } from "./alerts.ts";
import { spendBetween, startOfUtcDay } from "./spend.ts";

const DAY = 86_400_000;

/** The average daily spend of the last `days` full days. */
export async function dailyAverage(
  env: Bindings,
  now: number,
  days: number = OPS.costLookbackDays,
): Promise<number> {
  const today = startOfUtcDay(now);
  return (await spendBetween(env, today - days * DAY, today)) / days;
}

/** Spec 8.3: today's total spend over twice the 7-day daily average, once it is at least $5. */
export async function checkCostSpike(
  env: Bindings,
  now: number,
  send: Send = deliver,
): Promise<void> {
  const today = await spendBetween(env, startOfUtcDay(now));
  const average = await dailyAverage(env, now);
  const title = "Spend is running high today";
  if (average > 0 && today >= OPS.costSpikeMinUsd && today > average * OPS.costSpikeFactor)
    await raise(
      env,
      {
        key: "cost-spike",
        title,
        detail: `$${today.toFixed(2)} today vs $${average.toFixed(2)} a day`,
      },
      now,
      send,
    );
  else await resolve(env, "cost-spike", title, now, send);
}

/**
 * Spec 8.2: kie balance under five days of the 7-day average spend. Skipped with the fake provider.
 * Cost guardrails spec 5: once a day the balance is checked against the spend recorded since the
 * last snapshot; a drop the recorded spend does not explain raises `kie-reconcile` (top-ups are
 * ignored), and that alert resolves once the balance stops dropping unexplained. The balance is
 * shared with staging and eval, so the comparison runs only in production.
 */
export async function checkBalance(
  env: Bindings,
  now: number,
  send: Send = deliver,
  balance: () => Promise<number> = () => kieBalance(env.KIE_API_KEY),
): Promise<void> {
  if (env.FAKE_PROVIDER === "1") return;
  const usd = await balance();
  const RECONCILE = "kie-reconcile";
  const RECONCILE_TITLE = "kie balance dropped more than the spend we recorded";
  let last: { usd: number; at: number } | null = null;
  try {
    last = JSON.parse((await env.KV.get("kie:balance:last")) ?? "null") as {
      usd: number;
      at: number;
    } | null;
  } catch {
    last = null;
  }
  // The balance is account-wide: staging and eval spend it too, and only production's spend is
  // recorded here, so the comparison only makes sense (and only runs) in production.
  const production = env.ENVIRONMENT === "production";
  if (production && last && typeof last.usd === "number" && typeof last.at === "number") {
    const drop = last.usd - usd;
    const recorded = drop > 0 ? await spendBetween(env, last.at, now) : 0;
    if (
      drop > 0 &&
      Math.abs(drop - recorded) > Math.max(drop * OPS.reconcileShare, OPS.reconcileMinUsd)
    )
      await raise(
        env,
        {
          key: RECONCILE,
          title: RECONCILE_TITLE,
          detail: `balance fell $${drop.toFixed(2)}, recorded $${recorded.toFixed(2)} (ignore if you topped up; staging and eval spend share this balance)`,
        },
        now,
        send,
      );
    else await resolve(env, RECONCILE, RECONCILE_TITLE, now, send);
  }
  // The snapshot is replaced even on a rise. Known limit: a missed cost hidden by a same-day
  // top-up is not reconciled, because the daily snapshot only sees the net balance.
  await env.KV.put("kie:balance:last", JSON.stringify({ usd, at: now }));
  const need = (await dailyAverage(env, now)) * OPS.balanceDays;
  const title = "kie balance is running low";
  if (usd < need)
    await raise(
      env,
      {
        key: "kie-balance",
        title,
        detail: `$${usd.toFixed(2)} left, ${OPS.balanceDays} days need $${need.toFixed(2)}`,
      },
      now,
      send,
    );
  else await resolve(env, "kie-balance", title, now, send);
}
