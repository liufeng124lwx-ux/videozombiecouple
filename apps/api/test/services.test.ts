import type { DatabaseSync } from "node:sqlite";
import { ROUTES } from "@vzc/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordAttempt } from "../src/services/analytics.ts";
import { providerKit } from "../src/services/provider-kit.ts";
import { previewCounters, quotaStatus, reserveQuota } from "../src/services/quota.ts";
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
      "INSERT INTO provider_routes(id,capability,mode,rank,parallel,provider,model,params,timeout_ms,pad_aspect,credits_tier,aspects,cost_usd,label,enabled,updated_at,durations) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "shot:wan-2-7:1",
      "shot",
      null,
      1,
      0,
      "kie",
      "wan/2-7-image-to-video",
      JSON.stringify({ resolution: "720p" }),
      300_000,
      0,
      "video",
      JSON.stringify(["9:16"]),
      0.35,
      "Wan",
      0,
      Date.now(),
      JSON.stringify({ minSec: 2, maxSec: 15 }),
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
        id: "shot:wan-2-7:1",
        mode: null,
        parallel: false,
        params: { resolution: "720p" },
        aspects: ["9:16"],
        minSec: 2,
        maxSec: 15,
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
  it("commits the preview quota when a preview was delivered and returns it otherwise", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const counters = previewCounters("u1", "i");
    const names = counters.map((c) => c.name);
    await reserveQuota(env, counters, "ok");
    await reserveQuota(env, counters, "bad");
    await settle(env, "ok", { kind: "quota", nonce: "ok", counters: names }, 0);
    await settle(env, "bad", { kind: "quota", nonce: "bad", counters: names }, null);
    expect((await quotaStatus(env, counters)).remaining).toBe(2);
  });

  it("charges the delivered credits, never more than reserved", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const hold = { kind: "credits", userId: "u1", reservationId: "r1", reserved: 10 } as const;
    await settle(env, "s1", hold, 4);
    await settle(env, "s2", { ...hold, reservationId: "r2" }, 30);
    await settle(env, "s3", { ...hold, reservationId: "r3" }, null);
    expect(h.wallet.calls).toEqual([
      ["commit", "u1", "r1", 4, "s1"],
      ["commit", "u1", "r2", 10, "s2"],
      ["release", "u1", "r3", "s3"],
    ]);
  });
});

describe("recordAttempt", () => {
  it("writes one Analytics Engine data point per model call", async () => {
    const h = await setup();
    recordAttempt(h.env as unknown as Bindings, {
      capability: "keyframe",
      model: "nano-banana-pro",
      outcome: "failed",
      failKind: "timeout",
      free: false,
      costUsd: null,
      durationMs: 90_000,
    });
    recordAttempt(h.env as unknown as Bindings, {
      capability: "keyframe",
      model: "gpt-image-2-image-to-image",
      outcome: "succeeded",
      failKind: null,
      free: true,
      costUsd: 0.015,
      durationMs: 70_000,
    });
    expect(h.analytics).toEqual([
      {
        indexes: ["keyframe"],
        blobs: ["keyframe", "nano-banana-pro", "failed", "timeout", "paid"],
        doubles: [0, 90_000],
      },
      {
        indexes: ["keyframe"],
        blobs: ["keyframe", "gpt-image-2-image-to-image", "succeeded", "", "free"],
        doubles: [0.015, 70_000],
      },
    ]);
  });
});
