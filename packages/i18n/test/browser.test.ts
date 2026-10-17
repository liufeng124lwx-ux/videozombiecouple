import { afterEach, describe, expect, it, vi } from "vitest";
import { en, hasMessages, t } from "../src/index.ts";

// This file never imports src/all.ts: like an island's bundle, it only has English.
describe("in the browser", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a translated page's strings from the page", () => {
    vi.stubGlobal("document", { documentElement: { lang: "pt" } });
    vi.stubGlobal("__vzcMessages", { ...en, "nav.pricing": "Preços" });
    expect(hasMessages("pt")).toBe(true);
    expect(t("nav.pricing")).toBe("Preços");
  });

  it("falls back to English when the page has no strings", () => {
    vi.stubGlobal("document", { documentElement: { lang: "pt" } });
    expect(t("nav.pricing")).toBe(en["nav.pricing"]);
  });
});
