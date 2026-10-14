import { describe, expect, it } from "vitest";
import {
  CONSENT_COUNTRIES,
  fact,
  facts,
  interpolate,
  LOCAL_TOOLS,
  PLANS,
  QUOTA,
  REFUND_POLICY,
  TIERS,
  usd,
} from "../src/index.ts";

describe("facts (spec 2.2: numbers on pages come from the catalog)", () => {
  it("formats prices the way the pricing page shows them", () => {
    expect(usd(9.9)).toBe("$9.9");
    expect(usd(4.99)).toBe("$4.99");
    expect(usd(94.8)).toBe("$94.8");
    expect(usd(15)).toBe("$15");
  });

  it("reads every number from the catalog", () => {
    expect(fact("quota.guestDaily")).toBe(String(QUOTA.guestDaily));
    expect(fact("tier.pro.credits")).toBe(String(TIERS.pro.credits));
    expect(fact("tier.std.resolution")).toBe("2K");
    expect(fact("tier.4k.resolution")).toBe("4K");
    expect(fact("plan.max.credits")).toBe("1,200");
    expect(fact("plan.starter.monthly")).toBe(usd(PLANS.starter.month.usd));
    expect(fact("plan.starter.yearly")).toBe("$94.8");
    expect(fact("plan.starter.yearlyPerMonth")).toBe("$7.9");
    expect(fact("plan.plus.proPhotos")).toBe("150");
    expect(fact("pack.pack60.usd")).toBe("$4.99");
    expect(fact("pack.pack200.proPhotos")).toBe("66");
    expect(fact("file.maxMb")).toBe("20");
    expect(fact("retention.freeHours")).toBe("24");
    expect(fact("refund.subscriptionMaxUsed")).toBe("20%");
    expect(fact("gif.target1")).toBe("256 KB");
    expect(fact("gif.target2")).toBe("1 MB");
    expect(fact("gif.maxFiles")).toBe("20");
    expect(fact("price.minPerCredit")).toBe("$0.040");
  });

  it("throws on a key it does not know, so a typo fails the build", () => {
    expect(() => fact("quota.guestDialy")).toThrow('Unknown fact "quota.guestDialy"');
  });

  it("fills {{key}} placeholders and leaves other braces alone", () => {
    expect(interpolate("{{quota.guestDaily}} free a day, {{ tier.pro.credits }} for Pro")).toBe(
      "2 free a day, 3 for Pro",
    );
    expect(interpolate("{not a fact}")).toBe("{not a fact}");
    expect(() => interpolate("{{nope}}")).toThrow("Unknown fact");
  });

  it("has no empty values", () => {
    for (const [key, value] of Object.entries(facts())) expect(value, key).not.toBe("");
  });
});

describe("policies", () => {
  it("match the refund policy in spec 6.6", () => {
    expect(REFUND_POLICY).toEqual({
      packDays: 7,
      subscriptionDays: 7,
      subscriptionMaxUsedShare: 0.2,
    });
  });

  it("match the GIF tool in design S16", () => {
    expect(LOCAL_TOOLS.compressGif.targetsKb).toEqual([256, 1024, 5120]);
    expect(LOCAL_TOOLS.compressGif.targetsKb).toContain(LOCAL_TOOLS.compressGif.defaultTargetKb);
  });

  it("ask for cookie consent in the EU, EEA, UK and Switzerland only (spec 7.5)", () => {
    expect(CONSENT_COUNTRIES.size).toBe(32);
    for (const code of ["DE", "FR", "IE", "NO", "IS", "LI", "GB", "CH"])
      expect(CONSENT_COUNTRIES.has(code)).toBe(true);
    for (const code of ["US", "BR", "JP", "IN"]) expect(CONSENT_COUNTRIES.has(code)).toBe(false);
  });
});
