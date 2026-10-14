import { describe, expect, it } from "vitest";
import { addMonths, nextMonthly, parseDate } from "../src/billing/dates.ts";
import { fromWaffo } from "../src/billing/waffo-events.ts";
import { waffoEvent } from "./waffo-kit.ts";

const ORD = `ORD_${"o".repeat(22)}`;
const AT = "2026-10-09T12:00:00.000Z";
const sub = (productKey: string, extra: Record<string, unknown> = {}) => ({
  orderId: ORD,
  merchantProvidedBuyerIdentity: "user-1",
  productMetadata: { productKey },
  orderMetadata: { userId: "user-1", productKey: "starter_month", clientId: "123.456" },
  billingPeriod: "monthly",
  currentPeriodStart: "2026-10-09",
  currentPeriodEnd: "2026-11-09",
  planPrice: { total: "24.90" },
  ...extra,
});

describe("dates (spec 6.5)", () => {
  it("adds calendar months, clamping to the end of shorter months", () => {
    expect(addMonths(Date.UTC(2026, 0, 31), 1)).toBe(Date.UTC(2026, 1, 28));
    expect(addMonths(Date.UTC(2028, 0, 31), 1)).toBe(Date.UTC(2028, 1, 29));
    expect(addMonths(Date.UTC(2026, 0, 31), 2)).toBe(Date.UTC(2026, 2, 31));
    expect(addMonths(Date.UTC(2026, 11, 15, 8), 1)).toBe(Date.UTC(2027, 0, 15, 8));
  });

  it("counts monthly dates from the anchor so month ends never drift", () => {
    const anchor = Date.UTC(2026, 0, 31);
    expect(nextMonthly(anchor, anchor)).toBe(Date.UTC(2026, 1, 28));
    expect(nextMonthly(anchor, Date.UTC(2026, 1, 28))).toBe(Date.UTC(2026, 2, 31));
  });

  it("reads Waffo dates as UTC", () => {
    expect(parseDate("2026-05-01")).toBe(Date.UTC(2026, 4, 1));
    expect(parseDate("nope")).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });
});

describe("fromWaffo (spec 6.1)", () => {
  it("turns a completed pack order into order_paid", () => {
    const event = waffoEvent(
      "order.completed",
      {
        orderId: ORD,
        merchantProvidedBuyerIdentity: "user-1",
        productMetadata: { productKey: "pack200" },
        orderMetadata: { clientId: "123.456" },
        chargedAmount: "14.99",
      },
      { timestamp: AT },
    );
    expect(fromWaffo(event)).toEqual({
      kind: "order_paid",
      orderId: ORD,
      userId: "user-1",
      productKey: "pack200",
      amount: 14.99,
      currency: "USD",
      clientId: "123.456",
      at: Date.parse(AT),
    });
  });

  it("reads the plan from product metadata, which follows plan changes", () => {
    const event = fromWaffo(
      waffoEvent("subscription.activated", sub("plus_month"), { timestamp: AT }),
    );
    expect(event).toEqual({
      kind: "sub_started",
      subId: ORD,
      userId: "user-1",
      productKey: "plus_month",
      plan: "plus",
      interval: "month",
      periodStart: Date.UTC(2026, 9, 9),
      periodEnd: Date.UTC(2026, 10, 9),
      amount: 24.9,
      currency: "USD",
      clientId: "123.456",
      at: Date.parse(AT),
    });
    expect(fromWaffo(waffoEvent("subscription.renewed", sub("plus_month"))).kind).toBe(
      "sub_renewed",
    );
  });

  it("falls back to order metadata for the user", () => {
    const data = sub("max_year");
    delete (data as Record<string, unknown>).merchantProvidedBuyerIdentity;
    const event = fromWaffo(waffoEvent("subscription.activated", data));
    expect(event).toMatchObject({ userId: "user-1", plan: "max", interval: "year" });
  });

  it("maps subscription state changes", () => {
    const cases = [
      ["subscription.canceling", "canceling"],
      ["subscription.uncanceled", "active"],
      ["subscription.past_due", "past_due"],
      ["subscription.canceled", "canceled"],
    ] as const;
    for (const [type, status] of cases)
      expect(fromWaffo(waffoEvent(type, sub("starter_month")))).toMatchObject({
        kind: "sub_status",
        subId: ORD,
        status,
        periodEnd: Date.UTC(2026, 10, 9),
      });
    expect(fromWaffo(waffoEvent("subscription.plan_changed", sub("max_month")))).toMatchObject({
      kind: "sub_plan_changed",
      plan: "max",
    });
  });

  // Final review: a recovered subscription is a paid period; route it like a renewal so the period
  // gets its credits even if Waffo sends no separate renewal.
  it("treats a recovery like a renewal", () => {
    expect(fromWaffo(waffoEvent("subscription.recovered", sub("plus_month")))).toMatchObject({
      kind: "sub_renewed",
      plan: "plus",
      periodStart: Date.UTC(2026, 9, 9),
    });
  });

  it("tells full refunds from partial ones by the charged amount", () => {
    const refund = (refundedAmount: string) =>
      fromWaffo(
        waffoEvent("refund.succeeded", {
          orderId: ORD,
          refundedAmount,
          originalChargedAmount: "14.99",
        }),
      );
    expect(refund("14.99")).toMatchObject({ kind: "refund_succeeded", amount: 14.99, full: true });
    expect(refund("7.50")).toMatchObject({ amount: 7.5, full: false });
    expect(fromWaffo(waffoEvent("refund.succeeded", { orderId: ORD }))).toMatchObject({
      full: true,
    });
  });

  it("ignores events that carry nothing for us and rejects ones it cannot read", () => {
    expect(fromWaffo(waffoEvent("subscription.payment_succeeded", { orderId: ORD }))).toEqual({
      kind: "ignored",
      reason: "subscription.payment_succeeded",
    });
    expect(() =>
      fromWaffo(
        waffoEvent("order.completed", { orderId: ORD, productMetadata: { productKey: "gold" } }),
      ),
    ).toThrow(/unknown product/);
    expect(() =>
      fromWaffo(
        waffoEvent("subscription.renewed", { ...sub("plus_month"), currentPeriodEnd: undefined }),
      ),
    ).toThrow(/period/);
  });
});
