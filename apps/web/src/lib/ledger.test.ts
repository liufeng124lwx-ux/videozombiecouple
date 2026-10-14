import type { LedgerEntryView } from "@vzc/contracts";
import { describe, expect, it } from "vitest";
import { dateTime, shortDate, signedCredits } from "./format.ts";
import { ledgerAmount, ledgerLabel } from "./ledger.ts";

const entry = (type: string, reason: string | null, delta = 1): LedgerEntryView => ({
  id: 1,
  delta,
  type,
  reason,
  jobId: null,
  orderId: null,
  createdAt: 0,
});

describe("ledger labels (spec 5.5)", () => {
  it("names grants by what was bought", () => {
    expect(ledgerLabel(entry("grant", "pack3"))).toBe("Video pack");
    expect(ledgerLabel(entry("grant", "pack60"))).toBe("Videos added");
    expect(ledgerLabel(entry("grant", "plus_month"))).toBe("Plus plan credits");
    expect(ledgerLabel(entry("grant", "max_year_monthly"))).toBe("Max plan credits");
    expect(ledgerLabel(entry("grant", "upgrade_to_max_month"))).toBe("Upgrade to Max");
    expect(ledgerLabel(entry("grant", "signup"))).toBe("Sign-up bonus");
    expect(ledgerLabel(entry("grant", "dispute_won"))).toBe(
      "Videos restored after a payment dispute",
    );
  });

  it("names story videos, returns, expiry and refunds", () => {
    expect(ledgerLabel(entry("reserve", null, -10))).toBe("Story video");
    expect(ledgerLabel(entry("release", null, 10))).toBe("Returned: the video didn’t finish");
    expect(ledgerLabel(entry("expire", "subscription_renewed", -40))).toBe(
      "Last period’s plan credits ended",
    );
    expect(ledgerLabel(entry("clawback", "refund", -60))).toBe("Taken back after a refund");
    expect(ledgerLabel(entry("mystery", null))).toBe("Balance change");
  });

  it("shows whole videos as videos and anything else as credits (10 credits = 1 video)", () => {
    expect(ledgerAmount(30)).toBe("+3 videos");
    expect(ledgerAmount(-10)).toBe("−1 video");
    expect(ledgerAmount(10)).toBe("+1 video");
    expect(ledgerAmount(-7)).toBe("−7 credits");
  });
});

describe("formatting (design §12)", () => {
  it("formats dates in the visitor's locale and time zone", () => {
    const at = Date.UTC(2026, 10, 8, 10, 42);
    expect(shortDate(at, "en-US", "UTC")).toBe("Nov 8");
    expect(dateTime(at, "en-US", "UTC")).toBe("Nov 8, 10:42 AM");
  });

  it("signs credit changes with a real minus", () => {
    expect(signedCredits(60)).toBe("+60");
    expect(signedCredits(-3)).toBe("−3");
  });

  it("calls an admin change an adjustment", () => {
    expect(ledgerLabel(entry("admin_adjust", "admin", -3))).toBe("Adjusted by support");
  });
});
