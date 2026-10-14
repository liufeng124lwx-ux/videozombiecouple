import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  CAPABILITY_IDS,
  MODE_IDS,
  ROUTES,
  SEEDREAM_ASPECTS,
  TIERS,
} from "../src/index.ts";

const routesOf = (id: string) => ROUTES.filter((r) => r.capability === id);

describe("capabilities", () => {
  it("has the three P0 unblur capabilities", () => {
    expect(CAPABILITY_IDS).toEqual(["unblur.std", "unblur.pro", "unblur.4k"]);
    for (const id of CAPABILITY_IDS) expect(CAPABILITIES[id].id).toBe(id);
  });

  it("only the standard tier uses the daily free quota", () => {
    expect(CAPABILITY_IDS.filter((id) => CAPABILITIES[id].usesDailyQuota)).toEqual(["unblur.std"]);
  });
});

describe("routes", () => {
  it("every route points at a known capability and mode", () => {
    for (const r of ROUTES) {
      expect(CAPABILITY_IDS).toContain(r.capability);
      if (r.mode !== null) expect(MODE_IDS).toContain(r.mode);
    }
  });

  it("route ids are unique", () => {
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length);
  });

  it("every capability has a primary route and at least one fallback (spec 4.5)", () => {
    for (const id of CAPABILITY_IDS) {
      const ranks = routesOf(id).map((r) => r.rank);
      const min = Math.min(...ranks);
      expect(ranks.some((rank) => rank > min)).toBe(true);
    }
  });

  it("runs two candidates in parallel only for Pro (spec 3.7)", () => {
    for (const id of CAPABILITY_IDS) {
      const parallel = routesOf(id).filter((r) => r.parallel);
      if (CAPABILITIES[id].parallelCandidates) {
        expect(parallel.map((r) => r.model).sort()).toEqual([
          "nano-banana-pro",
          "seedream/5-flash-image-to-image",
        ]);
        expect(new Set(parallel.map((r) => r.rank))).toEqual(new Set([1]));
      } else {
        expect(parallel).toEqual([]);
      }
    }
  });

  it("never charges more on a route than the capability's tier", () => {
    for (const r of ROUTES) {
      expect(TIERS[r.creditsTier].credits).toBeLessThanOrEqual(
        TIERS[CAPABILITIES[r.capability].tier].credits,
      );
    }
  });

  it("charges the standard tier whenever it falls back to a cheaper model", () => {
    const fallbacks = ROUTES.filter((r) => r.rank > 1);
    for (const r of fallbacks) expect(r.creditsTier).toBe("std");
  });

  it("asks Nano Banana Pro for 4K on the 4K route and waits up to 180s for the Pro candidate", () => {
    const k4 = routesOf("unblur.4k").find((r) => r.rank === 1);
    expect(k4?.model).toBe("nano-banana-pro");
    expect(k4?.params.resolution).toBe("4K");
    const nbp = routesOf("unblur.pro").find((r) => r.model === "nano-banana-pro");
    expect(nbp?.timeoutMs).toBe(180_000);
  });

  it("every route lists aspect ratios that include all of Seedream's (so padding can share one set)", () => {
    for (const r of ROUTES) for (const a of SEEDREAM_ASPECTS) expect(r.aspects).toContain(a);
  });

  it("uses png output, which every model accepts", () => {
    for (const r of ROUTES) expect(r.params.output_format).toBe("png");
  });
});
