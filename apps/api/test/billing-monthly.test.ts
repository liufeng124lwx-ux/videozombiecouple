import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyEvent } from "../src/billing/apply.ts";
import { grantDueMonthly } from "../src/billing/monthly.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

const START = Date.UTC(2026, 0, 31, 9);
const END = Date.UTC(2027, 0, 31, 9);
const SUB = `ORD_${"y".repeat(22)}`;
const HOUR = 3_600_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

async function yearly() {
  const h = await setup();
  const { userId } = await h.signIn();
  const env = h.env as unknown as Bindings;
  await applyEvent(env, "waffo", {
    kind: "sub_started",
    subId: SUB,
    userId,
    productKey: "starter_year",
    plan: "starter",
    interval: "year",
    periodStart: START,
    periodEnd: END,
    amount: 94.8,
    currency: "USD",
    clientId: null,
    at: START,
  });
  const at = async (time: number) => {
    vi.setSystemTime(time);
    return grantDueMonthly(env, time);
  };
  const subscription = async () => (await h.wallets.instance(userId).balance(userId)).subscription;
  const next = () =>
    (
      h.db.prepare("SELECT next_grant_at FROM subscriptions").get() as {
        next_grant_at: number | null;
      }
    ).next_grant_at;
  return { h, env, at, subscription, next };
}

describe("yearly plans: monthly credits (spec 6.5)", () => {
  // Review focus 4: bought on January 31.
  it("grants on the same day each month, falling back to the month's last day without drifting", async () => {
    const { at, subscription, next } = await yearly();
    expect(await subscription()).toEqual({ credits: 150, expiresAt: Date.UTC(2026, 1, 28, 9) });
    expect(await at(Date.UTC(2026, 1, 28, 9) - HOUR)).toBe(0);
    expect(await at(Date.UTC(2026, 1, 28, 9) + HOUR)).toBe(1);
    expect(await subscription()).toEqual({ credits: 150, expiresAt: Date.UTC(2026, 2, 31, 9) });
    expect(await at(Date.UTC(2026, 1, 28, 9) + 2 * HOUR)).toBe(0);
    await at(Date.UTC(2026, 2, 31, 10));
    expect(await subscription()).toEqual({ credits: 150, expiresAt: Date.UTC(2026, 3, 30, 9) });
    expect(next()).toBe(Date.UTC(2026, 3, 30, 9));
  });

  it("voids last month's leftovers when the new month's credits arrive", async () => {
    const { h, at } = await yearly();
    await at(Date.UTC(2026, 1, 28, 10));
    const expired = h.db.prepare("SELECT delta FROM credit_ledger WHERE type='expire'").all();
    expect(expired).toEqual([{ delta: -150 }]);
  });

  it("after an outage grants only the month that has started, not the missed ones", async () => {
    const { at, subscription, next } = await yearly();
    expect(await at(Date.UTC(2026, 6, 15))).toBe(1);
    expect(await subscription()).toEqual({ credits: 150, expiresAt: Date.UTC(2026, 6, 31, 9) });
    expect(next()).toBe(Date.UTC(2026, 6, 31, 9));
  });

  it("keeps granting while canceling, but not while past due or after the year", async () => {
    const { h, env, at, next } = await yearly();
    h.db.prepare("UPDATE subscriptions SET status='canceling'").run();
    expect(await at(Date.UTC(2026, 1, 28, 10))).toBe(1);
    h.db.prepare("UPDATE subscriptions SET status='past_due'").run();
    expect(await at(Date.UTC(2026, 2, 31, 10))).toBe(0);
    h.db.prepare("UPDATE subscriptions SET status='active'").run();
    expect(await at(Date.UTC(2026, 11, 31, 10))).toBe(1);
    expect(next()).toBeNull();
    expect(await grantDueMonthly(env, END + HOUR)).toBe(0);
  });
});

// Final review: the new year's status event arriving before its renewal left the year without
// monthly grants.
describe("yearly plans: a new year announced by a status event", () => {
  it("schedules the monthly grants when a status event opens the new period", async () => {
    const { env, at, next } = await yearly();
    const YEAR2_END = Date.UTC(2028, 0, 31, 9);
    await applyEvent(env, "waffo", {
      kind: "sub_status",
      subId: SUB,
      status: "canceling",
      periodStart: END,
      periodEnd: YEAR2_END,
      at: END + HOUR,
    });
    expect(next()).toBe(Date.UTC(2027, 1, 28, 9));
    expect(await at(Date.UTC(2027, 1, 28, 10))).toBe(1);
  });
});
