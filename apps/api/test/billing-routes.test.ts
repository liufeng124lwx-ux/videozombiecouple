import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyEvent } from "../src/billing/apply.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";
import { PRODUCT_IDS, SESSION, TOKEN, waffoApi, waffoKit } from "./waffo-kit.ts";

const NOW = Date.UTC(2026, 9, 9, 12);
const SUB = `ORD_${"s".repeat(22)}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function member(payments = true) {
  const kit = await waffoKit();
  const h = await setup(payments ? kit.env : {});
  const { userId, session } = await h.signIn("ann@example.com");
  const post = (path: string, body: unknown = {}) =>
    h.call(path, { method: "POST", body, session });
  const subscribe = (plan: "starter" | "plus" = "starter") =>
    applyEvent(h.env as unknown as Bindings, "waffo", {
      kind: "sub_started",
      subId: SUB,
      userId,
      productKey: `${plan}_month`,
      plan,
      interval: "month",
      periodStart: NOW,
      periodEnd: NOW + 30 * 86_400_000,
      amount: 9.9,
      currency: "USD",
      clientId: null,
      at: NOW,
    });
  const checkoutApi = () =>
    waffoApi({
      [TOKEN]: { data: { token: "tok" } },
      [SESSION]: { data: { sessionId: "cs", checkoutUrl: "https://checkout.waffo.ai/store/x/cs" } },
    });
  return { h, userId, session, post, subscribe, checkoutApi };
}

describe("POST /v1/billing/checkout (spec 6.4)", () => {
  it("sends a signed-in user to an authenticated checkout and back to the page", async () => {
    const { userId, post, checkoutApi } = await member();
    const call = checkoutApi();
    const response = await post("/v1/billing/checkout", {
      productKey: "pack200",
      returnPath: "/unblur-photo?job=1",
      clientId: "123.456",
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ url: "https://checkout.waffo.ai/store/x/cs#token=tok" });
    expect(call(SESSION)?.body).toMatchObject({
      productId: PRODUCT_IDS.pack200,
      buyerEmail: "ann@example.com",
      successUrl: "https://videozombiecouple.com/unblur-photo?job=1&paid=1",
      metadata: { userId, productKey: "pack200", clientId: "123.456" },
    });
  });

  it("needs a session, a known product and configured payments", async () => {
    const { h, post } = await member();
    expect(
      (await h.call("/v1/billing/checkout", { method: "POST", body: { productKey: "pack60" } }))
        .status,
    ).toBe(401);
    expect((await post("/v1/billing/checkout", { productKey: "gold" })).status).toBe(400);
    const off = await member(false);
    expect(
      (await off.post("/v1/billing/checkout", { productKey: "pack60" })).body.error?.code,
    ).toBe("PAYMENTS_UNAVAILABLE");
  });

  it("refuses a second subscription but still sells packs", async () => {
    const { post, subscribe, checkoutApi } = await member();
    await subscribe();
    checkoutApi();
    expect(
      (await post("/v1/billing/checkout", { productKey: "plus_month" })).body.error?.code,
    ).toBe("SUBSCRIPTION_ACTIVE");
    expect((await post("/v1/billing/checkout", { productKey: "pack60" })).status).toBe(200);
  });

  it("refuses while a chargeback has paid features paused", async () => {
    const { h, userId, post } = await member();
    h.db.prepare("UPDATE users SET paid_paused_at=? WHERE id=?").run(NOW, userId);
    expect((await post("/v1/billing/checkout", { productKey: "pack60" })).status).toBe(403);
  });

  it("answers 503 when Waffo fails", async () => {
    const { post } = await member();
    waffoApi({
      [TOKEN]: { errors: [{ message: "down" }] },
      [SESSION]: { errors: [{ message: "down" }] },
    });
    expect((await post("/v1/billing/checkout", { productKey: "pack60" })).status).toBe(503);
  });
});

describe("GET /v1/billing", () => {
  it("shows the subscription, pause and refund debt", async () => {
    const { h, userId, session, subscribe } = await member();
    expect((await h.call("/v1/billing", { session })).body).toEqual({
      subscription: null,
      paidPaused: false,
      refundDebt: 0,
    });
    await subscribe();
    h.db.prepare("UPDATE users SET refund_debt=3 WHERE id=?").run(userId);
    expect((await h.call("/v1/billing", { session })).body).toEqual({
      subscription: {
        plan: "starter",
        interval: "month",
        status: "active",
        periodEnd: NOW + 30 * 86_400_000,
        cancelAt: null,
      },
      paidPaused: false,
      refundDebt: 3,
    });
  });
});

describe("subscription self-service (spec 6.5)", () => {
  it("upgrades now and downgrades next period", async () => {
    const { post, subscribe } = await member();
    await subscribe("plus");
    const api = () =>
      waffoApi({
        [TOKEN]: { data: { token: "tok" } },
        [SESSION]: {
          data: { sessionId: "cs", checkoutUrl: "https://checkout.waffo.ai/store/x/change/cs" },
        },
      });
    let call = api();
    expect(
      (await post("/v1/billing/subscription/change", { productKey: "max_month" })).body,
    ).toEqual({
      url: "https://checkout.waffo.ai/store/x/change/cs#token=tok",
    });
    expect(call(SESSION)?.body).toMatchObject({ originOrderId: SUB, changeTiming: "immediate" });
    call = api();
    await post("/v1/billing/subscription/change", { productKey: "starter_month" });
    expect(call(SESSION)?.body).toMatchObject({ changeTiming: "next_period" });
    expect(
      (await post("/v1/billing/subscription/change", { productKey: "plus_month" })).status,
    ).toBe(400);
  });

  it("needs a live subscription to change, cancel or resume", async () => {
    const { post } = await member();
    expect(
      (await post("/v1/billing/subscription/change", { productKey: "max_month" })).status,
    ).toBe(404);
    expect((await post("/v1/billing/subscription/cancel")).status).toBe(404);
    expect((await post("/v1/billing/subscription/resume")).status).toBe(404);
  });

  it("cancels at the period end and resumes", async () => {
    const { h, post, subscribe } = await member();
    await subscribe();
    const CANCEL = "/v1/actions/subscription-order/cancel-order";
    const RESUME = "/v1/actions/subscription-order/reactivate-order";
    const call = waffoApi({
      [TOKEN]: { data: { token: "cust" } },
      [CANCEL]: { data: { orderId: SUB, status: "canceling" } },
      [RESUME]: { data: { orderId: SUB, status: "active" } },
    });
    expect((await post("/v1/billing/subscription/cancel")).body).toEqual({ status: "canceling" });
    expect(call(CANCEL)?.body).toEqual({ orderId: SUB });
    h.db.prepare("UPDATE subscriptions SET status='canceling'").run();
    expect((await post("/v1/billing/subscription/resume")).body).toEqual({ status: "active" });
  });
});
