import { PLANS, type PlanId, productByKey } from "@vzc/catalog";
import { reportPurchase } from "../services/ga4.ts";
import { ulid } from "../services/ids.ts";
import type { Bindings } from "../types.ts";
import { nextMonthly } from "./dates.ts";
import type { BillingEvent } from "./events.ts";

type SubRow = {
  id: string;
  provider_sub_id: string;
  user_id: string | null;
  plan_key: PlanId;
  interval: "month" | "year";
  status: string;
  current_period_start: number;
  current_period_end: number;
  next_grant_at: number | null;
  last_event_at: number;
};

type OrderRow = {
  id: string;
  provider_order_id: string;
  user_id: string | null;
  product_key: string;
  amount: number | null;
  refunded_amount: number;
  status: string;
  clawed_credits: number;
  clawed_period: number | null;
  dispute_clawed: number;
  dispute_debt: number;
};

type Event<K extends BillingEvent["kind"]> = Extract<BillingEvent, { kind: K }>;

const walletOf = (env: Bindings, userId: string) => env.WALLET.get(env.WALLET.idFromName(userId));

/** Spec 6.2: business code sees only provider-neutral events; every credit change goes through the Wallet. */
export async function applyEvent(
  env: Bindings,
  provider: string,
  event: BillingEvent,
): Promise<void> {
  switch (event.kind) {
    case "ignored":
      return;
    case "order_paid":
      return orderPaid(env, provider, event);
    case "sub_started":
    case "sub_renewed":
      return subPeriod(env, provider, event);
    case "sub_plan_changed":
      return planChanged(env, provider, event);
    case "sub_status":
      return subStatus(env, provider, event);
    case "refund_succeeded":
      return refund(env, provider, event);
    case "dispute_opened":
      return disputeOpened(env, provider, event);
    case "dispute_closed":
      return disputeClosed(env, provider, event);
  }
}

async function loadSub(env: Bindings, provider: string, subId: string): Promise<SubRow | null> {
  return env.DB.prepare("SELECT * FROM subscriptions WHERE provider=? AND provider_sub_id=?")
    .bind(provider, subId)
    .first<SubRow>();
}

async function loadOrder(
  env: Bindings,
  provider: string,
  orderId: string,
): Promise<OrderRow | null> {
  return env.DB.prepare("SELECT * FROM orders WHERE provider=? AND provider_order_id=?")
    .bind(provider, orderId)
    .first<OrderRow>();
}

/** Spec 6.2: a later period is newer; within one period, a later event is. */
function isNewer(sub: SubRow | null, periodEnd: number, at: number): boolean {
  if (!sub) return true;
  if (periodEnd !== sub.current_period_end) return periodEnd > sub.current_period_end;
  return at >= sub.last_event_at;
}

async function recordOrder(
  env: Bindings,
  provider: string,
  order: {
    orderId: string;
    userId: string;
    productKey: string;
    amount: number | null;
    currency: string | null;
    at: number;
  },
): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO orders(id,provider,provider_order_id,user_id,product_key,amount,currency,status,created_at) VALUES(?,?,?,?,?,?,?,'paid',?)",
  )
    .bind(
      ulid(),
      provider,
      order.orderId,
      order.userId,
      order.productKey,
      order.amount,
      order.currency,
      order.at,
    )
    .run();
}

async function orderPaid(env: Bindings, provider: string, event: Event<"order_paid">) {
  const product = productByKey(event.productKey);
  if (product?.kind !== "pack")
    throw new Error(`order ${event.orderId}: ${event.productKey} is not a pack`);
  if (!event.userId) throw new Error(`order ${event.orderId}: no user`);
  await recordOrder(env, provider, { ...event, userId: event.userId });
  await walletOf(env, event.userId).grant(event.userId, {
    kind: "pack",
    credits: product.credits,
    expiresAt: null,
    sourceRef: `order:${event.orderId}`,
    orderId: event.orderId,
    reason: event.productKey,
  });
  await reportPurchase(env, {
    clientId: event.clientId,
    transactionId: event.orderId,
    value: event.amount,
    currency: event.currency,
    item: event.productKey,
  });
}

/** The next monthly grant of a yearly plan, if it falls inside the period. */
function nextGrant(start: number, after: number, end: number): number | null {
  const next = nextMonthly(start, after);
  return next < end ? next : null;
}

