import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setup } from "./harness.ts";

const T0 = Date.UTC(2026, 9, 9, 12);
const DAY = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

async function wallet() {
  const h = await setup();
  const w = h.wallets.instance("u1");
  const consistent = () =>
    (
      h.db
        .prepare(
          "SELECT b.remaining AS remaining, COALESCE(SUM(l.delta), 0) AS total FROM credit_buckets b LEFT JOIN credit_ledger l ON l.bucket_id = b.id GROUP BY b.id",
        )
        .all() as { remaining: number; total: number }[]
    ).every((row) => row.remaining === row.total && row.remaining >= 0);
  const ledger = () =>
    h.db.prepare("SELECT type, delta, order_id FROM credit_ledger ORDER BY id").all() as {
      type: string;
      delta: number;
      order_id: string | null;
    }[];
  return { h, w, consistent, ledger };
}

describe("Wallet billing operations (spec 6.5, 6.6)", () => {
  it("records the order id on grants", async () => {
    const { w, ledger } = await wallet();
    await w.grant("u1", {
      kind: "pack",
      credits: 60,
      expiresAt: null,
      sourceRef: "order:ORD_1",
      orderId: "ORD_1",
      reason: "pack60",
    });
    expect(ledger()).toEqual([{ type: "grant", delta: 60, order_id: "ORD_1" }]);
  });

  it("renews subscription credits: voids what is left, grants the new period, once", async () => {
    const { w, ledger, consistent } = await wallet();
    const period = (start: number) => ({
      credits: 150,
      expiresAt: start + 30 * DAY,
      sourceRef: `sub:SUB_1:${start}`,
      orderId: "SUB_1",
      reason: "starter_month",
    });
    await w.grant("u1", {
      kind: "pack",
      credits: 60,
      expiresAt: null,
      sourceRef: null,
      reason: "pack",
    });
    await w.renewSubscription("u1", period(T0));
    await w.reserve("u1", "job1", 100, "job1");
    await w.commitReservation("job1", 100, "job1");
    expect(await w.balance("u1")).toMatchObject({ total: 110, subscription: { credits: 50 } });
    expect((await w.renewSubscription("u1", period(T0))).created).toBe(false);
    vi.setSystemTime(T0 + 30 * DAY - 1);
    await w.renewSubscription("u1", period(T0 + 30 * DAY));
    expect(await w.balance("u1")).toMatchObject({
      total: 210,
      subscription: { credits: 150 },
      permanent: 60,
    });
    expect(ledger().filter((row) => row.type === "expire")).toEqual([
      { type: "expire", delta: -50, order_id: null },
    ]);
    expect(consistent()).toBe(true);
  });

  it("claws back from the order's own credits first", async () => {
    const { w, ledger } = await wallet();
    await w.grant("u1", {
      kind: "bonus",
      credits: 5,
      expiresAt: null,
      sourceRef: "signup",
      reason: "signup",
    });
    await w.grant("u1", {
      kind: "pack",
      credits: 200,
      expiresAt: null,
      sourceRef: "order:ORD_1",
      orderId: "ORD_1",
      reason: "pack200",
    });
    expect(
      await w.clawback("u1", {
        credits: 200,
        sourcePrefix: "order:ORD_1",
        orderId: "ORD_1",
        reason: "refund",
      }),
    ).toEqual({ clawed: 200, debt: 0 });
    expect(await w.balance("u1")).toMatchObject({ total: 5 });
    expect(ledger().slice(-1)).toEqual([{ type: "clawback", delta: -200, order_id: "ORD_1" }]);
  });

  // Review focus 3: the refunded credits were mostly spent already.
  it("takes the rest from other credits, never below zero, and reports the debt", async () => {
    const { w, consistent } = await wallet();
    await w.grant("u1", {
      kind: "bonus",
      credits: 5,
      expiresAt: null,
      sourceRef: "signup",
      reason: "signup",
    });
    await w.grant("u1", {
      kind: "pack",
      credits: 200,
      expiresAt: null,
      sourceRef: "order:ORD_1",
      orderId: "ORD_1",
      reason: "pack200",
    });
    await w.reserve("u1", "spend", 150, "spend");
    await w.commitReservation("spend", 150, "spend");
    expect(
      await w.clawback("u1", {
        credits: 200,
        sourcePrefix: "order:ORD_1",
        orderId: "ORD_1",
        reason: "refund",
      }),
    ).toEqual({ clawed: 55, debt: 145 });
    expect((await w.balance("u1")).total).toBe(0);
    expect(consistent()).toBe(true);
  });

  it("claws back nothing from an empty wallet without failing", async () => {
    const { w } = await wallet();
    expect(
      await w.clawback("u1", {
        credits: 60,
        sourcePrefix: "order:X",
        orderId: "X",
        reason: "refund",
      }),
    ).toEqual({ clawed: 0, debt: 60 });
  });
});
