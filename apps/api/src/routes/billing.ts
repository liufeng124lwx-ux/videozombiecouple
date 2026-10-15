import { PLANS, type PlanId, productByKey } from "@vzc/catalog";
import { type BillingView, ChangePlanSchema, CheckoutSchema } from "@vzc/contracts";
import type { Context } from "hono";
import { createStripeCheckout, StripeError, stripeConfig } from "../billing/stripe.ts";
import {
  cancelSubscription,
  createCheckout,
  createPlanChange,
  reactivateSubscription,
  WaffoError,
  waffoConfig,
} from "../billing/waffo.ts";
import { fail } from "../http.ts";
import { ulid } from "../services/ids.ts";
import { hitRate } from "../services/limits.ts";
import { safeNext } from "../services/login.ts";
import type { AppEnv } from "../types.ts";

type SubRow = {
  provider_sub_id: string;
  plan_key: PlanId;
  interval: "month" | "year";
  status: "active" | "canceling" | "past_due" | "canceled";
  current_period_end: number;
  cancel_at: number | null;
};

const CHECKOUTS_PER_HOUR = 20;
const body = (c: Context<AppEnv>) => c.req.json().catch(() => null);

export async function liveSubscription(db: D1Database, userId: string): Promise<SubRow | null> {
  return db
    .prepare(
      "SELECT provider_sub_id, plan_key, interval, status, current_period_end, cancel_at FROM subscriptions WHERE user_id=? AND status IN ('active','canceling','past_due') ORDER BY current_period_end DESC LIMIT 1",
    )
    .bind(userId)
    .first<SubRow>();
}

/** Waffo trouble is a 503 for the page, with the details in the log. */
async function viaWaffo(c: Context<AppEnv>, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof WaffoError)) throw error;
    console.error(
      JSON.stringify({ level: "error", requestId: c.get("requestId"), waffo: error.message }),
    );
    return fail(c, "PAYMENTS_UNAVAILABLE");
  }
}

/** Spec 6.4: signed-in only; Waffo returns the buyer to the page they came from. */
export async function checkout(c: Context<AppEnv>) {
  const userId = c.get("userId");
  if (!userId) return fail(c, "UNAUTHORIZED");
  const parsed = CheckoutSchema.safeParse(await body(c));
  if (!parsed.success) return fail(c, "BAD_REQUEST");
  const product = productByKey(parsed.data.productKey);
  if (!product) return fail(c, "BAD_REQUEST");
  // Stripe (Managed Payments) when it is configured; Waffo stays as the fallback provider.
  const stripe = stripeConfig(c.env);
  const config = stripe ? null : waffoConfig(c.env);
  if (stripe ? !stripe.prices[product.key] : !config?.products[product.key])
    return fail(c, "PAYMENTS_UNAVAILABLE");
  const rate = await hitRate(c.env, `rate:checkout:${userId}`, CHECKOUTS_PER_HOUR, 3_600_000);
  if (!rate.allowed) return fail(c, "RATE_LIMITED", rate.retryAfterSec);
  const user = await c.env.DB.prepare("SELECT email, paid_paused_at FROM users WHERE id=?")
    .bind(userId)
    .first<{ email: string; paid_paused_at: number | null }>();
  if (!user) return fail(c, "UNAUTHORIZED");
  if (user.paid_paused_at) return fail(c, "FORBIDDEN");
  // One subscription per account: switching plans is a plan change (spec 6.5).
  if (product.kind === "plan" && (await liveSubscription(c.env.DB, userId)))
    return fail(c, "SUBSCRIPTION_ACTIVE");
  const back = safeNext(parsed.data.returnPath);
  const metadata: Record<string, string> = { userId, productKey: product.key };
  if (parsed.data.clientId) metadata.clientId = parsed.data.clientId;
  const successUrl = `${c.env.ALLOWED_ORIGIN}${back}${back.includes("?") ? "&" : "?"}paid=1`;
  if (stripe) {
    if (product.kind !== "pack") return fail(c, "BAD_REQUEST");
    try {
      const url = await createStripeCheckout(stripe, {
        productKey: product.key,
        userId,
        email: user.email,
        successUrl,
        cancelUrl: `${c.env.ALLOWED_ORIGIN}${back}`,
        metadata,
        idempotencyKey: `vzc-${ulid()}`,
      });
      c.header("cache-control", "no-store");
      return c.json({ url });
    } catch (error) {
      if (!(error instanceof StripeError)) throw error;
      console.error(
        JSON.stringify({ level: "error", requestId: c.get("requestId"), stripe: error.message }),
      );
      return fail(c, "PAYMENTS_UNAVAILABLE");
    }
  }
  if (!config) return fail(c, "PAYMENTS_UNAVAILABLE");
  return viaWaffo(c, async () => {
    const url = await createCheckout(config, {
      productKey: product.key,
      userId,
      email: user.email,
      successUrl,
      metadata,
      externalId: `upx-${ulid()}`,
    });
    c.header("cache-control", "no-store");
    return c.json({ url });
  });
}

