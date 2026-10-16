import { describe, expect, it } from "vitest";
import {
  BUDGETS,
  CAPABILITIES,
  CAPABILITY_IDS,
  KIE_KEY_DAILY_CAP_USD,
  KIE_KEY_RESET_UTC_HOUR,
  SPEND_CAPS,
} from "../src/index.ts";

describe("cost guardrails (cost-guardrails spec 3, 4, 8)", () => {
  it("keeps the budget floors under the kie key's daily cap, so our pause comes first", () => {
    const live =
      BUDGETS.free.dailyUsd +
      BUDGETS.paid.floorUsd +
      (BUDGETS.chat.live ? BUDGETS.chat.dailyUsd : 0);
    expect(live).toBeLessThanOrEqual(KIE_KEY_DAILY_CAP_USD);
    expect(
      BUDGETS.free.dailyUsd + BUDGETS.paid.floorUsd + BUDGETS.chat.dailyUsd,
    ).toBeLessThanOrEqual(KIE_KEY_DAILY_CAP_USD);
  });

  it("gives new payers a lower daily cap than everyone else", () => {
    expect(SPEND_CAPS.newPayerDailyCredits).toBeLessThan(SPEND_CAPS.dailyCredits);
    expect(SPEND_CAPS.newPayerDays).toBeGreaterThan(0);
  });

  it("keeps two dispatcher pools, images and videos; describe is a synchronous text call", () => {
    expect(CAPABILITY_IDS.map((id) => CAPABILITIES[id].pool)).toEqual([
      "kie-image",
      "kie-video",
      "kie-text",
    ]);
  });

  it("warns before pausing", () => {
    expect(BUDGETS.warnShare).toBeGreaterThan(0);
    expect(BUDGETS.warnShare).toBeLessThan(1);
    expect(BUDGETS.paid.avgFactor).toBeGreaterThan(1);
  });

  it("keeps kie's key reset at a whole UTC hour", () => {
    expect(Number.isInteger(KIE_KEY_RESET_UTC_HOUR)).toBe(true);
    expect(KIE_KEY_RESET_UTC_HOUR).toBeGreaterThanOrEqual(0);
    expect(KIE_KEY_RESET_UTC_HOUR).toBeLessThan(24);
  });
});
