import { describe, expect, it } from "vitest";
import { effectiveConsent, needsBanner, saveConsent, storedConsent } from "./consent.ts";

describe("cookie consent (spec 7.5)", () => {
  it("starts EU visitors opted out and everyone else opted in, until they choose", () => {
    expect(effectiveConsent(null, true)).toBe("denied");
    expect(effectiveConsent(null, false)).toBe("granted");
    expect(effectiveConsent("granted", true)).toBe("granted");
    expect(effectiveConsent("denied", false)).toBe("denied");
  });

  it("shows the banner only to visitors who must choose and have not", () => {
    expect(needsBanner(null, true)).toBe(true);
    expect(needsBanner("denied", true)).toBe(false);
    expect(needsBanner(null, false)).toBe(false);
  });

  it("remembers the choice in a first-party cookie", () => {
    expect(storedConsent()).toBeNull();
    saveConsent("denied");
    expect(storedConsent()).toBe("denied");
    expect(document.cookie).toContain("upx_consent=denied");
  });
});
