import { describe, expect, it } from "vitest";
import {
  defaultGuardInput,
  livePerks,
  minCreditPrice,
  PACKS,
  PLAN_IDS,
  PLANS,
  PRODUCTS,
  pricingGuard,
  productByKey,
  TIERS,
} from "../src/index.ts";

const cents = (usd: number) => Math.round(usd * 100);

describe("plans", () => {
  it("are Starter / Plus / Max with 150 / 450 / 1,200 monthly credits", () => {
    expect(PLAN_IDS.map((id) => [PLANS[id].label, PLANS[id].monthlyCredits])).toEqual([
      ["Starter", 150],
      ["Plus", 450],
      ["Max", 1200],
    ]);
  });

  it("bill exactly 12 monthly instalments per year, to the cent", () => {
    for (const id of PLAN_IDS) {
      const { year } = PLANS[id];
      expect(cents(year.usdPerMonth * 12)).toBe(cents(year.usd));
    }
  });

  it("make yearly about 20% cheaper than monthly", () => {
    for (const id of PLAN_IDS) {
      const discount = 1 - PLANS[id].year.usdPerMonth / PLANS[id].month.usd;
      expect(discount).toBeGreaterThan(0.195);
      expect(discount).toBeLessThan(0.205);
    }
  });

  it("make bigger packs cheaper per credit", () => {
    const perCredit = PACKS.map((p) => p.usd / p.credits);
    expect([...perCredit].sort((a, b) => b - a)).toEqual(perCredit);
  });

  it("only list perks that are live in the current phase", () => {
    expect(livePerks("P0").map((p) => p.id)).toEqual([
      "pro_quality",
      "4k",
      "priority_queue",
      "commercial",
    ]);
    expect(livePerks("P1").map((p) => p.id)).toContain("batch");
    expect(livePerks("P1").map((p) => p.id)).not.toContain("api");
  });
});

describe("pricing guard (spec 6.8)", () => {
  it("finds the cheapest credit in Max yearly: $47.9 / 1,200", () => {
    expect(minCreditPrice()).toBeCloseTo(47.9 / 1200, 6);
  });

  it("passes for every capability and route as configured", () => {
    expect(pricingGuard()).toEqual([]);
  });

  it("flags a tier priced below 1.5x its primary cost", () => {
    const input = defaultGuardInput();
    const violations = pricingGuard({
      ...input,
      tiers: { ...TIERS, pro: { ...TIERS.pro, credits: 1 } },
    });
    expect(violations).toContainEqual(
      expect.objectContaining({ capability: "unblur.pro", rule: "primary_margin" }),
    );
  });

  it("flags a fallback route that would lose money", () => {
    const input = defaultGuardInput();
    const routes = input.routes.map((r) =>
      r.id === "unblur.std:nano-banana-2-1k:2" ? { ...r, costUsd: 0.05 } : r,
    );
    expect(pricingGuard({ ...input, routes })).toContainEqual(
      expect.objectContaining({ route: "unblur.std:nano-banana-2-1k:2", rule: "route_no_loss" }),
    );
  });

  it("counts both Pro candidates in the primary cost", () => {
    const input = defaultGuardInput();
    // 3 credits x $0.0399 = $0.1197; both candidates cost $0.0562; x1.5 = $0.0843 → passes.
    // Doubling the Seedream candidate to $0.05 makes the pair $0.09 x 1.5 = $0.135 → fails.
    const routes = input.routes.map((r) =>
      r.id === "unblur.pro:seedream-2k:1" ? { ...r, costUsd: 0.05 } : r,
    );
    expect(pricingGuard({ ...input, routes })).toContainEqual(
      expect.objectContaining({ capability: "unblur.pro", rule: "primary_margin" }),
    );
  });
});

describe("products (spec 6.1)", () => {
  it("lists every plan interval and pack once, by product key", () => {
    expect(PRODUCTS.map((p) => p.key)).toEqual([
      "starter_month",
      "starter_year",
      "plus_month",
      "plus_year",
      "max_month",
      "max_year",
      "pack60",
      "pack200",
      "pack600",
    ]);
  });

  it("finds plans and packs by key", () => {
    expect(productByKey("plus_year")).toEqual({
      kind: "plan",
      key: "plus_year",
      plan: "plus",
      interval: "year",
      monthlyCredits: 450,
      usd: 238.8,
    });
    expect(productByKey("pack200")).toEqual({
      kind: "pack",
      key: "pack200",
      credits: 200,
      usd: 14.99,
    });
    expect(productByKey("gold")).toBeNull();
  });
});
