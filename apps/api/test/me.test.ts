import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyEvent } from "../src/billing/apply.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

describe("GET /v1/me announcement banner (design S17)", () => {
  it("has no banner until the admin sets one", async () => {
    const h = await setup();
    expect((await h.call("/v1/me")).body.banner).toBeNull();
  });

  it("returns the admin's banner with a same-site link", async () => {
    const h = await setup();
    await h.kv.KV.put(
      "flags",
      JSON.stringify({ banner: { text: " Video unblur is coming soon ", href: "/blog/video" } }),
    );
    expect((await h.call("/v1/me")).body.banner).toEqual({
      text: "Video unblur is coming soon",
      href: "/blog/video",
    });
  });

  it("drops off-site links and ignores empty banners", async () => {
    const h = await setup();
    await h.kv.KV.put(
      "flags",
      JSON.stringify({ banner: { text: "Sale", href: "https://evil.example" } }),
    );
    expect((await h.call("/v1/me")).body.banner).toEqual({ text: "Sale", href: null });
    const other = await setup();
    await other.kv.KV.put("flags", JSON.stringify({ banner: { text: "  " } }));
    expect((await other.call("/v1/me")).body.banner).toBeNull();
  });
});

describe("GET /v1/me consent and plan (spec 7.5, 9)", () => {
  const NOW = Date.UTC(2026, 9, 9, 12);
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("asks EU, EEA, UK and Swiss visitors for consent, and anyone we cannot place", async () => {
    const h = await setup();
    const required = async (country?: string) =>
      (await h.call("/v1/me", country ? { headers: { "cf-ipcountry": country } } : {})).body
        .consentRequired;
    expect(await required("DE")).toBe(true);
    expect(await required("NO")).toBe(true);
    expect(await required("GB")).toBe(true);
    expect(await required("CH")).toBe(true);
    expect(await required("US")).toBe(false);
    expect(await required("XX")).toBe(true);
    expect(await required()).toBe(true);
  });

  it("marks members with a live plan as paid", async () => {
    const h = await setup();
    const { userId, session } = await h.signIn("ann@example.com");
    expect((await h.call("/v1/me", { session })).body.paid).toBe(false);
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
    expect((await h.call("/v1/me", { session })).body.paid).toBe(true);
    expect((await h.call("/v1/me")).body.paid).toBe(false);
  });
});
