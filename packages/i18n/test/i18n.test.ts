import { fact } from "@vzc/catalog";
import { ERROR_CODES } from "@vzc/contracts";
import { describe, expect, it } from "vitest";
import { en, errorMessage, hasMessages, t } from "../src/index.ts";

describe("i18n (spec 2.3)", () => {
  it("fills params", () => {
    expect(t("footer.copyright", { year: 2026 })).toBe("© 2026 Arrayon Inc.");
  });

  it("has a message for every API error code, plus network trouble", () => {
    for (const code of [...ERROR_CODES, "NETWORK"])
      expect(Object.keys(en)).toContain(`error.${code}`);
  });

  it("falls back to the internal error for codes it does not know", () => {
    expect(errorMessage("SOMETHING_NEW")).toBe(en["error.INTERNAL"]);
  });

  it("puts catalog numbers into error messages", () => {
    expect(errorMessage("FILE_TOO_LARGE")).toContain(`${fact("file.maxMb")} MB`);
    expect(errorMessage("RATE_LIMITED", { seconds: 30 })).toContain("30 seconds");
  });

  it("never hard-codes a number (spec 2.2); the tier name 4K is a name", () => {
    for (const [key, value] of Object.entries(en))
      expect(value.replaceAll("4K", ""), key).not.toMatch(/\d/);
  });

  it("knows which locales it can build", () => {
    expect(hasMessages("en")).toBe(true);
    expect(hasMessages("es")).toBe(false);
    expect(() => t("nav.tools", {}, "es")).toThrow("No UI messages for es");
  });
});