async function subPeriod(
  env: Bindings,
  provider: string,
  event: Event<"sub_started" | "sub_renewed">,
) {
  if (!event.userId) throw new Error(`subscription ${event.subId}: no user`);
  const sub = await loadSub(env, provider, event.subId);
  const next =
    event.interval === "year"
      ? nextGrant(event.periodStart, event.periodStart, event.periodEnd)
      : null;
  if (isNewer(sub, event.periodEnd, event.at)) {
    await env.DB.prepare(
      `INSERT INTO subscriptions(id,provider,provider_sub_id,user_id,plan_key,interval,status,current_period_start,current_period_end,next_grant_at,cancel_at,last_event_at,created_at)
       VALUES(?,?,?,?,?,?,'active',?,?,?,NULL,?,?)
       ON CONFLICT(provider, provider_sub_id) DO UPDATE SET
         user_id=excluded.user_id, plan_key=excluded.plan_key, interval=excluded.interval, status='active',
         current_period_start=excluded.current_period_start, current_period_end=excluded.current_period_end,
         next_grant_at=excluded.next_grant_at, cancel_at=NULL, last_event_at=excluded.last_event_at`,
    )
      .bind(
        ulid(),
        provider,
        event.subId,
        event.userId,
        event.plan,
        event.interval,
        event.periodStart,
        event.periodEnd,
        next,
        event.at,
        event.at,
      )
      .run();
  }
  if (event.kind === "sub_started") {
    await recordOrder(env, provider, {
      orderId: event.subId,
      userId: event.userId,
      productKey: event.productKey,
      amount: event.amount,
      currency: event.currency,
      at: event.at,
    });
    await reportPurchase(env, {
      clientId: event.clientId,
      transactionId: event.subId,
      value: event.amount,
      currency: event.currency,
      item: event.productKey,
    });
  }
  // An older period than the one on record must not grant: renewing would void newer credits.
  if (sub && event.periodEnd < sub.current_period_end) return;
  await walletOf(env, event.userId).renewSubscription(event.userId, {
    credits: PLANS[event.plan].monthlyCredits,
    expiresAt: event.interval === "year" ? (next ?? event.periodEnd) : event.periodEnd,
    sourceRef: `sub:${event.subId}:${event.periodStart}`,
    orderId: event.subId,
    reason: event.productKey,
  });
}

async function planChanged(env: Bindings, provider: string, event: Event<"sub_plan_changed">) {
  const sub = await loadSub(env, provider, event.subId);
  if (!sub) throw new Error(`subscription ${event.subId} is not known yet`);
  const before = PLANS[sub.plan_key].monthlyCredits;
  const after = PLANS[event.plan].monthlyCredits;
  await env.DB.prepare(
    "UPDATE subscriptions SET plan_key=?, interval=?, last_event_at=MAX(last_event_at, ?) WHERE id=?",
  )
    .bind(event.plan, event.interval, event.at, sub.id)
    .run();
  // Spec 6.5: an upgrade applies now — top up the difference until the current credits expire.
  // A downgrade applies from the next period, when the renewal grants the new plan.
  if (after > before && sub.user_id && sub.status !== "canceled") {
    await walletOf(env, sub.user_id).grant(sub.user_id, {
      kind: "subscription",
      credits: after - before,
      expiresAt:
        sub.interval === "year"
          ? (sub.next_grant_at ?? sub.current_period_end)
          : sub.current_period_end,
      sourceRef: `sub:${event.subId}:upgrade:${sub.current_period_start}:${event.plan}`,
      orderId: event.subId,
      reason: `upgrade_to_${event.productKey}`,
    });
  }
}

async function subStatus(env: Bindings, provider: string, event: Event<"sub_status">) {
  const sub = await loadSub(env, provider, event.subId);
  if (!sub) throw new Error(`subscription ${event.subId} is not known yet`);
  if (!isNewer(sub, event.periodEnd, event.at)) return;
  // A status event may be the first news of a new period (its renewal not here yet): a yearly
  // plan then needs its monthly grants scheduled from the new start.
  let next = sub.next_grant_at;
  if (event.status === "canceled") next = null;
  else if (event.periodEnd > sub.current_period_end)
    next =
      sub.interval === "year"
        ? nextGrant(event.periodStart, event.periodStart, event.periodEnd)
        : null;
  // Credits are not taken here: subscription credits simply expire at the period end (spec 6.5).
  await env.DB.prepare(
    "UPDATE subscriptions SET status=?, current_period_start=?, current_period_end=?, cancel_at=?, next_grant_at=?, last_event_at=? WHERE id=?",
  )
    .bind(
      event.status,
      event.periodStart,
      event.periodEnd,
      event.status === "canceling" ? event.periodEnd : null,
      next,
      event.at,
      sub.id,
    )
    .run();
}

/** Credits the order granted that a full refund takes back, and where they live. */
/** Credits the order granted that a full refund takes back, where they live, and which period. */
async function grantedBy(
  env: Bindings,
  provider: string,
  order: OrderRow,
): Promise<{ credits: number; prefix: string; period: number | null }> {
  const product = productByKey(order.product_key);
  if (product?.kind === "pack")
    return { credits: product.credits, prefix: `order:${order.provider_order_id}`, period: null };
  // A subscription refund concerns the current period: its plan's monthly credits.
  const sub = await loadSub(env, provider, order.provider_order_id);
  const plan = sub?.plan_key ?? (product?.kind === "plan" ? product.plan : null);
  return {
    credits: plan ? PLANS[plan].monthlyCredits : 0,
    prefix: `sub:${order.provider_order_id}:`,
    period: sub?.current_period_start ?? null,
  };
}

/**
 * Takes back `ratio` of what the order granted, but never more than it has not yet given back:
 * a repeated refund, or a chargeback after a refund, must not reach the user's other credits.
 */
