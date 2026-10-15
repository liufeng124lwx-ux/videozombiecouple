import { productByKey } from "@vzc/catalog";
import type { BillingEvent } from "./events.ts";
import type { StripeEvent } from "./stripe.ts";

const text = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;

const cents = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/** The payment's id: sessions, charges and disputes all point at the same PaymentIntent. */
function paymentOf(object: Record<string, unknown>): string {
  const id = text(object.payment_intent) ?? text(record(object.payment_intent).id);
  if (!id) throw new Error(`stripe ${String(object.object)} without a payment intent`);
  return id;
}

/** Packs only (one-time Checkout Sessions); everything else is ignored. */
export function fromStripe(event: StripeEvent): BillingEvent {
  const object = event.data.object;
  const at = typeof event.created === "number" ? event.created * 1000 : Date.now();
  switch (event.type) {
    case "checkout.session.completed": {
      if (object.mode !== "payment") return { kind: "ignored", reason: "not a one-time payment" };
      // Delayed methods finish later; only cards are offered, so an unpaid session is not ours.
      if (object.payment_status !== "paid") return { kind: "ignored", reason: "session not paid" };
      const metadata = record(object.metadata);
      const key = text(metadata.productKey);
      const product = key ? productByKey(key) : null;
      if (!product) throw new Error(`unknown product ${String(key)}`);
      const total = cents(object.amount_total);
      return {
        kind: "order_paid",
        orderId: paymentOf(object),
        userId: text(metadata.userId) ?? text(object.client_reference_id),
        productKey: product.key,
        amount: total === null ? null : total / 100,
        currency: text(object.currency)?.toUpperCase() ?? null,
        clientId: text(metadata.clientId),
        at,
      };
    }
    case "charge.refunded": {
      // amount_refunded is the running total; this refund is what changed since the last event.
      const total = cents(object.amount_refunded);
      const before = cents(record(event.data.previous_attributes).amount_refunded) ?? 0;
      return {
        kind: "refund_succeeded",
        orderId: paymentOf(object),
        amount: total === null ? null : Math.max(0, total - before) / 100,
        full: object.refunded === true,
        at,
      };
    }
    case "charge.dispute.created":
      return { kind: "dispute_opened", orderId: paymentOf(object), at };
    case "charge.dispute.closed":
      return {
        kind: "dispute_closed",
        orderId: paymentOf(object),
        won: object.status === "won",
        at,
      };
    default:
      return { kind: "ignored", reason: event.type };
  }
}
