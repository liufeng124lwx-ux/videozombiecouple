import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelSubscription,
  createCheckout,
  createPlanChange,
  verifyWebhook,
  WaffoError,
  waffoConfig,
} from "../src/billing/waffo.ts";
import type { Bindings } from "../src/types.ts";
import {
  MERCHANT_ID,
  PRODUCT_IDS,
  SESSION,
  STORE_ID,
  signWebhook,
  TOKEN,
  waffoApi,
  waffoEvent,
  waffoKit,
} from "./waffo-kit.ts";

const NOW = Date.UTC(2026, 9, 9, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function config() {
  const kit = await waffoKit();
  return { kit, config: waffoConfig(kit.env as unknown as Bindings) };
}

describe("waffoConfig", () => {
  it("is off unless every setting is present, and drops unknown products", async () => {
    const kit = await waffoKit();
    expect(waffoConfig({ ...kit.env, WAFFO_MODE: "live" } as unknown as Bindings)).toBeNull();
    expect(
      waffoConfig({ ...kit.env, WAFFO_PRIVATE_KEY: undefined } as unknown as Bindings),
    ).toBeNull();
    const products = JSON.stringify({ pack1: PRODUCT_IDS.pack1, gold: "PROD_x", pack3: "bad" });
    const parsed = waffoConfig({ ...kit.env, WAFFO_PRODUCTS: products } as unknown as Bindings);
    expect(parsed?.products).toEqual({ pack1: PRODUCT_IDS.pack1 });
    expect(parsed?.storeIds).toEqual([STORE_ID, "11111111-1111-1111-1111-111111111111"]);
  });
});

describe("authenticated checkout (spec 6.4)", () => {
  it("signs the request and ties the order to our user id", async () => {
    const { kit, config: c } = await config();
    const call = waffoApi({
      [TOKEN]: { data: { token: "tok-123", expiresAt: "x" } },
      [SESSION]: {
        data: { sessionId: "cs_1", checkoutUrl: "https://checkout.waffo.ai/store/x/cs_1" },
      },
    });
    const url = await createCheckout(c!, {
      productKey: "plus_month",
      userId: "user-1",
      email: "ann@example.com",
      successUrl: "https://videozombiecouple.com/unblur-photo?paid=1",
      metadata: { userId: "user-1", productKey: "plus_month" },
      externalId: "upx-1",
    });
    expect(url).toBe("https://checkout.waffo.ai/store/x/cs_1#token=tok-123");
    const token = call(TOKEN);
    const session = call(SESSION);
    expect(token?.url).toBe("https://api.waffo.ai/v1/actions/auth/issue-session-token");
    expect(token?.body).toEqual({ productId: PRODUCT_IDS.plus_month, buyerIdentity: "user-1" });
    expect(session?.url).toBe("https://api.waffo.ai/v1/actions/checkout/create-session");
    expect(session?.body).toMatchObject({
      productId: PRODUCT_IDS.plus_month,
      currency: "USD",
      buyerEmail: "ann@example.com",
      successUrl: "https://videozombiecouple.com/unblur-photo?paid=1",
      metadata: { userId: "user-1", productKey: "plus_month" },
      orderMerchantExternalId: "upx-1",
    });
    expect(session?.headers["x-merchant-id"]).toBe(MERCHANT_ID);
    const bodyHash = btoa(
      String.fromCharCode(
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(session?.raw)),
        ),
      ),
    );
    const canonical = `POST\n/v1/actions/checkout/create-session\n${session?.headers["x-timestamp"]}\n${bodyHash}`;
    const signature = Uint8Array.from(atob(session?.headers["x-signature"] ?? ""), (ch) =>
      ch.charCodeAt(0),
    );
    expect(
      await crypto.subtle.verify(
        { name: "RSASSA-PKCS1-v1_5" },
        kit.keys.publicKey,
        signature,
        new TextEncoder().encode(canonical),
      ),
    ).toBe(true);
  });

  it("throws a WaffoError when Waffo answers with errors or a non-https URL", async () => {
    const { config: c } = await config();
    const params = {
      productKey: "pack1",
      userId: "u",
      email: "a@b.co",
      successUrl: "https://videozombiecouple.com/",
      metadata: {},
      externalId: "x",
    };
    waffoApi({ [TOKEN]: { data: { token: "t" } }, [SESSION]: { errors: [{ message: "nope" }] } });
    await expect(createCheckout(c!, params)).rejects.toBeInstanceOf(WaffoError);
    waffoApi({
      [TOKEN]: { data: { token: "t" } },
      [SESSION]: { data: { sessionId: "s", checkoutUrl: "http://evil" } },
    });
    await expect(createCheckout(c!, params)).rejects.toBeInstanceOf(WaffoError);
  });
});

describe("subscription self-service", () => {
  it("creates a plan change link for the subscription order", async () => {
    const { config: c } = await config();
    const call = waffoApi({
      [TOKEN]: { data: { token: "tok" } },
      [SESSION]: {
        data: { sessionId: "cs", checkoutUrl: "https://checkout.waffo.ai/store/x/change/cs" },
      },
    });
    const url = await createPlanChange(c!, {
      originOrderId: `ORD_${"o".repeat(22)}`,
      productKey: "max_month",
      userId: "user-1",
      timing: "immediate",
    });
    expect(url).toBe("https://checkout.waffo.ai/store/x/change/cs#token=tok");
    expect(call(SESSION)?.body).toEqual({
      originOrderId: `ORD_${"o".repeat(22)}`,
      productId: PRODUCT_IDS.max_month,
      currency: "USD",
      changeTiming: "immediate",
    });
  });

  it("cancels through a customer session token", async () => {
    const { config: c } = await config();
    const CANCEL = "/v1/actions/subscription-order/cancel-order";
    const call = waffoApi({
      [TOKEN]: { data: { token: "cust" } },
      [CANCEL]: { data: { orderId: "ORD_1", status: "canceling" } },
    });
    expect(
      await cancelSubscription(c!, { orderId: `ORD_${"o".repeat(22)}`, userId: "user-1" }),
    ).toBe("canceling");
    expect(call(TOKEN)?.body).toEqual({ storeId: STORE_ID, buyerIdentity: "user-1" });
    expect(call(CANCEL)?.headers.authorization).toBe("Bearer cust");
    expect(call(CANCEL)?.headers["x-environment"]).toBe("test");
  });
});

describe("verifyWebhook", () => {
  it("accepts a correctly signed event for our mode only", async () => {
    const { kit } = await config();
    const body = JSON.stringify(waffoEvent("order.completed", {}));
    const header = await signWebhook(body, kit.keys.privateKey);
    expect((await verifyWebhook(body, header, "test", NOW, kit.keys.publicPem))?.eventType).toBe(
      "order.completed",
    );
    expect(await verifyWebhook(body, header, "prod", NOW, kit.keys.publicPem)).toBeNull();
  });

  it("rejects a changed body, a missing header and an old timestamp", async () => {
    const { kit } = await config();
    const body = JSON.stringify(waffoEvent("order.completed", {}));
    const header = await signWebhook(body, kit.keys.privateKey);
    expect(await verifyWebhook(`${body} `, header, "test", NOW, kit.keys.publicPem)).toBeNull();
    expect(await verifyWebhook(body, undefined, "test", NOW, kit.keys.publicPem)).toBeNull();
    const old = await signWebhook(body, kit.keys.privateKey, NOW - 46 * 60_000);
    expect(await verifyWebhook(body, old, "test", NOW, kit.keys.publicPem)).toBeNull();
  });
});
