import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replayPending } from "../src/billing/webhook.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";
import { signWebhook, waffoEvent, waffoKit } from "./waffo-kit.ts";

const NOW = Date.UTC(2026, 9, 9, 12);
const PACK = `ORD_${"p".repeat(22)}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

async function shop(extra: Record<string, unknown> = {}) {
  const kit = await waffoKit();
  const h = await setup({ ...kit.env, ...extra });
  const { userId } = await h.signIn();
  const deliver = async (event: ReturnType<typeof waffoEvent>, header?: string) => {
    const body = JSON.stringify(event);
    const response = await h.call("/webhooks/waffo", {
      method: "POST",
      body: event,
      headers: { "x-waffo-signature": header ?? (await signWebhook(body, kit.keys.privateKey)) },
    });
    return response.status;
  };
  const paid = (overrides = {}) =>
    waffoEvent("order.completed", {
      orderId: PACK,
      merchantProvidedBuyerIdentity: userId,
      productMetadata: { productKey: "pack200" },
      chargedAmount: "14.99",
      ...overrides,
    });
  const refunded = () =>
    waffoEvent("refund.succeeded", {
      orderId: PACK,
      refundedAmount: "14.99",
      originalChargedAmount: "14.99",
    });
  const balance = async () => (await h.wallets.instance(userId).balance(userId)).total;
  return { h, kit, userId, deliver, paid, refunded, balance };
}

describe("POST /webhooks/waffo (spec 6.2)", () => {
  it("verifies, stores and applies a delivery", async () => {
    const { h, deliver, paid, balance } = await shop();
    const event = paid();
    expect(await deliver(event)).toBe(200);
    expect(await balance()).toBe(200);
    expect(
      h.db.prepare("SELECT type, processed_at, error FROM billing_events WHERE id=?").get(event.id),
    ).toEqual({
      type: "order.completed",
      processed_at: NOW,
      error: null,
    });
  });

  it("answers a repeated delivery without applying it again", async () => {
    const { deliver, paid, balance } = await shop();
    const event = paid();
    await deliver(event);
    expect(await deliver(event)).toBe(200);
    expect(await balance()).toBe(200);
  });

  // Review focus 1: the same delivery arrives twice while the first is still being handled.
  it("handles a delivery once when two copies arrive together", async () => {
    const { deliver, paid, refunded, balance } = await shop();
    const order = paid();
    // The second copy gets 409 (Waffo retries it) or, if the first already finished, 200.
    const statuses = await Promise.all([deliver(order), deliver(order)]);
    expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
    expect(await balance()).toBe(200);
    const refund = refunded();
    await Promise.all([deliver(refund), deliver(refund)]);
    expect(await balance()).toBe(0);
    expect(await deliver(refund)).toBe(200);
    expect(await balance()).toBe(0);
  });

  it("rejects bad signatures and ignores other stores", async () => {
    const { h, deliver, paid } = await shop();
    expect(await deliver(paid(), "t=1,v1=AAAA")).toBe(401);
    expect(
      await deliver(waffoEvent("order.completed", {}, { storeId: `STO_${"z".repeat(22)}` })),
    ).toBe(200);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM billing_events").get()).toEqual({ n: 0 });
  });

  it("is off while payments are not configured", async () => {
    const { deliver, paid } = await shop({ WAFFO_MODE: undefined });
    expect(await deliver(paid())).toBe(503);
  });

  // Review focus 5: events it cannot handle yet are kept and handled later.
  it("keeps a refund that arrives before its order and applies it on replay", async () => {
    const { h, deliver, paid, refunded, balance } = await shop();
    const refund = refunded();
    expect(await deliver(refund)).toBe(500);
    expect(
      (
        h.db.prepare("SELECT error FROM billing_events WHERE id=?").get(refund.id) as {
          error: string;
        }
      ).error,
    ).toMatch(/unknown order/);
    expect(await deliver(paid())).toBe(200);
    vi.setSystemTime(NOW + 2 * 60_000);
    expect(await replayPending(h.env as unknown as Bindings)).toEqual({ done: 1, failed: 0 });
    expect(await balance()).toBe(0);
  });

  it("grants nothing for an unknown product or an order without a user", async () => {
    const { h, deliver, paid, balance } = await shop();
    expect(await deliver(paid({ productMetadata: { productKey: "gold" } }))).toBe(500);
    expect(
      await deliver(
        paid({ orderId: `ORD_${"q".repeat(22)}`, merchantProvidedBuyerIdentity: undefined }),
      ),
    ).toBe(500);
    expect(await balance()).toBe(0);
    expect(
      h.db.prepare("SELECT COUNT(*) AS n FROM billing_events WHERE error IS NOT NULL").get(),
    ).toEqual({ n: 2 });
  });
});

// Final review: deliveries that can never succeed used to take every replay slot forever.
describe("replayPending with deliveries that keep failing", () => {
  it("gives up on a delivery after 10 attempts so newer ones still get replayed", async () => {
    const { h, deliver, paid, balance } = await shop();
    const env = h.env as unknown as Bindings;
    for (let i = 0; i < 100; i++)
      h.db
        .prepare(
          "INSERT INTO billing_events(id,provider,type,mode,payload,received_at,attempts,error) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          `poison-${i}`,
          "waffo",
          "order.completed",
          "test",
          "{not json",
          NOW - 3_600_000 + i,
          10,
          "bad",
        );
    const event = paid();
    h.db
      .prepare(
        "INSERT INTO billing_events(id,provider,type,mode,payload,received_at) VALUES(?,?,?,?,?,?)",
      )
      .run(event.id, "waffo", event.eventType, "test", JSON.stringify(event), NOW);
    vi.setSystemTime(NOW + 2 * 60_000);
    expect(await replayPending(env)).toEqual({ done: 1, failed: 0 });
    expect(await balance()).toBe(200);
    expect(await deliver(paid())).toBe(200);
  });

  it("counts each failed attempt", async () => {
    const { h, deliver, refunded } = await shop();
    const refund = refunded();
    await deliver(refund);
    vi.setSystemTime(NOW + 2 * 60_000);
    await replayPending(h.env as unknown as Bindings);
    expect(h.db.prepare("SELECT attempts FROM billing_events WHERE id=?").get(refund.id)).toEqual({
      attempts: 2,
    });
  });
});
