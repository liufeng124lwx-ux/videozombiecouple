import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fact } from "@vzc/catalog";
import { t } from "@vzc/i18n";
import { describe, expect, it } from "vitest";
import { packCardsFor } from "../lib/pricing-view.ts";

/** What the pricing page shows: every pack, with the Christmas film first. */
const packCardsForPricing = () => packCardsFor("christmas", Number.POSITIVE_INFINITY);

describe("PricingPage", () => {
  it("hydrates the pack rows on load, so ?buy= continues right after sign-in", () => {
    const source = readFileSync(join(import.meta.dirname, "PricingPage.astro"), "utf8");
    expect(source).toMatch(/<PackRows client:load/);
  });
  it("pricing page lists the Christmas film with its own price", () => {
    const rows = packCardsForPricing();
    const xmas = rows.find((r) => r.story === "christmas");
    expect(xmas?.price).toBe("$9.99");
    expect(xmas?.productKey).toBe("christmas1");
    expect(t("story.christmas.pack", { n: xmas?.videos ?? 0 })).toBe("1 Christmas film");
    // The video packs stay, the Christmas film joins them.
    expect(rows.some((r) => !r.story)).toBe(true);
    const source = readFileSync(join(import.meta.dirname, "PricingPage.astro"), "utf8");
    expect(source).toMatch(/<PackRows client:load[^>]*story="christmas" allPacks/);
  });
  it("takes every number from the catalog", () => {
    const source = readFileSync(join(import.meta.dirname, "PricingPage.astro"), "utf8");
    const markup = source.split("---").slice(2).join("---");
    expect(markup.replace(/fact\("[^"]+"\)/g, "")).not.toMatch(
      /\$\d|\b\d+ (videos|days|seconds)\b/,
    );
  });
  it("tells each film's own length: it sells the zombie film and the Christmas film", () => {
    const source = readFileSync(join(import.meta.dirname, "PricingPage.astro"), "utf8");
    expect(source).toMatch(/fact\("story\.zombie\.seconds"\)/);
    expect(source).toMatch(/fact\("story\.christmas\.seconds"\)/);
    expect(source).not.toMatch(/fact\("video\.seconds"\)/);
    const line = t("pricing.inc.film", {
      zombie: fact("story.zombie.seconds"),
      christmas: fact("story.christmas.seconds"),
      w: fact("video.width"),
      h: fact("video.height"),
    });
    expect(line).toContain(`${fact("story.zombie.seconds")}-second`);
    expect(line).toContain(`${fact("story.christmas.seconds")}-second`);
    expect(line).not.toMatch(/\{/);
  });
});
