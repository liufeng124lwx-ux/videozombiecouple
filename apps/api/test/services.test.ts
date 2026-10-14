import type { DatabaseSync } from "node:sqlite";
import { ROUTES } from "@vzc/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordAttempt } from "../src/services/analytics.ts";
import { providerKit } from "../src/services/provider-kit.ts";
import { guestCounters, quotaStatus, reserveQuota } from "../src/services/quota.ts";
import { loadRoutes } from "../src/services/routes-store.ts";
import { settle } from "../src/services/settle.ts";
import type { Bindings } from "../src/types.ts";
import { jpeg, setup } from "./harness.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const insertRoute = (db: DatabaseSync) =>
  db
    .prepare(
      "INSERT INTO provider_routes(id,capability,mode,rank,parallel,provider,model,params,timeout_ms,pad_aspect,credits_tier,aspects,cost_usd,label,enabled,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "unblur.std:seedream-2k:1",
      "unblur.std",
      null,
      1,
      0,
      "kie",
      "seedream/5-flash-image-to-image",
      JSON.stringify({ size: "2K", output_format: "png" }),
      90_000,
      1,
      "std",
      JSON.stringify(["1:1", "4:3"]),
      0.0162,
      "Seedream",
      0,
      Date.now(),
    );

describe("loadRoutes", () => {
  it("uses the catalog seeds while the table is empty", async () => {
    const h = await setup();
    const routes = await loadRoutes(h.env.DB as D1Database);
    expect(routes.map((r) => r.id)).toEqual(ROUTES.map((r) => r.id));
    expect(routes.every((r) => r.enabled)).toBe(true);
  });

  it("reads admin edits from D1 and caches them for 30 seconds", async () => {
    const h = await setup();
    await loadRoutes(h.env.DB as D1Database);
    insertRoute(h.db);
    expect((await loadRoutes(h.env.DB as D1Database)).length).toBe(ROUTES.length);
    vi.setSystemTime(Date.now() + 30_001);
    const routes = await loadRoutes(h.env.DB as D1Database);
    expect(routes).toEqual([
      expect.objectContaining({
        id: "unblur.std:seedream-2k:1",
        mode: null,
        parallel: false,
        params: { size: "2K", output_format: "png" },
        aspects: ["1:1", "4:3"],
        padAspect: true,
        enabled: false,
      }),
    ]);
  });
});

describe("providerKit", () => {
  it("copies the input as the output in FAKE_PROVIDER mode", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    await env.BUCKET.put("in/A.jpg", jpeg(100, 100));
    await providerKit(env).fetchOutput("https://fake.test/out.png", "in/A.jpg", "out/J/a1.png");
    expect(h.r2.objects.get("out/J/a1.png")?.body).toEqual(jpeg(100, 100));
  });

  it("downloads the real output into R2 and fails loudly on a bad download", async () => {
    const h = await setup({ FAKE_PROVIDER: undefined });
    const env = h.env as unknown as Bindings;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("ok.png")
          ? new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })
          : new Response("gone", { status: 404 }),
      ),
    );
    const kit = providerKit(env);
    await kit.fetchOutput("https://kie.example/ok.png", "in/A.jpg", "keep/J/a1.png");
    expect(h.r2.objects.get("keep/J/a1.png")).toEqual({
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });
    await expect(
      kit.fetchOutput("https://kie.example/missing.png", "in/A.jpg", "keep/J/a2.png"),
    ).rejects.toMatchObject({ kind: "provider_error" });
  });
});

describe("settle", () => {
  it("commits the guest's quota when a result was delivered and returns it otherwise", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const counters = guestCounters({ visitorHash: "v", fpHash: null, ipSegmentHash: "i" });
    const names = counters.map((c) => c.name);
    await reserveQuota(env, counters, "ok");
    await reserveQuota(env, counters, "bad");
    await settle(env, "ok", { kind: "quota", nonce: "ok", counters: names }, "std");
    await settle(env, "bad", { kind: "quota", nonce: "bad", counters: names }, null);
    expect((await quotaStatus(env, counters)).remaining).toBe(1);
  });

  it("charges the delivered tier's credits, never more than reserved", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const hold = { kind: "credits", userId: "u1", reservationId: "r1", reserved: 3 } as const;
    await settle(env, "j1", hold, "std");
    await settle(env, "j2", { ...hold, reservationId: "r2" }, "pro");
    await settle(env, "j3", { ...hold, reservationId: "r3" }, null);
    expect(h.wallet.calls).toEqual([
      ["commit", "u1", "r1", 1, "j1"],
      ["commit", "u1", "r2", 3, "j2"],
      ["release", "u1", "r3", "j3"],
    ]);
  });
});

describe("recordAttempt", () => {
  it("writes one Analytics Engine data point per model call", async () => {
    const h = await setup();
    recordAttempt(h.env as unknown as Bindings, {
      capability: "unblur.std",
      model: "seedream/5-flash-image-to-image",
      outcome: "failed",
      failKind: "timeout",
      freeRetry: false,
      costUsd: null,
      durationMs: 90_000,
    });
    expect(h.analytics).toEqual([
      {
        indexes: ["unblur.std"],
        blobs: ["unblur.std", "seedream/5-flash-image-to-image", "failed", "timeout", "paid"],
        doubles: [0, 90_000],
      },
    ]);
  });
});
