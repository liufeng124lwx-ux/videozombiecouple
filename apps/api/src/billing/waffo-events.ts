import { type Product, productByKey } from "@vzc/catalog";
import { parseDate } from "./dates.ts";
import type { BillingEvent } from "./events.ts";
import type { WaffoWebhookEvent } from "./waffo.ts";

const text = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;

const money = (value: unknown): number | null => {
  const amount = typeof value === "string" ? Number(value) : value;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : null;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/**
 * Product metadata (`productKey`, set on every Waffo product) wins: order metadata still names the
 * product of the first checkout after a plan change.
 */
function productOf(data: Record<string, unknown>): Product {
  const key =
    text(record(data.productMetadata).productKey) ?? text(record(data.orderMetadata).productKey);
  const product = key ? productByKey(key) : null;
  if (!product) throw new Error(`unknown product ${String(key)}`);
  return product;
}

function planOf(data: Record<string, unknown>): Extract<Product, { kind: "plan" }> {
  const product = productOf(data);
  if (product.kind !== "plan") throw new Error(`${product.key} is not a plan`);
  return product;
}

function period(data: Record<string, unknown>): { periodStart: number; periodEnd: number } {
  const periodStart = parseDate(data.currentPeriodStart);
  const periodEnd = parseDate(data.currentPeriodEnd);
  if (periodStart === null || periodEnd === null || periodEnd <= periodStart)
    throw new Error("subscription event without a valid period");
  return { periodStart, periodEnd };
}

const STATUS: Record<string, "active" | "canceling" | "past_due" | "canceled"> = {
  "subscription.uncanceled": "active",
  "subscription.canceling": "canceling",
  "subscription.past_due": "past_due",
  "subscription.canceled": "canceled",
};

/** Waffo event types and fields follow @waffo/pancake-ts 0.25.0. */
export function fromWaffo(event: WaffoWebhookEvent): BillingEvent {
  const data = event.data;
  const at = parseDate(event.timestamp) ?? Date.now();
  const orderId = text(data.orderId);
  if (!orderId) throw new Error(`${event.eventType} without an order id`);
  const metadata = record(data.orderMetadata);
  const userId = text(data.merchantProvidedBuyerIdentity) ?? text(metadata.userId);
  const clientId = text(metadata.clientId);
  const status = STATUS[event.eventType];
  if (status) return { kind: "sub_status", subId: orderId, status, ...period(data), at };
  switch (event.eventType) {
    case "order.completed": {
      const product = productOf(data);
      return {
        kind: "order_paid",
        orderId,
        userId,
        productKey: product.key,
        amount: money(data.chargedAmount ?? data.amount),
        currency: text(data.currency),
        clientId,
        at,
      };
    }
    case "subscription.activated":
    case "subscription.renewed":
    // A retried charge succeeded: a paid period like a renewal. Granting is idempotent per
    // period, so a separate `renewed` for the same period changes nothing.
    case "subscription.recovered": {
      const plan = planOf(data);
      return {
        kind: event.eventType === "subscription.activated" ? "sub_started" : "sub_renewed",
        subId: orderId,
        userId,
        productKey: plan.key,
        plan: plan.plan,
        interval: plan.interval,
        ...period(data),
        amount: money(record(data.planPrice).total ?? data.amount),
        currency: text(data.currency),
        clientId,
        at,
      };
    }
    case "subscription.plan_changed": {
      const plan = planOf(data);
      return {
        kind: "sub_plan_changed",
        subId: orderId,
        productKey: plan.key,
        plan: plan.plan,
        interval: plan.interval,
        at,
      };
    }
    case "refund.succeeded": {
      const refunded = money(data.refundedAmount ?? data.amount);
      const original = money(data.originalChargedAmount ?? record(data.originalPayment).total);
      return {
        kind: "refund_succeeded",
        orderId,
        amount: refunded,
        // Without both amounts the share is unknown; a refund then takes back the whole order.
        full: refunded === null || original === null || refunded >= original,
        at,
      };
    }
    default:
      return { kind: "ignored", reason: event.eventType };
  }
}
