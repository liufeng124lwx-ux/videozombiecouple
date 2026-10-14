import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dispatcher } from "../src/durable-objects/dispatcher.ts";
import { checkOrders } from "../src/ops/orders.ts";
import type { Bindings } from "../src/types.ts";
import { namespace, setup } from "./harness.ts";
import { signWebhook, waffoEvent, waffoKit } from "./waffo-kit.ts";

const NOON = Date.UTC(2026, 9, 9, 12);
const TELEGRAM = { TELEGRAM_BOT_TOKEN: "bot-token", TELEGRAM_CHAT_ID: "42" };

let sent: string[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
  sent = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("https://api.telegram.org/"))
      sent.push(JSON.parse(String(init?.body)).text as string);
    return new Response("{}");
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("breaker alerts (spec 8.3)", () => {
  const M = "seedream/5-flash-image-to-image";

  it("says once when a model's breaker opens, and once when it closes", async () => {
    const h = await setup(TELEGRAM);
    const d = namespace((ctx) => new Dispatcher(ctx, h.env as never)).instance("kie-image");
    for (let i = 0; i < 10; i++) await d.report(M, false);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(`Breaker open: ${M}`);
    vi.setSystemTime(NOON + 5 * 60_000);
    await d.acquire("probe", "free", M);
    await d.report(M, false); // the probe fails: it opens again, no second alert
    expect(sent).toHaveLength(1);
    vi.setSystemTime(NOON + 10 * 60_000);
    await d.acquire("probe2", "free", M);
    await d.report(M, true);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("Resolved");
  });

  it("never lets a failing alert break dispatching", async () => {
    const d = namespace((ctx) => new Dispatcher(ctx, {} as never)).instance("kie-image");
    for (let i = 0; i < 10; i++) await d.report(M, false);
    expect(await d.allowModels([M])).toEqual([]);
  });
});

describe("webhook signature alerts (spec 8.3)", () => {
  it("alerts on the third bad signature in a row, and resolves on a good one", async () => {
    const kit = await waffoKit();
    const h = await setup({ ...kit.env, ...TELEGRAM });
    const { userId } = await h.signIn();
    const event = waffoEvent("order.completed", {
      orderId: `ORD_${"s".repeat(22)}`,
      merchantProvidedBuyerIdentity: userId,
      productMetadata: { productKey: "pack3" },
      chargedAmount: "11.99",
    });
    const deliver = async (header: string) =>
      (
        await h.call("/webhooks/waffo", {
          method: "POST",
          body: event,
          headers: { "x-waffo-signature": header },
        })
      ).status;
    expect(await deliver("bad")).toBe(401);
    expect(await deliver("bad")).toBe(401);
    expect(sent.filter((t) => t.includes("signature"))).toHaveLength(0);
    expect(await deliver("bad")).toBe(401);
    expect(sent.filter((t) => t.includes("signature"))).toHaveLength(1);
    expect(await deliver(await signWebhook(JSON.stringify(event), kit.keys.privateKey))).toBe(200);
    expect(sent.at(-1)).toContain("Resolved");
    expect(await deliver("bad")).toBe(401);
    expect(sent.filter((t) => t.startsWith("Waffo"))).toHaveLength(1);
  });
});

describe("order reconciliation (spec 8.2)", () => {
  it("finds a processed payment with no order, and is quiet once the order exists", async () => {
    const h = await setup(TELEGRAM);
    const env = h.env as unknown as Bindings;
    const orderId = `ORD_${"r".repeat(22)}`;
    const event = waffoEvent("order.completed", {
      orderId,
      merchantProvidedBuyerIdentity: "u1",
      productMetadata: { productKey: "pack3" },
      chargedAmount: "11.99",
    });
    h.db
      .prepare(
        "INSERT INTO billing_events(id,provider,type,mode,payload,received_at,processed_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        event.id,
        "waffo",
        "order.completed",
        "test",
        JSON.stringify(event),
        NOON - 3_600_000,
        NOON - 3_600_000,
      );
    await checkOrders(env, NOON);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(orderId);
    h.db
      .prepare(
        "INSERT INTO orders(id,provider,provider_order_id,user_id,product_key,status,created_at) VALUES('o1','waffo',?,'u1','pack3','paid',?)",
      )
      .run(orderId, NOON);
    vi.setSystemTime(NOON + 2 * 3_600_000);
    await checkOrders(env, NOON + 2 * 3_600_000);
    expect(sent.at(-1)).toContain("Resolved");
  });
});
