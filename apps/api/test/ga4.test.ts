import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyEvent } from "../src/billing/apply.ts";
import type { BillingEvent } from "../src/billing/events.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

const NOW = Date.UTC(2026, 9, 9, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const pack = (userId: string, clientId: string | null): BillingEvent => ({
  kind: "order_paid",
  orderId: `ORD_${"p".repeat(22)}`,
  userId,
  productKey: "pack3",
  amount: 11.99,
  currency: "USD",
  clientId,
  at: NOW,
});

async function shop(ga4 = true) {
  const h = await setup(ga4 ? { GA4_MEASUREMENT_ID: "G-TEST", GA4_API_SECRET: "secret" } : {});
  const { userId } = await h.signIn();
  const sent: { url: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const apply = (event: BillingEvent) => applyEvent(h.env as unknown as Bindings, "waffo", event);
  return { h, userId, sent, fetchMock, apply };
}

describe("GA4 purchase (spec 9)", () => {
  it("reports a first purchase with the browser's client id", async () => {
    const { userId, sent, apply } = await shop();
    await apply(pack(userId, "123.456"));
    expect(sent).toEqual([
      {
        url: "https://www.google-analytics.com/mp/collect?measurement_id=G-TEST&api_secret=secret",
        body: {
          client_id: "123.456",
          events: [
            {
              name: "purchase",
              params: {
                transaction_id: `ORD_${"p".repeat(22)}`,
                value: 11.99,
                currency: "USD",
                items: [{ item_id: "pack3" }],
              },
            },
          ],
        },
      },
    ]);
  });

  it("stays quiet without a client id or GA4 settings", async () => {
    const withoutClient = await shop();
    await withoutClient.apply(pack(withoutClient.userId, null));
    expect(withoutClient.sent).toEqual([]);
    const withoutConfig = await shop(false);
    await withoutConfig.apply(pack(withoutConfig.userId, "123.456"));
    expect(withoutConfig.sent).toEqual([]);
  });

  it("still grants the credits when GA4 is down", async () => {
    const { h, userId, fetchMock, apply } = await shop();
    fetchMock.mockRejectedValueOnce(new Error("network"));
    await apply(pack(userId, "123.456"));
    expect((await h.wallets.instance(userId).balance(userId)).total).toBe(30);
  });
});
