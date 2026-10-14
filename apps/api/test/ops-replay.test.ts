import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRONS, runCron } from "../src/ops/cron.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";
import { waffoEvent, waffoKit } from "./waffo-kit.ts";

const NOON = Date.UTC(2026, 9, 9, 12);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

describe("webhook replay (spec 6.2)", () => {
  it("the hourly cron applies a payment whose delivery failed after Waffo stopped retrying", async () => {
    const kit = await waffoKit();
    const h = await setup(kit.env);
    const { userId } = await h.signIn();
    const event = waffoEvent("order.completed", {
      orderId: `ORD_${"y".repeat(22)}`,
      merchantProvidedBuyerIdentity: userId,
      productMetadata: { productKey: "pack3" },
      chargedAmount: "11.99",
    });
    h.db
      .prepare(
        "INSERT INTO billing_events(id,provider,type,mode,payload,received_at,attempts,error) VALUES(?,?,?,?,?,?,3,'D1 timeout')",
      )
      .run(event.id, "waffo", event.eventType, "test", JSON.stringify(event), NOON - 3_600_000);
    const ran = await runCron(CRONS.hourly, h.env as unknown as Bindings, NOON, async () => {});
    expect(ran).toContain("webhook-replay");
    expect((await h.wallets.instance(userId).balance(userId)).total).toBe(30);
  });
});
