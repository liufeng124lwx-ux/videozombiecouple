import { seedRoutes } from "@vzc/providers";
import { describe, expect, it } from "vitest";
import { routeSyncSql } from "../scripts/route-sync.ts";
import { forgetRoutes, loadRoutes, saveRoute } from "../src/services/routes-store.ts";
import { setup } from "./harness.ts";

describe("route sync on deploy (spec 4.5)", () => {
  it("brings catalog changes in and keeps the admin's switches, order and timeouts", async () => {
    const h = await setup();
    const db = h.env.DB as D1Database;
    const seeds = seedRoutes();
    const [first, second] = seeds;
    if (!first || !second) throw new Error("need two routes");
    await saveRoute(db, first.id, { enabled: false, rank: 7, timeoutMs: 99_000 });
    // A route the catalog no longer has.
    h.db
      .prepare(
        "INSERT INTO provider_routes SELECT 'gone', capability, mode, rank, parallel, provider, model, params, timeout_ms, pad_aspect, credits_tier, aspects, cost_usd, label, enabled, updated_at, durations FROM provider_routes WHERE id=?",
      )
      .run(second.id);
    const changed = seeds.map((r) =>
      r.id === first.id ? { ...r, model: "new-model", costUsd: 0.05 } : r,
    );
    h.db.exec(routeSyncSql(changed));
    forgetRoutes(db);
    const routes = await loadRoutes(db);
    expect(routes.map((r) => r.id).sort()).toEqual(seeds.map((r) => r.id).sort());
    expect(routes.find((r) => r.id === first.id)).toMatchObject({
      model: "new-model",
      costUsd: 0.05,
      enabled: false,
      rank: 7,
      timeoutMs: 99_000,
    });
    expect(routes.find((r) => r.id === second.id)).toMatchObject({
      model: second.model,
      enabled: second.enabled,
      rank: second.rank,
    });
    // Video routes keep their clip length limits through the sync.
    for (const seed of seeds.filter((r) => r.capability === "shot"))
      expect(routes.find((r) => r.id === seed.id)).toMatchObject({
        minSec: seed.minSec,
        maxSec: seed.maxSec,
      });
  });

  it("writes the seeds into an empty table", async () => {
    const h = await setup();
    h.db.exec(routeSyncSql(seedRoutes()));
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM provider_routes").get()).toEqual({
      n: seedRoutes().length,
    });
  });

  it("escapes quotes in what it writes", () => {
    const [route] = seedRoutes();
    if (!route) throw new Error("no routes");
    expect(routeSyncSql([{ ...route, label: "it's" }])).toContain("'it''s'");
  });

  it("syncs the two describe routes like any other row, with no aspects", async () => {
    const h = await setup();
    const describes = seedRoutes().filter((r) => r.capability === "describe");
    expect(describes.map((r) => r.id).sort()).toEqual([
      "describe:claude-haiku:1",
      "describe:gemini-flash:2",
    ]);
    const db = h.env.DB as D1Database;
    h.db.exec(routeSyncSql(seedRoutes()));
    forgetRoutes(db);
    const routes = await loadRoutes(db);
    for (const seed of describes)
      expect(routes.find((r) => r.id === seed.id)).toMatchObject({
        model: seed.model,
        aspects: [],
        enabled: true,
        timeoutMs: seed.timeoutMs,
      });
  });
});
