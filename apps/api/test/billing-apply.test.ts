import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyEvent } from "../src/billing/apply.ts";
import type { BillingEvent } from "../src/billing/events.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

const T0 = Date.UTC(2026, 9, 9);
const DAY = 86_400_000;
const SUB = `ORD_${"s".repeat(22)}`;
const PACK = `ORD_${"p".repeat(22)}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0 + 3_600_000);
});
afterEach(() => vi.useRealTimers());

async function account() {
  const h = await setup();
  const { userId } = await h.signIn();
  const env = h.env as unknown as Bindings;
  const apply = (event: BillingEvent) => applyEvent(env, "waffo", event);
  const balance = async () => h.wallets.instance(userId).balance(userId);
  const sub = () =>
    h.db
      .prepare(
        "SELECT plan_key, interval, status, current_period_end, next_grant_at, cancel_at FROM subscriptions",
      )
      .get() as Record<string, unknown> | undefined;
  return { h, userId, apply, balance, sub };
}

const packPaid = (userId: string | null, productKey = "pack200"): BillingEvent => ({
  kind: "order_paid",
  orderId: PACK,
  userId,
  productKey,
  amount: 14.99,
  currency: "USD",
  clientId: null,
  at: T0,
});

const period = (
  userId: string,
  kind: "sub_started" | "sub_renewed",
  start: number,
  plan: "starter" | "plus" | "max" = "starter",
  interval: "month" | "year" = "month",
): BillingEvent => ({
  kind,
  subId: SUB,
  userId,
  productKey: `${plan}_${interval}`,
  plan,
  interval,
  periodStart: start,
  periodEnd: interval === "month" ? start + 30 * DAY : start + 365 * DAY,
  amount: 9.9,
  currency: "USD",
  clientId: null,
  at: start,
});

const status = (
  s: "active" | "canceling" | "past_due" | "canceled",
  start: number,
  at: number,
): BillingEvent => ({
  kind: "sub_status",
  subId: SUB,
  status: s,
  periodStart: start,
  periodEnd: start + 30 * DAY,
  at,
});

describe("orders (spec 6.4)", () => {
  it("grants a pack once and records the order", async () => {
    const { h, userId, apply, balance } = await account();
    await apply(packPaid(userId));
    await apply(packPaid(userId));
    expect((await balance()).total).toBe(200);
    expect(h.db.prepare("SELECT product_key, status, amount FROM orders").get()).toEqual({
      product_key: "pack200",
      status: "paid",
      amount: 14.99,
    });
  });

  it("refuses orders it cannot attribute or that are not packs", async () => {
    const { userId, apply } = await account();
    await expect(apply(packPaid(null))).rejects.toThrow(/no user/);
    await expect(apply(packPaid(userId, "plus_month"))).rejects.toThrow(/not a pack/);
  });
});

describe("subscriptions (spec 6.5)", () => {
  it("grants the month on start and replaces what is left on renewal", async () => {
    const { userId, apply, balance, sub } = await account();
    await apply(period(userId, "sub_started", T0));
    expect(sub()).toMatchObject({ plan_key: "starter", status: "active", next_grant_at: null });
    expect(await balance()).toMatchObject({
      subscription: { credits: 150, expiresAt: T0 + 30 * DAY },
    });
    await apply(period(userId, "sub_renewed", T0 + 30 * DAY));
    await apply(period(userId, "sub_renewed", T0 + 30 * DAY));
    expect(await balance()).toMatchObject({
      total: 150,
      subscription: { credits: 150, expiresAt: T0 + 60 * DAY },
    });
  });

  it("grants only the first month of a yearly plan and schedules the next", async () => {
    const { userId, apply, balance, sub } = await account();
    await apply(period(userId, "sub_started", T0, "plus", "year"));
    expect(await balance()).toMatchObject({
      subscription: { credits: 450, expiresAt: Date.UTC(2026, 10, 9) },
    });
    expect(sub()).toMatchObject({ interval: "year", next_grant_at: Date.UTC(2026, 10, 9) });
  });

  // Review focus 2: events of the old period arrive after the new period started.
  it("keeps the newest state when events arrive out of order", async () => {
    const { userId, apply, balance, sub } = await account();
    await apply(period(userId, "sub_started", T0));
    await apply(period(userId, "sub_renewed", T0 + 30 * DAY));
    await apply(status("canceling", T0, T0 + DAY));
    expect(sub()).toMatchObject({ status: "active", current_period_end: T0 + 60 * DAY });
    await apply(period(userId, "sub_started", T0));
    expect((await balance()).subscription).toMatchObject({
      credits: 150,
      expiresAt: T0 + 60 * DAY,
    });
    await apply(status("canceling", T0 + 30 * DAY, T0 + 31 * DAY));
    expect(sub()).toMatchObject({ status: "canceling", cancel_at: T0 + 60 * DAY });
  });

  it("tracks past due, recovery and cancellation without taking credits early", async () => {
    const { userId, apply, balance, sub } = await account();
    await apply(period(userId, "sub_started", T0));
    await apply(status("past_due", T0, T0 + DAY));
    expect(sub()).toMatchObject({ status: "past_due" });
    await apply(status("active", T0, T0 + 2 * DAY));
    expect(sub()).toMatchObject({ status: "active" });
    await apply(status("canceled", T0, T0 + 3 * DAY));
    expect(sub()).toMatchObject({ status: "canceled", next_grant_at: null });
    expect((await balance()).total).toBe(150);
  });

  it("tops up the difference on an upgrade and changes nothing now on a downgrade", async () => {
    const { userId, apply, balance, sub } = await account();
    await apply(period(userId, "sub_started", T0));
    const change = (plan: "plus" | "starter"): BillingEvent => ({
      kind: "sub_plan_changed",
      subId: SUB,
      productKey: `${plan}_month`,
      plan,
      interval: "month",
      at: T0 + DAY,
    });
    await apply(change("plus"));
    expect(await balance()).toMatchObject({
      subscription: { credits: 450, expiresAt: T0 + 30 * DAY },
    });
    await apply(change("plus"));
    expect((await balance()).total).toBe(450);
    await apply(change("starter"));
    expect(sub()).toMatchObject({ plan_key: "starter" });
    expect((await balance()).total).toBe(450);
  });

  it("refuses a state change for a subscription it has never seen", async () => {
    const { apply } = await account();
    await expect(apply(status("canceling", T0, T0))).rejects.toThrow(/not known/);
  });
});

describe("refunds and chargebacks (spec 6.6)", () => {
  const refund = (full: boolean, amount: number | null): BillingEvent => ({
    kind: "refund_succeeded",
    orderId: PACK,
    amount,
    full,
    at: T0 + DAY,
  });

  it("takes back a fully refunded pack", async () => {
    const { h, userId, apply, balance } = await account();
    await apply(packPaid(userId));
    await apply(refund(true, 14.99));
    expect((await balance()).total).toBe(0);
    expect(h.db.prepare("SELECT status, refunded_amount FROM orders").get()).toEqual({
      status: "refunded",
      refunded_amount: 14.99,
    });
  });

  it("takes back a share for a partial refund", async () => {
    const { h, userId, apply, balance } = await account();
    await apply(packPaid(userId));
    await apply(refund(false, 7.495));
    expect((await balance()).total).toBe(100);
    expect(h.db.prepare("SELECT status FROM orders").get()).toEqual({
      status: "partially_refunded",
    });
  });

  // Review focus 3: most of the refunded credits were spent already.
  it("records what it could not take back as refund debt", async () => {
    const { h, userId, apply, balance } = await account();
    await apply(packPaid(userId));
    const w = h.wallets.instance(userId);
    await w.reserve(userId, "spent", 180, "spent");
    await w.commitReservation("spent", 180, "spent");
    await apply(refund(true, 14.99));
    expect((await balance()).total).toBe(0);
    expect(h.db.prepare("SELECT refund_debt FROM users WHERE id=?").get(userId)).toEqual({
      refund_debt: 180,
    });
  });

  it("takes back the current period's credits for a refunded subscription", async () => {
    const { userId, apply, balance } = await account();
    await apply(period(userId, "sub_started", T0));
    await apply({ kind: "refund_succeeded", orderId: SUB, amount: 9.9, full: true, at: T0 + DAY });
    expect((await balance()).total).toBe(0);
  });

  it("waits for the order before refunding", async () => {
    const { apply } = await account();
    await expect(apply(refund(true, 14.99))).rejects.toThrow(/unknown order/);
  });

  it("pauses paid features during a chargeback and restores everything if won", async () => {
    const { h, userId, apply, balance } = await account();
    await apply(packPaid(userId));
    await apply({ kind: "dispute_opened", orderId: PACK, at: T0 + DAY });
    expect((await balance()).total).toBe(0);
    const paused = () =>
      (
        h.db.prepare("SELECT paid_paused_at FROM users WHERE id=?").get(userId) as {
          paid_paused_at: number | null;
        }
      ).paid_paused_at;
    expect(paused()).toBe(T0 + DAY);
    await apply({ kind: "dispute_closed", orderId: PACK, won: true, at: T0 + 9 * DAY });
    expect(paused()).toBeNull();
    expect((await balance()).total).toBe(200);
    expect(h.db.prepare("SELECT status FROM orders").get()).toEqual({ status: "paid" });
  });

  it("unpauses a lost chargeback without giving the credits back", async () => {
    const { h, userId, apply, balance } = await account();
    await apply(packPaid(userId));
    await apply({ kind: "dispute_opened", orderId: PACK, at: T0 + DAY });
    await apply({ kind: "dispute_closed", orderId: PACK, won: false, at: T0 + 9 * DAY });
    expect((await balance()).total).toBe(0);
    expect(h.db.prepare("SELECT status FROM orders").get()).toEqual({ status: "refunded" });
    expect(h.db.prepare("SELECT paid_paused_at FROM users WHERE id=?").get(userId)).toEqual({
      paid_paused_at: null,
    });
  });
});

// Final review: repeated or overlapping take-backs drained the user's other credits.
describe("take-backs are capped by what the order granted", () => {
  const OTHER = `ORD_${"b".repeat(22)}`;
  const otherPack = (userId: string): BillingEvent => ({
    kind: "order_paid",
    orderId: OTHER,
    userId,
    productKey: "pack200",
    amount: 14.99,
    currency: "USD",
    clientId: null,
    at: T0,
  });
  const refundA = (full: boolean, amount: number | null): BillingEvent => ({
    kind: "refund_succeeded",
    orderId: PACK,
    amount,
    full,
    at: T0 + DAY,
  });

  it("does not take more on a second refund of the same order", async () => {
    const { userId, apply, balance } = await account();
    await apply(packPaid(userId));
    await apply(otherPack(userId));
    await apply(refundA(true, 14.99));
    await apply(refundA(true, 14.99));
    expect((await balance()).total).toBe(200);
  });

  it("does not take more when a refunded order is later disputed, or disputed twice", async () => {
    const { userId, apply, balance } = await account();
    await apply(packPaid(userId));
    await apply(otherPack(userId));
    await apply(refundA(true, 14.99));
    await apply({ kind: "dispute_opened", orderId: PACK, at: T0 + 2 * DAY });
    await apply({ kind: "dispute_opened", orderId: PACK, at: T0 + 3 * DAY });
    expect((await balance()).total).toBe(200);
  });

  it("uses the refunded amount even when the payload says nothing about the original charge", async () => {
    const { userId, apply, balance } = await account();
    await apply(packPaid(userId));
    await apply(refundA(true, 7.495));
    expect((await balance()).total).toBe(100);
  });
});

// Final review: a refunded or charged-back subscription kept its monthly grants, and a recovered
// subscription (retried charge succeeded) never got its period's credits.
describe("subscriptions that are refunded, disputed or recovered", () => {
  it("stops a fully refunded or disputed subscription from granting more", async () => {
    for (const close of ["refund", "dispute"] as const) {
      const { userId, apply, sub } = await account();
      await apply(period(userId, "sub_started", T0, "max", "year"));
      await apply(
        close === "refund"
          ? { kind: "refund_succeeded", orderId: SUB, amount: 9.9, full: true, at: T0 + DAY }
          : { kind: "dispute_opened", orderId: SUB, at: T0 + DAY },
      );
      expect(sub()).toMatchObject({ status: "canceled", next_grant_at: null });
    }
  });
});
