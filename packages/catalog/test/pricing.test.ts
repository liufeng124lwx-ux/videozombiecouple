import { describe, expect, it } from "vitest";
import {
  filmCostUsd,
  minCreditPrice,
  netPerVideoUsd,
  PACKS,
  PRODUCTS,
  pricingGuard,
  productByKey,
  ROUTES,
  SALE_PRODUCTS,
  storyCostUsd,
} from "../src/index.ts";

describe("pricing (spec §7)", () => {
  it("finds the cheapest credit in the 5-video pack", () => {
    expect(minCreditPrice()).toBeCloseTo(21.99 / 50, 6);
  });

  it("makes bigger packs cheaper per video", () => {
    const perVideo = PACKS.map((p) => (p.usd / p.credits) * 10);
    expect([...perVideo].sort((a, b) => b - a)).toEqual(perVideo);
  });

  it("sells packs only, findable by product key", () => {
    expect(SALE_PRODUCTS.map((p) => p.key)).toEqual(["pack1", "pack3", "pack5"]);
    expect(productByKey("pack3")).toMatchObject({ kind: "pack", credits: 30, usd: 13.99 });
    // Plans stay known to the billing code but are not for sale.
    expect(PRODUCTS.some((p) => p.kind === "plan")).toBe(true);
  });

  it("a paid film is four keyframe candidates, B and five shots; nothing is free", () => {
    const routes = ROUTES.map((r) => ({ ...r, costUsd: r.capability === "keyframe" ? 0.1 : 1 }));
    expect(storyCostUsd(routes).video).toBeCloseTo(5.5);
    expect(storyCostUsd(routes)).not.toHaveProperty("preview");
  });

  it("nets each pack after Waffo's fees (5% + $0.50 a payment, 1% payout)", () => {
    expect(
      netPerVideoUsd({ id: "pack1", credits: 10, usd: 4.99, productKey: "pack1" }),
    ).toBeCloseTo(4.2, 2);
    expect(
      netPerVideoUsd({ id: "pack5", credits: 50, usd: 21.99, productKey: "pack5" }),
    ).toBeCloseTo(4.04, 2);
  });

  it("counts free remakes and testing in the cost of a film", () => {
    // 1.125 of models, 30% of films remade once, $0.30 a film for evals and example films.
    expect(filmCostUsd()).toBeCloseTo(1.125 * 1.3 + 0.3, 3);
  });

  it("refuses a pack that nets less than twice the full cost of a film", () => {
    const cheap = [...PACKS, { id: "pack10", credits: 100, usd: 29.99, productKey: "pack10" }];
    expect(pricingGuard(ROUTES, cheap)).toEqual([
      expect.objectContaining({ rule: "video_margin", pack: "pack10" }),
    ]);
  });

  it("flags a video priced below twice its model cost", () => {
    const pricey = ROUTES.map((r) => ({ ...r, costUsd: r.capability === "shot" ? 1 : r.costUsd }));
    expect(pricingGuard(pricey).map((v) => v.pack)).toEqual(["pack1", "pack3", "pack5"]);
    expect(pricingGuard()).toEqual([]);
  });
});
