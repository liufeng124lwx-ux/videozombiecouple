import { SEEDREAM_ASPECTS } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { chargeTier, padAspects, planRoutes, type Route, seedRoutes } from "../src/index.ts";

const ids = (routes: Route[]) => routes.map((r) => r.id);
const disable = (routes: Route[], id: string) =>
  routes.map((r) => (r.id === id ? { ...r, enabled: false } : r));

describe("planRoutes", () => {
  it("runs Seedream first and Nano Banana 2 as the backup for Standard", () => {
    const plan = planRoutes(seedRoutes(), "unblur.std", "auto");
    expect(ids(plan.primary)).toEqual(["unblur.std:seedream-2k:1"]);
    expect(ids(plan.fallbacks)).toEqual(["unblur.std:nano-banana-2-1k:2"]);
  });

  it("runs both Pro candidates together", () => {
    const plan = planRoutes(seedRoutes(), "unblur.pro", "portrait");
    expect(ids(plan.primary).sort()).toEqual([
      "unblur.pro:nano-banana-pro-2k:1",
      "unblur.pro:seedream-2k:1",
    ]);
    expect(ids(plan.fallbacks)).toEqual(["unblur.pro:nano-banana-2-1k:3"]);
  });

  it("prefers routes set for the mode, else the general ones", () => {
    const routes = [
      ...seedRoutes(),
      { ...seedRoutes()[0], id: "unblur.std:text-special:1", mode: "text" } as Route,
    ];
    expect(ids(planRoutes(routes, "unblur.std", "text").primary)).toEqual([
      "unblur.std:text-special:1",
    ]);
    expect(ids(planRoutes(routes, "unblur.std", "auto").primary)).toEqual([
      "unblur.std:seedream-2k:1",
    ]);
  });

  // Review focus 5: an admin switched the primary off.
  it("promotes the next rank when the primary is disabled", () => {
    const routes = disable(seedRoutes(), "unblur.std:seedream-2k:1");
    const plan = planRoutes(routes, "unblur.std", "auto");
    expect(ids(plan.primary)).toEqual(["unblur.std:nano-banana-2-1k:2"]);
    expect(plan.fallbacks).toEqual([]);
  });

  it("keeps the other Pro candidate when one is disabled", () => {
    const routes = disable(seedRoutes(), "unblur.pro:nano-banana-pro-2k:1");
    expect(ids(planRoutes(routes, "unblur.pro", "auto").primary)).toEqual([
      "unblur.pro:seedream-2k:1",
    ]);
  });

  it("throws only when every route for the capability is disabled", () => {
    const routes = seedRoutes().map((r) =>
      r.capability === "unblur.4k" ? { ...r, enabled: false } : r,
    );
    expect(() => planRoutes(routes, "unblur.4k", "auto")).toThrow(/unblur.4k/);
  });
});

describe("padAspects (spec 3.1)", () => {
  it("uses the ratios every route of the capability accepts", () => {
    for (const capability of ["unblur.std", "unblur.pro", "unblur.4k"] as const) {
      expect(padAspects(seedRoutes(), capability)).toEqual({
        pad: true,
        aspects: [...SEEDREAM_ASPECTS],
      });
    }
  });

  it("stops padding the whole capability if any route opts out", () => {
    const routes = seedRoutes().map((r) =>
      r.id === "unblur.std:nano-banana-2-1k:2" ? { ...r, padAspect: false } : r,
    );
    expect(padAspects(routes, "unblur.std").pad).toBe(false);
  });
});

describe("chargeTier", () => {
  const byId = (id: string) => seedRoutes().find((r) => r.id === id) as Route;

  it("charges Pro when the Pro candidate delivered", () => {
    expect(
      chargeTier([byId("unblur.pro:seedream-2k:1"), byId("unblur.pro:nano-banana-pro-2k:1")]),
    ).toBe("pro");
  });

  it("charges Standard when only the Seedream candidate delivered", () => {
    expect(chargeTier([byId("unblur.pro:seedream-2k:1")])).toBe("std");
  });

  it("charges nothing when nothing delivered", () => {
    expect(chargeTier([])).toBeNull();
  });
});

describe("review fixes", () => {
  it("pads to ratios every route accepts, even while one is disabled (spec 3.1)", () => {
    const routes = disable(seedRoutes(), "unblur.std:seedream-2k:1");
    expect(padAspects(routes, "unblur.std").aspects).toEqual([...SEEDREAM_ASPECTS]);
  });

  it("keeps the general fallbacks when a mode overrides only the primary (spec 4.3)", () => {
    const routes = [
      ...seedRoutes(),
      { ...seedRoutes()[0], id: "unblur.std:text-special:1", mode: "text" } as Route,
    ];
    const plan = planRoutes(routes, "unblur.std", "text");
    expect(ids(plan.primary)).toEqual(["unblur.std:text-special:1"]);
    expect(ids(plan.fallbacks)).toEqual(["unblur.std:nano-banana-2-1k:2"]);
  });

  it("submits only one primary when the lowest-rank routes are not parallel (spec 4.5)", () => {
    const extra = { ...seedRoutes()[0], id: "unblur.std:seedream-2k-b:1" } as Route;
    const plan = planRoutes([...seedRoutes(), extra], "unblur.std", "auto");
    expect(ids(plan.primary)).toEqual(["unblur.std:seedream-2k-b:1"]);
    expect(ids(plan.fallbacks)).toEqual([
      "unblur.std:seedream-2k:1",
      "unblur.std:nano-banana-2-1k:2",
    ]);
  });
});
