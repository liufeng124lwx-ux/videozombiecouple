import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setup } from "./harness.ts";
import { PRICES, signStripe, stripeApi, stripeEnv, stripeEvent } from "./stripe-kit.ts";
import { waffoKit } from "./waffo-kit.ts";

const NOW = Date.UTC(2026, 9, 15, 12);
const PI = "pi_3Test0000000000000000001";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function shop(extra: Record<string, string> = {}) {
  const h = await setup(stripeEnv(extra));
  const { userId, session } = await h.signIn("ann@example.com");
  const deliver = async (event: ReturnType<typeof stripeEvent>, header?: string) => {
    const raw = JSON.stringify(event);
    const response = await h.call("/webhooks/stripe", {
      method: "POST",
      body: event,
      headers: { "stripe-signature": header ?? (await signStripe(raw)) },
    });
    return response.status;
  };
  const paid = (object: Record<string, unknown> = {}, livemode = false) =>
    stripeEvent(
      "checkout.session.completed",
      {
        id: "cs_test_1",
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        payment_intent: PI,
        client_reference_id: userId,
        amount_total: 1399,
        currency: "usd",
        metadata: { userId, productKey: "pack3", clientId: "123.456" },
        ...object,
      },
      livemode,
    );
  const refunded = (amountRefunded: number, before = 0) => ({
    ...stripeEvent("charge.refunded", {
      id: "ch_1",
      object: "charge",
      payment_intent: PI,
      amount: 1399,
      amount_refunded: amountRefunded,
      refunded: amountRefunded >= 1399,
    }),
    data: {
      object: {
        id: "ch_1",
        object: "charge",
        payment_intent: PI,
        amount: 1399,
        amount_refunded: amountRefunded,
        refunded: amountRefunded >= 1399,
      },
      previous_attributes: { amount_refunded: before },
    },
  });
  const balance = async () => (await h.wallets.instance(userId).balance(userId)).total;
  return { h, userId, session, deliver, paid, refunded, balance };
}

describe("POST /v1/billing/checkout with Stripe", () => {
  it("opens a Managed Payments checkout for the pack's Stripe price", async () => {
    const { userId, session, h } = await shop();
    const calls = stripeApi({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    const response = await h.call("/v1/billing/checkout", {
      method: "POST",
      session,
      body: { productKey: "pack3", returnPath: "/story?id=S&render=1", clientId: "123.456" },
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    const call = calls[0];
    expect(call?.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(call?.headers.authorization).toBe("Bearer sk_test_kit");
    expect(call?.headers["idempotency-key"]).toMatch(/^vzc-/);
    expect(Object.fromEntries(call?.form ?? [])).toMatchObject({
      mode: "payment",
      "line_items[0][price]": PRICES.pack3,
      "line_items[0][quantity]": "1",
      "managed_payments[enabled]": "true",
      customer_email: "ann@example.com",
      client_reference_id: userId,
      "metadata[userId]": userId,
      "metadata[productKey]": "pack3",
      "metadata[clientId]": "123.456",
      "payment_intent_data[metadata][userId]": userId,
      "payment_intent_data[metadata][productKey]": "pack3",
      success_url: "https://videozombiecouple.com/story?id=S&render=1&paid=1",
      cancel_url: "https://videozombiecouple.com/story?id=S&render=1",
    });
  });

  it("uses Stripe when Waffo is configured too", async () => {
    const kit = await waffoKit();
    const h = await setup({ ...kit.env, ...stripeEnv() });
    const { session } = await h.signIn("bo@example.com");
    const calls = stripeApi({
      id: "cs_test_2",
      url: "https://checkout.stripe.com/c/pay/cs_test_2",
    });
    const response = await h.call("/v1/billing/checkout", {
      method: "POST",
      session,
      body: { productKey: "pack1" },
    });
    expect(response.status).toBe(200);
    expect(calls[0]?.url).toBe("https://api.stripe.com/v1/checkout/sessions");
  });

  it("is unavailable without a price for the pack, and when Stripe fails", async () => {
    const { h, session } = await shop({
      STRIPE_PRICES: JSON.stringify({ pack1: "price_1KitPack1" }),
    });
    const post = (productKey: string) =>
      h.call("/v1/billing/checkout", { method: "POST", session, body: { productKey } });
    expect((await post("pack3")).body).toMatchObject({ error: { code: "PAYMENTS_UNAVAILABLE" } });
    stripeApi({ error: { message: "boom" } }, 500);
    expect((await post("pack1")).status).toBe(503);
  });
});

describe("POST /webhooks/stripe", () => {
  it("grants the pack once for a paid session", async () => {
    const { h, deliver, paid, balance } = await shop();
    const event = paid();
    expect(await deliver(event)).toBe(200);
    expect(await deliver(event)).toBe(200);
    expect(await balance()).toBe(30);
    expect(
      h.db.prepare("SELECT provider, provider_order_id, amount, currency FROM orders").get(),
    ).toEqual({ provider: "stripe", provider_order_id: PI, amount: 13.99, currency: "USD" });
  });

  it("refuses a bad or stale signature", async () => {
    const { deliver, paid, balance } = await shop();
    const event = paid();
    const raw = JSON.stringify(event);
    expect(await deliver(event, await signStripe(raw, "whsec_wrong"))).toBe(401);
    expect(await deliver(event, await signStripe(raw, undefined, NOW / 1000 - 600))).toBe(401);
    expect(await deliver(event, "")).toBe(401);
    expect(await balance()).toBe(0);
  });

  it("ignores live events on a test key, and sessions that are not paid", async () => {
    const { deliver, paid, balance } = await shop();
    expect(await deliver(paid({}, true))).toBe(200);
    expect(await deliver(paid({ payment_status: "unpaid" }))).toBe(200);
    expect(await balance()).toBe(0);
  });

  it("takes back a full refund, and only the new share of a second partial refund", async () => {
    const { deliver, paid, refunded, balance } = await shop();
    await deliver(paid());
    expect(await deliver(refunded(466))).toBe(200); // a third of $13.99
    expect(await balance()).toBe(20);
    expect(await deliver(refunded(1399, 466))).toBe(200);
    expect(await balance()).toBe(0);
  });

  it("asks Stripe to retry a refund that arrives before its order", async () => {
    const { deliver, refunded } = await shop();
    expect(await deliver(refunded(1399))).toBe(500);
  });

  it("claws back a disputed pack and pauses paid features", async () => {
    const { h, userId, deliver, paid, balance } = await shop();
    await deliver(paid());
    const dispute = stripeEvent("charge.dispute.created", {
      id: "dp_1",
      object: "dispute",
      payment_intent: PI,
      charge: "ch_1",
      amount: 1399,
    });
    expect(await deliver(dispute)).toBe(200);
    expect(await balance()).toBe(0);
    expect(h.db.prepare("SELECT paid_paused_at FROM users WHERE id=?").get(userId)).toEqual({
      paid_paused_at: NOW,
    });
  });

  it("is off without a webhook secret", async () => {
    const { h } = await shop({ STRIPE_WEBHOOK_SECRET: "" });
    const response = await h.call("/webhooks/stripe", { method: "POST", body: {} });
    expect(response.status).toBe(503);
  });
});
