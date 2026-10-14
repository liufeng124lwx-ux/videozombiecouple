import { describe, expect, it } from "vitest";
import {
  minCreditPrice,
  PACKS,
  PRODUCTS,
  pricingGuard,
  productByKey,
  ROUTES,
  SALE_PRODUCTS,
  storyCostUsd,
} from "../src/index.ts";

describe("pricing (spec §7)", () => {
  it("finds the cheapest credit in the 10-video pack", () => {
    expect(minCreditPrice()).toBeCloseTo(29.99 / 100, 6);
  });

  it("makes bigger packs cheaper per video", () => {
    const perVideo = PACKS.map((p) => (p.usd / p.credits) * 10);
    expect([...perVideo].sort((a, b) => b - a)).toEqual(perVideo);
  });

  it("sells packs only, findable by product key", () => {
    expect(SALE_PRODUCTS.map((p) => p.key)).toEqual(["pack1", "pack3", "pack10"]);
    expect(productByKey("pack3")).toMatchObject({ kind: "pack", credits: 30, usd: 11.99 });
    // Plans stay known to the billing code but are not for sale.
    expect(PRODUCTS.some((p) => p.kind === "plan")).toBe(true);
  });

  it("counts four keyframe candidates for a preview and B plus four shots for a video", () => {
    const routes = ROUTES.map((r) => ({ ...r, costUsd: r.capability === "keyframe" ? 0.1 : 1 }));
    expect(storyCostUsd(routes)).toEqual({ preview: 0.4, video: 4.1 });
  });

  it("flags a video priced below twice its model cost", () => {
    const pricey = ROUTES.map((r) => ({ ...r, costUsd: r.capability === "shot" ? 1 : r.costUsd }));
    expect(pricingGuard(pricey)).toHaveLength(1);
    expect(pricingGuard()).toEqual([]);
  });
});