export async function billing(c: Context<AppEnv>) {
  const userId = c.get("userId");
  if (!userId) return fail(c, "UNAUTHORIZED");
  const user = await c.env.DB.prepare("SELECT paid_paused_at, refund_debt FROM users WHERE id=?")
    .bind(userId)
    .first<{ paid_paused_at: number | null; refund_debt: number }>();
  const sub = await c.env.DB.prepare(
    "SELECT provider_sub_id, plan_key, interval, status, current_period_end, cancel_at FROM subscriptions WHERE user_id=? ORDER BY current_period_end DESC LIMIT 1",
  )
    .bind(userId)
    .first<SubRow>();
  const view: BillingView = {
    subscription: sub
      ? {
          plan: sub.plan_key,
          interval: sub.interval,
          status: sub.status,
          periodEnd: sub.current_period_end,
          cancelAt: sub.cancel_at,
        }
      : null,
    paidPaused: Boolean(user?.paid_paused_at),
    refundDebt: user?.refund_debt ?? 0,
  };
  c.header("cache-control", "no-store");
  return c.json(view);
}

/** Spec 6.5: more monthly credits takes effect now (Waffo prorates); anything else next period. */
export async function changePlan(c: Context<AppEnv>) {
  const userId = c.get("userId");
  if (!userId) return fail(c, "UNAUTHORIZED");
  const parsed = ChangePlanSchema.safeParse(await body(c));
  const product = parsed.success ? productByKey(parsed.data.productKey) : null;
  if (product?.kind !== "plan") return fail(c, "BAD_REQUEST");
  const config = waffoConfig(c.env);
  if (!config || !config.products[product.key]) return fail(c, "PAYMENTS_UNAVAILABLE");
  const sub = await liveSubscription(c.env.DB, userId);
  if (!sub || sub.status !== "active") return fail(c, "NOT_FOUND");
  if (product.plan === sub.plan_key && product.interval === sub.interval)
    return fail(c, "BAD_REQUEST");
  const upgrade = PLANS[product.plan].monthlyCredits > PLANS[sub.plan_key].monthlyCredits;
  return viaWaffo(c, async () =>
    c.json({
      url: await createPlanChange(config, {
        originOrderId: sub.provider_sub_id,
        productKey: product.key,
        userId,
        timing: upgrade ? "immediate" : "next_period",
      }),
    }),
  );
}

async function selfService(
  c: Context<AppEnv>,
  needs: SubRow["status"],
  action: typeof cancelSubscription,
) {
  const userId = c.get("userId");
  if (!userId) return fail(c, "UNAUTHORIZED");
  const config = waffoConfig(c.env);
  if (!config) return fail(c, "PAYMENTS_UNAVAILABLE");
  const sub = await liveSubscription(c.env.DB, userId);
  if (!sub || sub.status !== needs) return fail(c, "NOT_FOUND");
  return viaWaffo(c, async () =>
    c.json({ status: await action(config, { orderId: sub.provider_sub_id, userId }) }),
  );
}

/** Spec 6.5: credits and Pro stay until the period ends; the webhook records the new state. */
export const cancelPlan = (c: Context<AppEnv>) => selfService(c, "active", cancelSubscription);
export const resumePlan = (c: Context<AppEnv>) =>
  selfService(c, "canceling", reactivateSubscription);
