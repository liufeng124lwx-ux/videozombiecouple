import { PLANS, type PlanId } from "@vzc/catalog";
import type { Bindings } from "../types.ts";
import { nextMonthly } from "./dates.ts";

type Due = {
  id: string;
  provider_sub_id: string;
  user_id: string;
  plan_key: PlanId;
  current_period_start: number;
  current_period_end: number;
  next_grant_at: number;
};

/**
 * Spec 6.5: yearly plans get their credits month by month; last month's leftovers are voided.
 * Plan 7's cron calls this hourly. Canceling subscriptions keep their months until the period
 * ends; past-due ones get none.
 */
export async function grantDueMonthly(env: Bindings, now = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id, provider_sub_id, user_id, plan_key, current_period_start, current_period_end, next_grant_at FROM subscriptions WHERE interval='year' AND status IN ('active','canceling') AND user_id IS NOT NULL AND next_grant_at IS NOT NULL AND next_grant_at<=?",
  )
    .bind(now)
    .all<Due>();
  let granted = 0;
  for (const sub of results) {
    const anchor = sub.current_period_start;
    // After an outage, grant only the month that has started; the missed ones have expired.
    let month = sub.next_grant_at;
    for (
      let next = nextMonthly(anchor, month);
      next <= now && next < sub.current_period_end;
      next = nextMonthly(anchor, month)
    )
      month = next;
    const end = nextMonthly(anchor, month);
    const wallet = env.WALLET.get(env.WALLET.idFromName(sub.user_id));
    await wallet.renewSubscription(sub.user_id, {
      credits: PLANS[sub.plan_key].monthlyCredits,
      expiresAt: Math.min(end, sub.current_period_end),
      sourceRef: `sub:${sub.provider_sub_id}:${month}`,
      orderId: sub.provider_sub_id,
      reason: `${sub.plan_key}_year_monthly`,
    });
    await env.DB.prepare("UPDATE subscriptions SET next_grant_at=? WHERE id=?")
      .bind(end < sub.current_period_end ? end : null, sub.id)
      .run();
    granted += 1;
  }
  return granted;
}