async function takeBack(
  env: Bindings,
  provider: string,
  order: OrderRow,
  ratio: number,
  reason: string,
): Promise<{ taken: number; clawed: number; debt: number }> {
  const granted = await grantedBy(env, provider, order);
  const accounted = order.clawed_period === granted.period ? order.clawed_credits : 0;
  const taken = Math.max(
    0,
    Math.min(Math.round(granted.credits * ratio), granted.credits - accounted),
  );
  if (!order.user_id || taken === 0) return { taken: 0, clawed: 0, debt: 0 };
  const result = await walletOf(env, order.user_id).clawback(order.user_id, {
    credits: taken,
    sourcePrefix: granted.prefix,
    orderId: order.provider_order_id,
    reason,
  });
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET clawed_credits=?, clawed_period=? WHERE id=?").bind(
      accounted + taken,
      granted.period,
      order.id,
    ),
    env.DB.prepare("UPDATE users SET refund_debt = refund_debt + ? WHERE id=?").bind(
      result.debt,
      order.user_id,
    ),
  ]);
  return { taken, ...result };
}

async function refund(env: Bindings, provider: string, event: Event<"refund_succeeded">) {
  const order = await loadOrder(env, provider, event.orderId);
  if (!order) throw new Error(`refund for unknown order ${event.orderId}`);
  // Spec 6.6: a partial refund takes back the same share. The refunded amount against what we
  // recorded for the order decides the share; the payload's own "full" is only a fallback.
  const ratio =
    event.amount !== null && order.amount
      ? Math.min(1, event.amount / order.amount)
      : event.full
        ? 1
        : 0;
  await takeBack(env, provider, order, ratio, "refund");
  const refunded = order.refunded_amount + (event.amount ?? order.amount ?? 0);
  const full = order.amount !== null ? refunded >= order.amount - 0.005 : event.full;
  await env.DB.prepare("UPDATE orders SET status=?, refunded_amount=? WHERE id=?")
    .bind(full ? "refunded" : "partially_refunded", Math.round(refunded * 100) / 100, order.id)
    .run();
  if (full) await stopSubscription(env, provider, order);
}

/**
 * A subscription whose payment was fully refunded or charged back grants nothing more, even if the
 * provider does not also send a cancellation.
 */
async function stopSubscription(env: Bindings, provider: string, order: OrderRow): Promise<void> {
  if (productByKey(order.product_key)?.kind !== "plan") return;
  await env.DB.prepare(
    "UPDATE subscriptions SET status='canceled', next_grant_at=NULL WHERE provider=? AND provider_sub_id=?",
  )
    .bind(provider, order.provider_order_id)
    .run();
}

/** Spec 6.6: a chargeback takes back the whole order and pauses paid features until it ends. */
async function disputeOpened(env: Bindings, provider: string, event: Event<"dispute_opened">) {
  const order = await loadOrder(env, provider, event.orderId);
  if (!order) throw new Error(`dispute for unknown order ${event.orderId}`);
  if (order.status === "disputed") return;
  const { clawed, debt } = await takeBack(env, provider, order, 1, "dispute");
  await env.DB.prepare(
    "UPDATE orders SET status='disputed', dispute_clawed=?, dispute_debt=? WHERE id=?",
  )
    .bind(clawed, debt, order.id)
    .run();
  await stopSubscription(env, provider, order);
  if (order.user_id)
    await env.DB.prepare("UPDATE users SET paid_paused_at=COALESCE(paid_paused_at, ?) WHERE id=?")
      .bind(event.at, order.user_id)
      .run();
}

async function disputeClosed(env: Bindings, provider: string, event: Event<"dispute_closed">) {
  const order = await loadOrder(env, provider, event.orderId);
  if (!order) throw new Error(`dispute for unknown order ${event.orderId}`);
  if (order.status !== "disputed") return; // already closed, or never opened
  await env.DB.prepare(
    "UPDATE orders SET status=?, clawed_credits=?, dispute_clawed=0, dispute_debt=0 WHERE id=?",
  )
    .bind(
      event.won ? "paid" : "refunded",
      // Won: the chargeback's take no longer counts against the order.
      event.won
        ? Math.max(0, order.clawed_credits - order.dispute_clawed - order.dispute_debt)
        : order.clawed_credits,
      order.id,
    )
    .run();
  if (!order.user_id) return;
  await env.DB.prepare("UPDATE users SET paid_paused_at=NULL WHERE id=?").bind(order.user_id).run();
  if (!event.won) return;
  // Won: give back exactly what the chargeback took, and drop the debt it left.
  await env.DB.prepare("UPDATE users SET refund_debt = MAX(0, refund_debt - ?) WHERE id=?")
    .bind(order.dispute_debt, order.user_id)
    .run();
  if (order.dispute_clawed > 0)
    await walletOf(env, order.user_id).grant(order.user_id, {
      kind: "admin",
      credits: order.dispute_clawed,
      expiresAt: null,
      sourceRef: `dispute-won:${order.provider_order_id}:${event.at}`,
      orderId: order.provider_order_id,
      reason: "dispute_won",
    });
}
