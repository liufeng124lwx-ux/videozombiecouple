import { describe, expect, it } from "vitest";
import { planRoutes, type Route, seedRoutes } from "../src/index.ts";

const ids = (routes: Route[]) => routes.map((r) => r.id);
const disable = (routes: Route[], id: string) =>
  routes.map((r) => (r.id === id ? { ...r, enabled: false } : r));

describe("planRoutes", () => {
  it("runs the rank-1 keyframe route first with the others as fallbacks, in rank order", () => {
    const plan = planRoutes(seedRoutes(), "keyframe", "human");
    expect(ids(plan.primary)).toEqual(["keyframe:nano-banana-pro:1"]);
    expect(ids(plan.fallbacks)).toEqual(["keyframe:nano-banana-2:2", "keyframe:seedream-5-pro:3"]);
  });

  it("plans shots from the shot routes only", () => {
    const plan = planRoutes(seedRoutes(), "shot", "human");
    expect([...plan.primary, ...plan.fallbacks].every((r) => r.capability === "shot")).toBe(true);
  });

  it("prefers routes set for the kind, and keeps the general fallbacks", () => {
    const special = { ...seedRoutes()[0], id: "keyframe:pet-special:1", mode: "pet" } as Route;
    const routes = [...seedRoutes(), special];
    const pet = planRoutes(routes, "keyframe", "pet");
    expect(ids(pet.primary)).toEqual(["keyframe:pet-special:1"]);
    expect(ids(pet.fallbacks)).toEqual(["keyframe:nano-banana-2:2", "keyframe:seedream-5-pro:3"]);
    expect(ids(planRoutes(routes, "keyframe", "human").primary)).toEqual([
      "keyframe:nano-banana-pro:1",
    ]);
  });

  it("promotes the next rank when the primary is disabled", () => {
    const plan = planRoutes(
      disable(seedRoutes(), "keyframe:nano-banana-pro:1"),
      "keyframe",
      "human",
    );
    expect(ids(plan.primary)).toEqual(["keyframe:nano-banana-2:2"]);
  });

  it("submits routes together only when the lowest rank is marked parallel", () => {
    const routes = seedRoutes().map((r) =>
      r.capability === "keyframe" && r.rank <= 2 ? { ...r, rank: 1, parallel: true } : r,
    );
    expect(ids(planRoutes(routes, "keyframe", "human").primary).sort()).toEqual([
      "keyframe:nano-banana-2:2",
      "keyframe:nano-banana-pro:1",
    ]);
  });

  it("throws only when every route for the capability is disabled", () => {
    const routes = seedRoutes().map((r) =>
      r.capability === "shot" ? { ...r, enabled: false } : r,
    );
    expect(() => planRoutes(routes, "shot", "human")).toThrow(/shot/);
  });
});
