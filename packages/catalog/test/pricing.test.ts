import { describe, expect, it } from "vitest";
import {
  CHRISTMAS,
  filmCostUsd,
  minCreditPrice,
  netPerCreditUsd,
  netPerVideoUsd,
  PACKS,
  PAYMENT_FEE,
  PRODUCTS,
  pricingGuard,
  productByKey,
  ROUTES,
  SALE_PRODUCTS,
  saleProducts,
  storyCostUsd,
  VIDEO_PACKS,
  ZOMBIE,
} from "../src/index.ts";

const synthetic = ROUTES.map((r) => ({
  ...r,
  costUsd: r.capability === "keyframe" ? 0.1 : r.capability === "shot" ? 1 : 0,
}));

describe("pricing (spec §7, christmas spec §6)", () => {
  it("finds the cheapest credit in the 5-video pack", () => {
    expect(minCreditPrice()).toBeCloseTo(21.99 / 50, 6);
  });

  it("makes bigger video packs cheaper per video", () => {
    const perVideo = VIDEO_PACKS.map((p) => (p.usd / p.credits) * 10);
    expect([...perVideo].sort((a, b) => b - a)).toEqual(perVideo);
  });

  it("sells the video packs; the Christmas film only once a Christmas scene is live", () => {
    expect(SALE_PRODUCTS.map((p) => p.key)).toEqual(["pack1", "pack3", "pack5"]);
    const scene = CHRISTMAS.scenes["snow-cabin"];
    if (!scene) throw new Error("no snow-cabin");
    const was = scene.live;
    try {
      (scene as { live: boolean }).live = true;
      expect(saleProducts().map((p) => p.key)).toEqual(["pack1", "pack3", "pack5", "christmas1"]);
    } finally {
      (scene as { live: boolean }).live = was;
    }
  });

  it("knows the Christmas film by product key even when it is not for sale", () => {
    expect(productByKey("christmas1")).toMatchObject({ kind: "pack", credits: 20, usd: 9.99 });
    expect(VIDEO_PACKS.map((p) => p.id)).toEqual(["pack1", "pack3", "pack5"]);
    expect(PACKS.find((p) => p.id === "christmas1")?.story).toBe("christmas");
    expect(PRODUCTS.some((p) => p.kind === "plan")).toBe(true);
  });

  it("a zombie film is four candidates, B and five 3-second shots", () => {
    expect(storyCostUsd(synthetic).video).toBeCloseTo(5.5);
    expect(storyCostUsd(synthetic, ZOMBIE).video).toBeCloseTo(5.5);
  });

  it("a Christmas film is eleven keyframes and 25 seconds of shots; clips cost nothing", () => {
    // 11 × 0.1 + (3+3+4+4+3+4+4)/3 × 1
    expect(storyCostUsd(synthetic, CHRISTMAS).video).toBeCloseTo(1.1 + 25 / 3, 6);
  });

  it("nets each pack after Stripe's fees (worst case 7.9% + $0.30)", () => {
    expect(PAYMENT_FEE).toEqual({ rate: 0.079, fixedUsd: 0.3 });
    const pack1 = PACKS[0];
    if (!pack1) throw new Error("no pack1");
    expect(netPerVideoUsd(pack1)).toBeCloseTo((4.99 * 0.921 - 0.3) / 1, 3);
    const xmas = PACKS.find((p) => p.id === "christmas1");
    if (!xmas) throw new Error("no christmas1");
    expect(netPerCreditUsd(xmas) * 20).toBeCloseTo(9.99 * 0.921 - 0.3, 3);
  });

  it("counts free remakes and testing in the cost of a film", () => {
    expect(filmCostUsd()).toBeCloseTo(1.125 * 1.3 + 0.3, 3);
    expect(filmCostUsd(ROUTES, CHRISTMAS)).toBeCloseTo(
      storyCostUsd(ROUTES, CHRISTMAS).video * 1.3 + 0.3,
      6,
    );
  });

  it("refuses a pack that nets less than twice the full cost, per story", () => {
    const cheap = [...PACKS, { id: "pack10", credits: 100, usd: 19.99, productKey: "pack10" }];
    const found = pricingGuard(ROUTES, cheap).map((v) => `${v.story}:${v.pack}`);
    expect(found).toContain("zombie:pack10");
    expect(found).toContain("christmas:pack10");
    expect(pricingGuard()).toEqual([]);
  });

  it("flags every story when shots get expensive", () => {
    const pricey = ROUTES.map((r) => ({
      ...r,
      costUsd: r.capability === "shot" ? 1 : r.costUsd,
    }));
    const stories = new Set(pricingGuard(pricey).map((v) => v.story));
    expect(stories).toEqual(new Set(["zombie", "christmas"]));
  });
});
