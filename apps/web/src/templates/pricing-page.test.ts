import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("PricingPage", () => {
  it("hydrates the pack rows on load, so ?buy= continues right after sign-in", () => {
    const source = readFileSync(join(import.meta.dirname, "PricingPage.astro"), "utf8");
    expect(source).toMatch(/<PackRows client:load/);
  });
  it("takes every number from the catalog", () => {
    const source = readFileSync(join(import.meta.dirname, "PricingPage.astro"), "utf8");
    const markup = source.split("---").slice(2).join("---");
    expect(markup.replace(/fact\("[^"]+"\)/g, "")).not.toMatch(
      /\$\d|\b\d+ (videos|days|seconds)\b/,
    );
  });
});
