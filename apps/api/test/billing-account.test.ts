import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyEvent } from "../src/billing/apply.ts";
import type { Bindings } from "../src/types.ts";
import { jobBody, setup } from "./harness.ts";

const NOW = Date.UTC(2026, 9, 9, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

async function subscriber() {
  const h = await setup();
  await h.pass();
  const { userId, session } = await h.signIn();
  await applyEvent(h.env as unknown as Bindings, "waffo", {
    kind: "sub_started",
    subId: `ORD_${"s".repeat(22)}`,
    userId,
    productKey: "starter_month",
    plan: "starter",
    interval: "month",
    periodStart: NOW,
    periodEnd: NOW + 30 * 86_400_000,
    amount: 9.9,
    currency: "USD",
    clientId: null,
    at: NOW,
  });
  return { h, userId, session };
}

describe("chargeback pause (spec 6.6)", () => {
  it("refuses credit jobs while paused but keeps the free photos", async () => {
    const { h, userId, session } = await subscriber();
    h.db.prepare("UPDATE users SET paid_paused_at=? WHERE id=?").run(NOW, userId);
    const pro = await h.call("/v1/jobs", {
      method: "POST",
      body: jobBody(await h.upload(), { capability: "unblur.pro" }),
      session,
    });
    expect(pro.body.error?.code).toBe("FORBIDDEN");
    const free = await h.call("/v1/jobs", {
      method: "POST",
      body: jobBody(await h.upload()),
      session,
    });
    expect(free.status).toBe(201);
  });
});

describe("deleting an account with a subscription (spec 5.5)", () => {
  it("asks to cancel a live subscription first", async () => {
    const { h, session } = await subscriber();
    const response = await h.call("/v1/account/delete", {
      method: "POST",
      body: { confirm: "DELETE" },
      session,
    });
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("SUBSCRIPTION_ACTIVE");
    expect((await h.call("/v1/me", { session })).body.user).not.toBeNull();
  });

  it("deletes once canceling and keeps the orders without the person", async () => {
    const { h, session } = await subscriber();
    h.db.prepare("UPDATE subscriptions SET status='canceling'").run();
    const response = await h.call("/v1/account/delete", {
      method: "POST",
      body: { confirm: "DELETE" },
      session,
    });
    expect(response.status).toBe(200);
    expect(h.db.prepare("SELECT user_id FROM orders").all()).toEqual([{ user_id: null }]);
    expect(h.db.prepare("SELECT user_id FROM subscriptions").all()).toEqual([{ user_id: null }]);
  });
});
