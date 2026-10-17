import { describe, expect, it } from "vitest";
import {
  alternates,
  LOCALE_IDS,
  LOCALE_NAMES,
  localizedPath,
  makeHref,
  PAGES,
  pageById,
  pageEntries,
  pagePath,
  TRANSLATED_PAGES,
} from "../src/index.ts";

const NOW = Date.parse("2026-10-17T12:00:00Z");
const page = (id: string) => {
  const found = pageById(id);
  if (!found) throw new Error(id);
  return found;
};

describe("locales (GPT and Google send es, pt and fr visitors, 2026-10-17)", () => {
  it("are English, Spanish, Portuguese and French, English first", () => {
    expect(LOCALE_IDS).toEqual(["en", "es", "pt", "fr"]);
    expect(LOCALE_NAMES).toEqual({
      en: "English",
      es: "Español",
      pt: "Português",
      fr: "Français",
    });
  });

  it("translate the pages people land on and the tool's own pages, with the English slug", () => {
    for (const id of TRANSLATED_PAGES)
      for (const locale of ["es", "pt", "fr"] as const) {
        const entry = page(id).locales[locale];
        expect(entry, `${id} ${locale}`).toMatchObject({
          slug: page(id).locales.en.slug,
          status: "live",
        });
        expect(entry?.h1, `${id} ${locale}`).not.toBe("");
      }
  });

  it("keep legal pages in English only", () => {
    for (const p of PAGES.filter((p) => p.kind === "legal"))
      expect(Object.keys(p.locales), p.id).toEqual(["en"]);
  });

  it("put a translated page under its locale", () => {
    expect(pagePath(page("home"), "es")).toBe("/es");
    expect(pagePath(page("ai-christmas-video"), "fr")).toBe("/fr/ai-christmas-video");
  });

  it("link a page that has no translation to the English one", () => {
    expect(localizedPath(page("privacy"), "pt")).toBe("/privacy");
    expect(localizedPath(page("pricing"), "pt")).toBe("/pt/pricing");
  });

  it("send every 'make a film' link to the featured story in the page's language", () => {
    expect(makeHref(NOW, "es")).toBe(`/es${makeHref(NOW)}`);
  });

  it("list each translation as an alternate, English as x-default", () => {
    expect(alternates(page("home"), "production")).toEqual([
      { hreflang: "x-default", path: "/" },
      { hreflang: "en", path: "/" },
      { hreflang: "es", path: "/es" },
      { hreflang: "pt", path: "/pt" },
      { hreflang: "fr", path: "/fr" },
    ]);
  });

  it("build every translated page in production", () => {
    const paths = pageEntries("production").map((e) => e.path);
    for (const id of TRANSLATED_PAGES)
      for (const locale of LOCALE_IDS) expect(paths).toContain(pagePath(page(id), locale));
  });
});
